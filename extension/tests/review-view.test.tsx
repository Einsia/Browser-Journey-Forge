import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: vi.fn() },
    windows: { getCurrent: vi.fn() },
  },
}));

vi.mock('@/browser', () => ({
  getBrowserAdapter: () => ({
    capabilities: {
      browser: 'chrome',
      screenshots: false,
      video: true,
      webRequestBody: true,
      injectedResponseBody: true,
    },
  }),
}));

import { ReviewView } from '@/entrypoints/dashboard/App';
import { db } from '@/storage/db';
import type { RecordingRow } from '@/shared/types';

describe('ReviewView', () => {
  afterEach(async () => {
    await db.events.clear();
    await db.blobs.clear();
    await db.uploadManifests.clear();
  });

  it('keeps unsaved metadata edits when the same recording refreshes', async () => {
    const user = userEvent.setup();
    const callbacks = {
      onSelect: vi.fn(),
      onQueued: vi.fn(async () => undefined),
      onExport: vi.fn(async () => undefined),
      onExportHtml: vi.fn(async () => undefined),
      onRefresh: vi.fn(async () => undefined),
      onError: vi.fn(),
    };
    const original = recording({
      label: 'Original label',
      description: 'Original description',
      tags: ['original'],
    });
    const refreshed = {
      ...original,
      updated_at: 99,
      envelope: {
        ...original.envelope,
        label: 'Server refreshed label',
        description: 'Server refreshed description',
        tags: ['server'],
      },
    };

    const { rerender } = render(
      <ReviewView
        traceId="tr_review"
        recordings={[original]}
        busy={false}
        {...callbacks}
      />
    );

    await user.clear(screen.getByLabelText('Label required'));
    await user.type(screen.getByLabelText('Label required'), 'Unsaved label');
    await user.clear(screen.getByLabelText('Description optional'));
    await user.type(
      screen.getByLabelText('Description optional'),
      'Unsaved description'
    );
    await user.clear(screen.getByLabelText('Tags comma-separated'));
    await user.type(screen.getByLabelText('Tags comma-separated'), 'unsaved');

    rerender(
      <ReviewView
        traceId="tr_review"
        recordings={[refreshed]}
        busy={false}
        {...callbacks}
      />
    );

    expect(screen.getByLabelText('Label required')).toHaveValue('Unsaved label');
    expect(screen.getByLabelText('Description optional')).toHaveValue(
      'Unsaved description'
    );
    expect(screen.getByLabelText('Tags comma-separated')).toHaveValue(
      'unsaved'
    );
  });
});

function recording(
  envelopePatch: Pick<
    RecordingRow['envelope'],
    'label' | 'description' | 'tags'
  >
): RecordingRow {
  return {
    trace_id: 'tr_review',
    status: 'review_required',
    created_at: 1,
    updated_at: 2,
    envelope: {
      schema_version: 'journey_trace_v1',
      trace_id: 'tr_review',
      recording_mode: 'research_free_form',
      started_at: '2026-06-06T00:00:00.000Z',
      browser: {
        extension_version: '0.1.0',
        user_agent: 'vitest',
        timezone: 'UTC',
      },
      summary: {
        domains: [],
        duration_ms: 0,
        event_counts: {},
        screenshot_count: 0,
        video_chunk_count: 0,
      },
      ...envelopePatch,
    },
  };
}
