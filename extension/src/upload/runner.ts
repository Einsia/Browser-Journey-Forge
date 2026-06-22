import {
  finalizeTraceUpload,
  getTraceUploadStatus,
  initTraceUpload,
  uploadChunk,
  type TraceUploadStatus
} from '@/upload/client';
import {
  buildUploadManifest,
  missingChunks,
  readManifestChunkPayload,
  type UploadManifestWithPayload
} from '@/upload/manifest';
import type { RecordingRow, RecordingStatus, UploadManifest } from '@/shared/types';
import { db, getConfig } from '@/storage/db';

const RESUMABLE_STATUSES: RecordingStatus[] = ['queued', 'failed', 'paused'];
const FINAL_RECORDING_STATUSES = new Set<RecordingStatus>(['uploaded', 'processing', 'accepted', 'rejected', 'failed']);
const POLLED_RECORDING_STATUSES = new Set<RecordingStatus>(['uploading', 'uploaded', 'processing', 'accepted', 'rejected', 'failed', 'review_required']);

// The server reports a few statuses in its own vocabulary (ClawBench V2);
// translate them to the extension's RecordingStatus at the API boundary so the
// domain type stays clean.
const SERVER_STATUS_MAP: Record<string, RecordingStatus> = {
  needs_review: 'review_required',
  degraded: 'failed',
};

function mapServerStatus(status: string): string {
  return SERVER_STATUS_MAP[status] ?? status;
}

// Judge polling: interval between status checks and the max number of checks
// before giving up (default ≈ 90 × 2s = 3 minutes).
const JUDGE_POLL_INTERVAL_MS = 2000;
const MAX_JUDGE_POLLS = 90;

export async function uploadNextRecording(signal?: AbortSignal): Promise<RecordingRow | null> {
  const candidates = await db.recordings.where('status').anyOf(RESUMABLE_STATUSES).toArray();
  const next = candidates.sort((a, b) => a.updated_at - b.updated_at || a.created_at - b.created_at)[0];
  if (!next) return null;
  return await uploadRecording(next.trace_id, signal);
}

