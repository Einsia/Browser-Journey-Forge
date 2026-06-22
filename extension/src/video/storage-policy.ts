export type VideoStorageLimits = {
  maxChunkBytes: number;
  maxRecordingBytes: number;
  maxRecordingDurationMs: number;
  maxLocalBytes: number;
};

export type VideoStorageDecision =
  | { accept: true }
  | {
      accept: false;
      reason:
        | 'video_chunk_too_large'
        | 'video_recording_bytes_limit'
        | 'video_recording_duration_limit'
        | 'video_local_bytes_limit';
      detail: string;
    };

export const VIDEO_STORAGE_LIMITS: VideoStorageLimits = {
  maxChunkBytes: 32 * 1024 * 1024,
  maxRecordingBytes: 256 * 1024 * 1024,
  maxRecordingDurationMs: 15 * 60_000,
  maxLocalBytes: 1024 * 1024 * 1024,
};

export function evaluateVideoStorageBudget(opts: {
  chunkBytes: number;
  chunkEndTimestamp: number;
  recordingStartedAt: number;
  existingRecordingBytes: number;
  existingLocalBytes: number;
  limits?: VideoStorageLimits;
}): VideoStorageDecision {
  const limits = opts.limits ?? VIDEO_STORAGE_LIMITS;
  const nextRecordingBytes = opts.existingRecordingBytes + opts.chunkBytes;
  const nextLocalBytes = opts.existingLocalBytes + opts.chunkBytes;
  const recordingDurationMs = Math.max(
    0,
    opts.chunkEndTimestamp - opts.recordingStartedAt
  );

  if (opts.chunkBytes > limits.maxChunkBytes) {
    return {
      accept: false,
      reason: 'video_chunk_too_large',
      detail: `Video chunk exceeded the ${formatLimit(limits.maxChunkBytes)} per-chunk storage limit.`,
    };
  }

  if (nextRecordingBytes > limits.maxRecordingBytes) {
    return {
      accept: false,
      reason: 'video_recording_bytes_limit',
      detail: `Video capture reached the ${formatLimit(limits.maxRecordingBytes)} per-recording storage limit.`,
    };
  }

  if (recordingDurationMs > limits.maxRecordingDurationMs) {
    return {
      accept: false,
      reason: 'video_recording_duration_limit',
      detail: `Video capture reached the ${formatDuration(limits.maxRecordingDurationMs)} per-recording duration limit.`,
    };
  }

  if (nextLocalBytes > limits.maxLocalBytes) {
    return {
      accept: false,
      reason: 'video_local_bytes_limit',
      detail: `Local video storage reached the ${formatLimit(limits.maxLocalBytes)} extension budget.`,
    };
  }

  return { accept: true };
}

function formatLimit(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  if (mib >= 1024) return `${Math.round((mib / 1024) * 10) / 10} GiB`;
  return `${Math.round(mib * 10) / 10} MiB`;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${minutes} min`;
}
