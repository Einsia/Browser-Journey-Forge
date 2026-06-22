import { describe, expect, it } from 'vitest';
import { evaluateVideoStorageBudget } from '@/video/storage-policy';

const limits = {
  maxChunkBytes: 10,
  maxRecordingBytes: 30,
  maxRecordingDurationMs: 1_000,
  maxLocalBytes: 40,
};

describe('video storage policy', () => {
  it('accepts chunks inside all configured budgets', () => {
    expect(
      evaluateVideoStorageBudget({
        chunkBytes: 8,
        chunkEndTimestamp: 1_500,
        recordingStartedAt: 1_000,
        existingRecordingBytes: 12,
        existingLocalBytes: 20,
        limits,
      })
    ).toEqual({ accept: true });
  });

  it('rejects chunks that exceed per-chunk, per-recording, duration, or local budgets', () => {
    expect(
      evaluateVideoStorageBudget({
        chunkBytes: 11,
        chunkEndTimestamp: 1_100,
        recordingStartedAt: 1_000,
        existingRecordingBytes: 0,
        existingLocalBytes: 0,
        limits,
      })
    ).toMatchObject({ accept: false, reason: 'video_chunk_too_large' });

    expect(
      evaluateVideoStorageBudget({
        chunkBytes: 8,
        chunkEndTimestamp: 1_100,
        recordingStartedAt: 1_000,
        existingRecordingBytes: 25,
        existingLocalBytes: 0,
        limits,
      })
    ).toMatchObject({ accept: false, reason: 'video_recording_bytes_limit' });

    expect(
      evaluateVideoStorageBudget({
        chunkBytes: 8,
        chunkEndTimestamp: 2_100,
        recordingStartedAt: 1_000,
        existingRecordingBytes: 0,
        existingLocalBytes: 0,
        limits,
      })
    ).toMatchObject({ accept: false, reason: 'video_recording_duration_limit' });

    expect(
      evaluateVideoStorageBudget({
        chunkBytes: 8,
        chunkEndTimestamp: 1_100,
        recordingStartedAt: 1_000,
        existingRecordingBytes: 0,
        existingLocalBytes: 38,
        limits,
      })
    ).toMatchObject({ accept: false, reason: 'video_local_bytes_limit' });
  });
});