export async function uploadRecording(traceId: string, signal?: AbortSignal): Promise<RecordingRow> {
  const row = await db.recordings.get(traceId);
  if (!row) throw new Error(`recording not found: ${traceId}`);
  if (!RESUMABLE_STATUSES.includes(row.status) && row.status !== 'uploading') {
    throw new Error(`recording cannot be uploaded from status: ${row.status}`);
  }

  await markRecordingUploading(row);

  try {
    const config = await getConfig();
    if (!config.endpoint_url || !config.api_key) {
      throw new Error('upload endpoint and API key are required before upload');
    }

    const freshRow = await requireRecording(traceId);
    let manifest = await loadPayloadManifest(traceId);
    const init = await initTraceUpload({
      endpointUrl: config.endpoint_url,
      apiKey: config.api_key,
      signal,
      trace: {
        trace_id: freshRow.envelope.trace_id,
        schema_version: freshRow.envelope.schema_version,
        recording_mode: freshRow.envelope.recording_mode,
        label: freshRow.envelope.label ?? '',
        description: freshRow.envelope.description ?? '',
        tags: freshRow.envelope.tags,
        ...(freshRow.envelope.task_case_id ? { task_case_id: freshRow.envelope.task_case_id } : {}),
        ...(freshRow.envelope.identity_bundle_id ? { identity_bundle_id: freshRow.envelope.identity_bundle_id } : {}),
        summary: freshRow.envelope.summary,
        capture_settings: freshRow.envelope.capture_settings ?? config.capture
      }
    });

    manifest = await persistUploadId(traceId, manifest, init.uploadId);
    const status = await getTraceUploadStatus({
      endpointUrl: config.endpoint_url,
      apiKey: config.api_key,
      signal,
      uploadId: init.uploadId
    }).catch<TraceUploadStatus>((error) => {
      console.warn(`[journey-forge] upload status check failed, using init status: ${String(error)}`);
      return {
        status: init.status,
        missingChunks: [],
        acceptedChunks: init.acceptedChunks
      };
    });

    const accepted = uniqueNumbers([...init.acceptedChunks, ...status.acceptedChunks]);
    markAccepted(manifest, accepted);
    await db.uploadManifests.put(manifest);

    const candidateMissing = uniqueNumbers([...status.missingChunks, ...missingChunks(manifest, accepted)]);
    for (const chunkIndex of candidateMissing) {
      const chunk = manifest.chunks.find((candidate) => candidate.index === chunkIndex);
      if (!chunk) continue;

      const payload = readManifestChunkPayload(manifest, chunkIndex);
      const uploaded = await uploadChunk({
        endpointUrl: config.endpoint_url,
        apiKey: config.api_key,
        signal,
        uploadId: init.uploadId,
        chunkIndex,
        kind: chunk.kind,
        sha256: chunk.sha256,
        body: payload.body
      });
      validateChunkUploadResponse(chunkIndex, chunk.sha256, uploaded);

      chunk.uploaded = true;
      await db.uploadManifests.put(manifest);
    }

    const finalized = await finalizeTraceUpload({
      endpointUrl: config.endpoint_url,
      apiKey: config.api_key,
      signal,
      uploadId: init.uploadId,
      manifest
    });
    let finalStatus = validateFinalizeResponse(traceId, finalized);

    manifest.finalized = true;
    await db.uploadManifests.put(manifest);

    if (finalStatus === 'processing') {
      await updateRecording(traceId, { status: 'processing', upload_id: init.uploadId });
      const judgeResult = await pollUntilJudged(config, init.uploadId, signal);
      finalStatus = judgeResult.status;
      if (finalStatus === 'rejected') {
        return await updateRecording(traceId, {
          status: finalStatus,
          upload_id: init.uploadId,
          last_error: judgeResult.reason || 'Judge: recording did not pass task requirements'
        });
      }
    }

    return await updateRecording(traceId, {
      status: finalStatus,
      upload_id: init.uploadId
    });
  } catch (error) {
    await updateRecording(traceId, {
      status: 'failed',
      last_error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function pollUploadStatus(traceId: string, signal?: AbortSignal): Promise<RecordingRow> {
  const row = await requireRecording(traceId);
  if (!row.upload_id) throw new Error(`recording has no upload id: ${traceId}`);

  const config = await getConfig();
  if (!config.endpoint_url || !config.api_key) {
    throw new Error('upload endpoint and API key are required before polling upload status');
  }

  const status = await getTraceUploadStatus({
    endpointUrl: config.endpoint_url,
    apiKey: config.api_key,
    signal,
    uploadId: row.upload_id
  });
  const recordingStatus = validatePolledStatus(status.status);
  return await updateRecording(traceId, {
    status: recordingStatus,
    ...(status.reason ? { last_error: status.reason } : {})
  });
}

async function pollUntilJudged(
  config: { endpoint_url: string; api_key: string },
  uploadId: string,
  signal?: AbortSignal
): Promise<{ status: RecordingStatus; reason?: string }> {
  for (let i = 0; i < MAX_JUDGE_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, JUDGE_POLL_INTERVAL_MS));
    if (signal?.aborted) throw new Error('upload aborted during judge');
    const status = await getTraceUploadStatus({
      endpointUrl: config.endpoint_url,
      apiKey: config.api_key,
      signal,
      uploadId
    });
    if (status.status !== 'processing') {
      const polled = validatePolledStatus(status.status);
      return status.reason !== undefined ? { status: polled, reason: status.reason } : { status: polled };
    }
  }
  console.warn(`[journey-forge] judge still processing after ${MAX_JUDGE_POLLS} polls; leaving as uploaded`);
  return { status: 'uploaded' as RecordingStatus };
}

async function loadPayloadManifest(traceId: string): Promise<UploadManifestWithPayload> {
  const stored = (await db.uploadManifests.get(traceId)) as UploadManifestWithPayload | undefined;
  if (stored?.payloads?.length) return stored;
  return await buildUploadManifest(traceId);
}

async function persistUploadId(
  traceId: string,
  manifest: UploadManifestWithPayload,
  uploadId: string
): Promise<UploadManifestWithPayload> {
  const updatedManifest = { ...manifest, upload_id: uploadId };
  await db.uploadManifests.put(updatedManifest);

  const row = await requireRecording(traceId);
  await updateRecording(traceId, { ...row, status: 'uploading', upload_id: uploadId });

  return updatedManifest;
}

function markAccepted(manifest: UploadManifest, acceptedIndexes: number[]): void {
  const accepted = new Set(acceptedIndexes);
  for (const chunk of manifest.chunks) {
    if (accepted.has(chunk.index)) chunk.uploaded = true;
  }
}

async function markRecordingUploading(row: RecordingRow): Promise<void> {
  const { last_error: _lastError, ...rest } = row;
  await db.recordings.put({
    ...rest,
    status: 'uploading',
    updated_at: Date.now()
  });
}

async function updateRecording(traceId: string, patch: Partial<RecordingRow>): Promise<RecordingRow> {
  const row = await requireRecording(traceId);
  const next: RecordingRow = {
    ...row,
    ...patch,
    trace_id: row.trace_id,
    envelope: row.envelope,
    updated_at: Date.now()
  };
  await db.recordings.put(next);
  return next;
}

async function requireRecording(traceId: string): Promise<RecordingRow> {
  const row = await db.recordings.get(traceId);
  if (!row) throw new Error(`recording not found: ${traceId}`);
  return row;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function validateChunkUploadResponse(
  chunkIndex: number,
  sha256: string,
  response: { ok: boolean; chunkIndex: number; sha256: string }
): void {
  if (!response.ok || response.chunkIndex !== chunkIndex || response.sha256 !== sha256) {
    throw new Error(
      `chunk ${chunkIndex} response mismatch: expected ok=true index=${chunkIndex} sha256=${sha256}, got ok=${String(
        response.ok
      )} index=${response.chunkIndex} sha256=${response.sha256}`
    );
  }
}

function validateFinalizeResponse(traceId: string, response: { status: string; traceId: string }): RecordingStatus {
  const mapped = mapServerStatus(response.status);
  if (response.traceId !== traceId || !FINAL_RECORDING_STATUSES.has(mapped as RecordingStatus)) {
    throw new Error(
      `finalize response mismatch: expected trace_id=${traceId} status in ${[...FINAL_RECORDING_STATUSES].join(
        ','
      )}, got trace_id=${response.traceId} status=${response.status}`
    );
  }
  return mapped as RecordingStatus;
}

function validatePolledStatus(status: string): RecordingStatus {
  const mapped = mapServerStatus(status);
  if (!POLLED_RECORDING_STATUSES.has(mapped as RecordingStatus)) {
    throw new Error(`upload status response mismatch: expected status in ${[...POLLED_RECORDING_STATUSES].join(',')}, got ${status}`);
  }
  return mapped as RecordingStatus;
}
