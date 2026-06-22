import { gzipSync } from 'fflate';
import { redactEvent } from '@/redaction/redactor';
import type { BlobRow, CapturedEvent, RedactionClass, UploadManifest, UploadMediaChunkMetadata } from '@/shared/types';
import { db } from '@/storage/db';

const EVENT_CHUNK_TARGET_BYTES = 256 * 1024;
const MEDIA_CHUNK_TARGET_BYTES = 8 * 1024 * 1024;
const textEncoder = new TextEncoder();

export type BuildUploadManifestOptions = {
  mediaChunkTargetBytes?: number;
};

export type UploadManifestChunkPayload = {
  index: number;
  kind: 'events' | 'media';
  body: ArrayBuffer;
  contentEncoding: 'gzip';
};

export type UploadManifestWithPayload = UploadManifest & {
  payloads: UploadManifestChunkPayload[];
  redaction_report: Partial<Record<RedactionClass, number>>;
  event_counts: Record<string, number>;
  media_counts: Record<'screenshot' | 'video', number>;
};

export async function buildUploadManifest(
  traceId: string,
  options: BuildUploadManifestOptions = {}
): Promise<UploadManifestWithPayload> {
  const recording = await db.recordings.get(traceId);
  if (!recording) throw new Error(`recording not found: ${traceId}`);

  const keepRequestBodies =
    recording.envelope.capture_settings?.keepRequestBodies ??
    recording.envelope.recording_mode === 'research_free_form';

  const events = await db.events.where('trace_id').equals(traceId).toArray();
  const redactedEvents = events
    .sort((a, b) => a.timestamp - b.timestamp || a.event_id.localeCompare(b.event_id))
    .map((event) => redactEvent(event, recording.identity, { keepRequestBodies }));

  const uploadableMediaBlobs = await loadUploadableMediaBlobs(traceId);
  const eventChunks = await buildEventChunks(redactedEvents);
  const mediaChunks = await buildMediaChunks(uploadableMediaBlobs, eventChunks.length, options);
  const chunks = [...eventChunks, ...mediaChunks];
  const manifest: UploadManifestWithPayload = {
    trace_id: traceId,
    chunks: chunks.map(({ payload: _payload, ...chunk }) => chunk),
    payloads: chunks.map((chunk) => chunk.payload),
    finalized: false,
    redaction_report: buildRedactionReport(redactedEvents),
    event_counts: countEvents(redactedEvents),
    media_counts: countMediaBlobs(uploadableMediaBlobs),
    ...(recording.upload_id ? { upload_id: recording.upload_id } : {})
  };

  await db.uploadManifests.put(manifest);
  return manifest;
}

export function missingChunks(manifest: UploadManifest, acceptedIndexes: number[]): number[] {
  const accepted = new Set(acceptedIndexes);
  return manifest.chunks.filter((chunk) => !accepted.has(chunk.index)).map((chunk) => chunk.index);
}

export function readManifestChunkPayload(manifest: UploadManifest, chunkIndex: number): UploadManifestChunkPayload {
  const payload = asPayloadManifest(manifest).payloads?.find((candidate) => candidate.index === chunkIndex);
  if (!payload) throw new Error(`upload payload not found for chunk ${chunkIndex}`);
  return payload;
}

function asPayloadManifest(manifest: UploadManifest): Partial<UploadManifestWithPayload> {
  return manifest as Partial<UploadManifestWithPayload>;
}

async function buildEventChunks(
  events: CapturedEvent[]
): Promise<Array<UploadManifest['chunks'][number] & { payload: UploadManifestChunkPayload }>> {
  const chunks: Array<UploadManifest['chunks'][number] & { payload: UploadManifestChunkPayload }> = [];
  let lines: string[] = [];
  let uncompressedBytes = 0;

  for (const event of events) {
    const line = `${JSON.stringify(event)}\n`;
    const lineBytes = textEncoder.encode(line).byteLength;
    if (lines.length > 0 && uncompressedBytes + lineBytes > EVENT_CHUNK_TARGET_BYTES) {
      chunks.push(await createChunk(chunks.length, 'events', lines.join('')));
      lines = [];
      uncompressedBytes = 0;
    }
    lines.push(line);
    uncompressedBytes += lineBytes;
  }

  if (lines.length > 0) {
    chunks.push(await createChunk(chunks.length, 'events', lines.join('')));
  }

  return chunks;
}

