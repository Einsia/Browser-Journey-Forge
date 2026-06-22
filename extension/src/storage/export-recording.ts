import type { BlobRow, CapturedEvent, RecordingRow, UploadManifest } from '@/shared/types';
import { redactEvent } from '@/redaction/redactor';
import { db } from './db';

export type RecordingExport = {
  schema_version: 'journey_local_export_v1';
  exported_at: string;
  recording: RecordingRow;
  events: CapturedEvent[];
  media: ExportedMediaBlob[];
  upload_manifest?: UploadManifest;
};

export type ExportedMediaBlob = {
  blob_key: string;
  kind: BlobRow['kind'];
  created_at: number;
  sha256?: string;
  content_type: string;
  bytes: number;
  data_base64: string;
};

export async function buildRecordingExport(traceId: string): Promise<RecordingExport> {
  const recording = await db.recordings.get(traceId);
  if (!recording) throw new Error(`recording not found: ${traceId}`);

  const [events, blobs, uploadManifest] = await Promise.all([
    db.events.where('trace_id').equals(traceId).sortBy('timestamp'),
    db.blobs.where('trace_id').equals(traceId).sortBy('created_at'),
    db.uploadManifests.get(traceId)
  ]);

  const keepRequestBodies =
    recording.envelope.capture_settings?.keepRequestBodies ??
    recording.envelope.recording_mode === 'research_free_form';

  return {
    schema_version: 'journey_local_export_v1',
    exported_at: new Date().toISOString(),
    recording: stripIdentity(recording),
    events: events.map((event) => redactEvent(event, recording.identity, { keepRequestBodies })),
    media: await Promise.all(blobs.filter((blob) => !blob.excluded_from_upload).map(exportBlob)),
    ...(uploadManifest ? { upload_manifest: stripPayloads(uploadManifest) } : {})
  };
}

function stripIdentity(recording: RecordingRow): RecordingRow {
  const { identity: _identity, ...exportedRecording } = recording;
  return exportedRecording;
}

function stripPayloads(uploadManifest: UploadManifest): UploadManifest {
  return {
    trace_id: uploadManifest.trace_id,
    ...(uploadManifest.upload_id ? { upload_id: uploadManifest.upload_id } : {}),
    chunks: uploadManifest.chunks,
    finalized: uploadManifest.finalized
  };
}

async function exportBlob(blob: BlobRow): Promise<ExportedMediaBlob> {
  const bytes = new Uint8Array(await blob.data.arrayBuffer());
  return {
    blob_key: blob.blob_key,
    kind: blob.kind,
    created_at: blob.created_at,
    ...(blob.sha256 ? { sha256: blob.sha256 } : {}),
    content_type: blob.data.type || 'application/octet-stream',
    bytes: bytes.byteLength,
    data_base64: base64(bytes)
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
