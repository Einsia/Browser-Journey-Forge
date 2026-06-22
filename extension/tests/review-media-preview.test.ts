import { describe, expect, it, vi } from 'vitest';
import { createPreviewUrl, mediaPreviewModel, sortMediaRows } from '@/review/media-preview';
import type { BlobRow } from '@/shared/types';

describe('review media preview helpers', () => {
  it('sorts media rows by capture time and stable blob key', () => {
    expect(
      sortMediaRows([
        blob({ blob_key: 'blob_b', created_at: 2 }),
        blob({ blob_key: 'blob_c', created_at: 1 }),
        blob({ blob_key: 'blob_a', created_at: 2 })
      ]).map((row) => row.blob_key)
    ).toEqual(['blob_c', 'blob_a', 'blob_b']);
  });

  it('marks legacy screenshots and video chunks previewable', () => {
    expect(mediaPreviewModel(blob({ kind: 'screenshot', blob_key: 'shot_1' }))).toMatchObject({
      blobKey: 'shot_1',
      kindLabel: 'Legacy screenshot',
      previewable: true,
      stateLabel: 'included',
      stateTone: 'accepted'
    });

    expect(
      mediaPreviewModel(
        blob({
          kind: 'video',
          data: new Blob(['video'], { type: 'video/webm' }),
          excluded_from_upload: true
        })
      )
    ).toMatchObject({
      kindLabel: 'Video chunk',
      previewable: true,
      stateLabel: 'excluded',
      stateTone: 'rejected'
    });
  });

  it('creates revocable local object URLs without base64 conversion', () => {
    const createObjectURL = vi.fn(() => 'blob:local-preview');
    const revokeObjectURL = vi.fn();
    const data = new Blob(['image-bytes'], { type: 'image/png' });

    const preview = createPreviewUrl(data, { createObjectURL, revokeObjectURL });

    expect(preview.src).toBe('blob:local-preview');
    expect(createObjectURL).toHaveBeenCalledWith(data);
    preview.revoke();
    preview.revoke();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
  });
});

function blob(overrides: Partial<BlobRow> = {}): BlobRow {
  return {
    blob_key: 'blob_default',
    trace_id: 'tr_media',
    kind: 'screenshot',
    data: new Blob(['preview'], { type: 'image/png' }),
    created_at: 1,
    ...overrides
  };
}
