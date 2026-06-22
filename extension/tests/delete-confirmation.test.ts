import { describe, expect, it } from 'vitest';
import { deleteConfirmation } from '@/ui/delete-confirmation';

describe('delete confirmation model', () => {
  it('uses concrete local-data deletion copy', () => {
    expect(deleteConfirmation({ label: 'Checkout trace', traceId: 'tr_delete_123' })).toEqual({
      title: 'Delete Local Recording?',
      detail: 'This removes events, media blobs, and upload state for "Checkout trace" from this browser.',
      traceId: 'tr_delete_123',
      confirmLabel: 'Delete Local Copy',
      cancelLabel: 'Cancel'
    });
  });

  it('falls back to trace id when a recording has no label', () => {
    expect(deleteConfirmation({ label: '', traceId: 'tr_delete_123' }).detail).toContain('"tr_delete_123"');
  });
});
