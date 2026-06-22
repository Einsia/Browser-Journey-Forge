import { describe, expect, it } from 'vitest';
import {
  captureModeNotice,
  captureStateLabel,
  historyRowState,
  recordingActivityNotice,
  uploadStateLabel
} from '@/reliability/status';
import type { RecordingRow } from '@/shared/types';

describe('reliability status view model', () => {
  it('surfaces active recordings recovered after extension restart', () => {
    expect(recordingActivityNotice({ active: true, traceId: 'tr_recovered', recovered: true })).toEqual({
      tone: 'warning',
      title: 'Recovered active recording',
      detail: 'Recording tr_recovered was recovered after restart. Continue normally or stop it when the journey is complete.'
    });
  });

  it('surfaces video-disabled capture mode', () => {
    expect(captureModeNotice({ screenshots: false, video: false, networkBodies: true })).toEqual({
      tone: 'warning',
      title: 'Video disabled',
      detail: 'This recording will keep events, DOM snapshots, and network metadata, but no visual recording.'
    });
  });

  it('labels paused and failed uploads as resumable', () => {
    expect(uploadStateLabel(recording('tr_paused', 'paused'))).toEqual({
      tone: 'warning',
      label: 'Upload paused',
      detail: 'Resume will continue from the existing upload state.'
    });
    expect(uploadStateLabel(recording('tr_failed', 'failed', { last_error: 'chunk failed' }))).toEqual({
      tone: 'danger',
      label: 'Upload failed',
      detail: 'chunk failed'
    });
  });

  it('labels capture-paused drafts separately from upload-paused recordings', () => {
    expect(captureStateLabel({ ...recording('tr_capture_paused', 'draft'), capture_paused: true })).toEqual({
      tone: 'warning',
      label: 'Recording paused',
      detail: 'The draft is saved locally. Resume to continue capturing events.'
    });
  });

  it('marks local history rows as exportable and deletable', () => {
    expect(historyRowState(recording('tr_local', 'draft')).localCopy).toEqual({
      label: 'Local copy available',
      detail: 'Export a JSON copy or delete local events and media.'
    });
  });

  it('uses persisted trace capture settings for video state', () => {
    expect(
      historyRowState(
        recording('tr_no_screen', 'review_required', {
          envelope: { ...recording('tr_no_screen', 'review_required').envelope, capture_settings: { screenshots: false, video: false, networkBodies: true } }
        })
      ).capture
    ).toEqual({
      tone: 'warning',
      label: 'Video disabled',
      detail: 'Trace has no visual recording evidence.'
    });
  });
});

function recording(traceId: string, status: RecordingRow['status'], patch: Partial<RecordingRow> = {}): RecordingRow {
  return {
    trace_id: traceId,
    status,
    created_at: 1,
    updated_at: 1,
    envelope: {
      schema_version: 'journey_trace_v1',
      trace_id: traceId,
      recording_mode: 'research_free_form',
      started_at: '2026-06-03T00:00:00.000Z',
      tags: [],
      browser: { extension_version: '0.1.0', user_agent: 'vitest', timezone: 'UTC' },
      summary: {
        domains: [],
        duration_ms: 0,
        event_counts: {},
        screenshot_count: 0,
        video_chunk_count: 0
      }
    },
    ...patch
  };
}
