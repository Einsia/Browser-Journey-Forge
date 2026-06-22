import { describe, expect, it } from 'vitest';
import { historyMenuActions } from '@/ui/history-actions';

describe('history row action menu', () => {
  it('keeps row actions in a compact menu order with identity separated from the table row', () => {
    expect(historyMenuActions({ status: 'review_required', busy: false }).map((action) => action.id)).toEqual([
      'review',
      'upload',
      'export',
      'export_html',
      'identity',
      'delete'
    ]);
  });

  it('uses upload or resume labels based on resumable status', () => {
    expect(historyMenuActions({ status: 'queued', busy: false }).find((action) => action.id === 'upload')).toMatchObject({
      label: 'Upload',
      disabled: false
    });

    expect(historyMenuActions({ status: 'failed', busy: false }).find((action) => action.id === 'upload')).toMatchObject({
      label: 'Resume',
      disabled: false
    });

    expect(historyMenuActions({ status: 'accepted', busy: false }).find((action) => action.id === 'upload')).toMatchObject({
      label: 'Resume',
      disabled: true
    });
  });

  it('disables mutating actions while a trace operation is busy but still allows identity inspection', () => {
    expect(historyMenuActions({ status: 'review_required', busy: true })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'review', disabled: true }),
        expect.objectContaining({ id: 'upload', disabled: true }),
        expect.objectContaining({ id: 'export', disabled: true }),
        expect.objectContaining({ id: 'export_html', disabled: true }),
        expect.objectContaining({ id: 'identity', disabled: false }),
        expect.objectContaining({ id: 'delete', disabled: true, destructive: true })
      ])
    );
  });
});
