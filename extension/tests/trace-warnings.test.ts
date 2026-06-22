import { describe, expect, it } from 'vitest';
import { buildTraceWarnings } from '@/review/trace-warnings';
import type { ReviewSummary } from '@/review/summary';
import type { BlobRow, RecordingRow } from '@/shared/types';

describe('trace QA warnings', () => {
  it('flags traces missing core skill-distillation evidence', () => {
    expect(
      buildTraceWarnings({
        recording: recording({ capture_settings: { screenshots: true, video: false, networkBodies: true } }),
        summary: summary({ eventCounts: { network_request: 2, screenshot: 1 } }),
        mediaRows: [],
        uploadManifest: null
      }).map((warning) => warning.id)
    ).toEqual(['missing_action_events', 'missing_navigation_events', 'missing_dom_snapshots', 'missing_form_summaries']);
  });

  it('flags excluded media', () => {
    const warnings = buildTraceWarnings({
      recording: recording({ capture_settings: { screenshots: false, video: false, networkBodies: true } }),
      summary: summary({ eventCounts: { action: 1, navigation: 1, dom_snapshot: 1, form_summary: 1 } }),
      mediaRows: [
        media({ blob_key: 'blob_1', excluded_from_upload: true }),
        media({ blob_key: 'blob_2' })
      ],
      uploadManifest: null
    });

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'media_partially_excluded', title: 'Some media excluded' })
      ])
    );
  });

  it('escalates when all media is excluded and when a saved upload manifest is incomplete', () => {
    const warnings = buildTraceWarnings({
      recording: recording({ capture_settings: { screenshots: true, video: false, networkBodies: true } }),
      summary: summary({ eventCounts: { action: 1, navigation: 1, dom_snapshot: 1, form_summary: 1 } }),
      mediaRows: [media({ excluded_from_upload: true })],
      uploadManifest: {
        trace_id: 'tr_warn',
        finalized: false,
        chunks: [
          { index: 0, kind: 'events', sha256: 'hash_0', bytes: 10, uploaded: true },
          { index: 1, kind: 'media', sha256: 'hash_1', bytes: 20, uploaded: false }
        ]
      }
    });

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'all_media_excluded', severity: 'danger' }),
        expect.objectContaining({ id: 'upload_manifest_incomplete', detail: '1 of 2 upload chunk is still pending.' })
      ])
    );
  });

  it('flags traces with excessive DOM snapshots and wheel gestures', () => {
    const warnings = buildTraceWarnings({
      recording: recording({ capture_settings: { screenshots: true, video: false, networkBodies: true } }),
      summary: summary({
        eventCounts: { action: 130, navigation: 1, dom_snapshot: 80, form_summary: 1, screenshot: 70 },
        volume: {
          durationMinutes: 1,
          eventsPerMinute: 282,
          eventRates: { action: 130, navigation: 1, dom_snapshot: 80, form_summary: 1, screenshot: 70 },
          actionCounts: { wheel: 100, click: 30 },
          topActionTypes: [
            { actionType: 'wheel', count: 100 },
            { actionType: 'click', count: 30 }
          ],
          topEventKinds: [
            { kind: 'action', count: 130 },
            { kind: 'dom_snapshot', count: 80 },
            { kind: 'screenshot', count: 70 }
          ]
        }
      }),
      mediaRows: [],
      uploadManifest: null
    });

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'excessive_dom_snapshots', severity: 'warning' }),
        expect.objectContaining({ id: 'excessive_wheel_events', severity: 'warning' })
      ])
    );
  });

  it('flags failed video capture when video was enabled but no chunks exist', () => {
    const warnings = buildTraceWarnings({
      recording: recording({ capture_settings: { screenshots: false, video: true, networkBodies: true } }),
      summary: summary({
        eventCounts: { action: 1, navigation: 1, dom_snapshot: 1, form_summary: 1, annotation: 1 },
        annotationCounts: { video_failed: 1 },
        media: { screenshots: 0, videoChunks: 0, bytes: 0 }
      }),
      mediaRows: [],
      uploadManifest: null
    });

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'video_capture_failed',
          title: 'Video capture failed'
        })
      ])
    );
  });

  it('flags degraded video capture when storage or duration limits stop media capture', () => {
    const warnings = buildTraceWarnings({
      recording: recording({ capture_settings: { screenshots: false, video: true, networkBodies: true } }),
      summary: summary({
        eventCounts: { action: 1, navigation: 1, dom_snapshot: 1, form_summary: 1, annotation: 1, video_chunk: 2 },
        annotationCounts: { video_degraded: 1 },
        media: { screenshots: 0, videoChunks: 2, bytes: 1024 }
      }),
      mediaRows: [
        media({
          kind: 'video',
          data: new Blob(['video'], { type: 'video/webm' })
        })
      ],
      uploadManifest: null
    });

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'video_capture_degraded',
          title: 'Video capture degraded'
        })
      ])
    );
  });
});

function summary(patch: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    domains: [],
    durationMs: 0,
    eventCounts: {},
    annotationCounts: {},
    media: { screenshots: 0, videoChunks: 0, bytes: 0 },
    volume: {
      durationMinutes: 0,
      eventsPerMinute: 0,
      eventRates: {},
      actionCounts: {},
      topActionTypes: [],
      topEventKinds: []
    },
    redactionWarnings: [],
    uploadBytesEstimate: 0,
    ...patch
  };
}

function recording(envelopePatch: Partial<RecordingRow['envelope']> = {}): RecordingRow {
  return {
    trace_id: 'tr_warn',
    status: 'review_required',
    created_at: 1,
    updated_at: 2,
    envelope: {
      schema_version: 'journey_trace_v1',
      trace_id: 'tr_warn',
      recording_mode: 'research_free_form',
      started_at: '2026-06-04T00:00:00.000Z',
      tags: [],
      browser: { extension_version: '0.1.0', user_agent: 'vitest', timezone: 'UTC' },
      summary: {
        domains: [],
        duration_ms: 0,
        event_counts: {},
        screenshot_count: 0,
        video_chunk_count: 0
      },
      ...envelopePatch
    }
  };
}

function media(patch: Partial<BlobRow> = {}): BlobRow {
  return {
    blob_key: 'blob_warn',
    trace_id: 'tr_warn',
    kind: 'screenshot',
    data: new Blob(['image'], { type: 'image/png' }),
    created_at: 1,
    ...patch
  };
}
