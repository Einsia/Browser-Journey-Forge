import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteRecordingDialog } from '@/ui/delete-recording-dialog';
import type { RecordingRow } from '@/shared/types';

describe('DeleteRecordingDialog', () => {
  it('confirms deletion without using native browser confirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(<DeleteRecordingDialog recording={recording()} onCancel={onCancel} onConfirm={onConfirm} />);

    expect(screen.getByRole('alertdialog', { name: 'Delete Local Recording?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Local Copy' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

function recording(): RecordingRow {
  return {
    trace_id: 'tr_dialog',
    status: 'review_required',
    created_at: 1,
    updated_at: 2,
    envelope: {
      schema_version: 'journey_trace_v1',
      trace_id: 'tr_dialog',
      recording_mode: 'research_free_form',
      started_at: '2026-06-04T00:00:00.000Z',
      label: 'Survey checkout',
      tags: [],
      browser: { extension_version: '0.1.0', user_agent: 'vitest', timezone: 'UTC' },
      summary: {
        domains: [],
        duration_ms: 0,
        event_counts: {},
        screenshot_count: 0,
        video_chunk_count: 0
      }
    }
  };
}