async function loadUploadableMediaBlobs(traceId: string): Promise<BlobRow[]> {
  const blobs = await db.blobs.where('trace_id').equals(traceId).toArray();
  return blobs.filter((blob) => !blob.excluded_from_upload);
}

async function buildMediaChunks(
  blobs: BlobRow[],
  startIndex: number,
  options: BuildUploadManifestOptions
): Promise<Array<UploadManifest['chunks'][number] & { payload: UploadManifestChunkPayload }>> {
  const chunks: Array<UploadManifest['chunks'][number] & { payload: UploadManifestChunkPayload }> = [];
  const targetBytes = Math.max(1, options.mediaChunkTargetBytes ?? MEDIA_CHUNK_TARGET_BYTES);

  for (const blob of blobs.sort((a, b) => a.created_at - b.created_at || a.blob_key.localeCompare(b.blob_key))) {
    const body = await blobToArrayBuffer(blob.data);
    const bytes = new Uint8Array(body);
    const segmentCount = Math.max(1, Math.ceil(bytes.byteLength / targetBytes));
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const start = segmentIndex * targetBytes;
      const end = Math.min(bytes.byteLength, start + targetBytes);
      const segment = bytes.slice(start, end);
      chunks.push(
        await createChunk(startIndex + chunks.length, 'media', segment, {
          blob_key: blob.blob_key,
          media_kind: blob.kind,
          mime_type: blob.data.type,
          created_at: blob.created_at,
          segment_index: segmentIndex,
          segment_count: segmentCount,
          uncompressed_bytes: segment.byteLength,
        })
      );
    }
  }

  return chunks;
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer();
  }
  return await new Response(blob).arrayBuffer();
}

async function createChunk(
  index: number,
  kind: 'events' | 'media',
  input: string | Uint8Array,
  media?: UploadMediaChunkMetadata
): Promise<UploadManifest['chunks'][number] & { payload: UploadManifestChunkPayload }> {
  const raw = typeof input === 'string' ? textEncoder.encode(input) : input;
  const compressed = gzipSync(raw);
  const body = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer;
  return {
    index,
    kind,
    sha256: await sha256Bytes(compressed),
    bytes: compressed.byteLength,
    uploaded: false,
    ...(media ? { media } : {}),
    payload: {
      index,
      kind,
      body,
      contentEncoding: 'gzip'
    }
  };
}

async function sha256Bytes(input: Uint8Array): Promise<string> {
  const bytes = Uint8Array.from(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function countEvents(events: CapturedEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

function countMediaBlobs(blobs: BlobRow[]): Record<'screenshot' | 'video', number> {
  return {
    screenshot: blobs.filter((blob) => blob.kind === 'screenshot').length,
    video: blobs.filter((blob) => blob.kind === 'video').length
  };
}

function buildRedactionReport(events: CapturedEvent[]): Partial<Record<RedactionClass, number>> {
  const report: Partial<Record<RedactionClass, number>> = {};
  for (const event of events) {
    collectRedactionClasses(event, report);
  }
  return report;
}

function collectRedactionClasses(value: unknown, report: Partial<Record<RedactionClass, number>>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectRedactionClasses(item, report);
    return;
  }

  const record = value as Record<string, unknown>;
  const redaction = record.redaction;
  if (redaction && typeof redaction === 'object') {
    const classes = (redaction as { classes?: unknown }).classes;
    if (Array.isArray(classes)) {
      for (const redactionClass of classes) {
        if (typeof redactionClass === 'string') {
          const typedClass = redactionClass as RedactionClass;
          report[typedClass] = (report[typedClass] ?? 0) + 1;
        }
      }
    }
  }

  for (const item of Object.values(record)) {
    collectRedactionClasses(item, report);
  }
}
