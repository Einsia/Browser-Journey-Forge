import { afterEach, describe, expect, it } from 'vitest';
import { buildReviewSummary } from '@/review/summary';
import { db } from '@/storage/db';
import type {
  ActionEvent,
  NetworkRequestEvent,
  RecordingRow,
  ScreenshotEvent,
  AnnotationEvent,
  VideoChunkEvent,
} from '@/shared/types';

const recording = (traceId: string): RecordingRow => ({
  trace_id: traceId,
  status: 'review_required',
  created_at: 1_000,
  updated_at: 7_000,
  envelope: {
    schema_version: 'journey_trace_v1',
    trace_id: traceId,
    recording_mode: 'research_free_form',
    started_at: '1970-01-01T00:00:01.000Z',
    ended_at: '1970-01-01T00:00:07.000Z',
    tags: [],
    browser: {
      extension_version: '0.1.0',
      user_agent: 'test',
      timezone: 'UTC',
    },
    summary: {
      domains: [],
      duration_ms: 0,
      event_counts: {},
      screenshot_count: 0,
      video_chunk_count: 0,
    },
  },
});

const screenshot = (traceId: string): ScreenshotEvent => ({
  event_id: 'ev_screen',
  trace_id: traceId,
  tab_id: 1,
  timestamp: 2_000,
  url: 'https://www.example.com/page',
  kind: 'screenshot',
  blob_key: 'blob_screen',
});

const video = (traceId: string): VideoChunkEvent => ({
  event_id: 'ev_video',
  trace_id: traceId,
  tab_id: 1,
  timestamp: 3_000,
  url: 'https://shop.example.com/cart',
  kind: 'video_chunk',
  blob_key: 'blob_video',
  start_timestamp: 2_500,
  end_timestamp: 3_000,
});

const action = (traceId: string): ActionEvent => ({
  event_id: 'ev_action',
  trace_id: traceId,
  tab_id: 1,
  timestamp: 4_000,
  url: 'https://shop.example.com/checkout',
  kind: 'action',
  action_type: 'input',
  value: {
    value: null,
    redaction: {
      strategy: 'raw_removed',
      classes: ['classified_email'],
      originalLength: 20,
      digest: 'red_email',
    },
  },
});

const network = (traceId: string): NetworkRequestEvent => ({
  event_id: 'ev_network',
  trace_id: traceId,
  tab_id: 1,
  timestamp: 5_000,
  url: 'https://api.example.test/v1',
  kind: 'network_request',
  request_id: 'req_1',
  method: 'POST',
  full_url: 'https://api.example.test/v1/checkout',
  fetch_kind: 'fetch',
  req_headers: {
    authorization: {
      value: null,
      redaction: {
        strategy: 'raw_removed',
        classes: ['classified_token'],
        originalLength: 19,
        digest: 'red_token',
      },
    },
  },
});

const annotation = (
  traceId: string,
  annotationType: AnnotationEvent['annotation_type']
): AnnotationEvent => ({
  event_id: `ev_${annotationType}`,
  trace_id: traceId,
  tab_id: 1,
  timestamp: 5_500,
  url: 'https://shop.example.com/checkout',
  kind: 'annotation',
  annotation_type: annotationType,
  text: `${annotationType}_text`,
});

async function clearDb() {
  await db.events.clear();
  await db.recordings.clear();
  await db.blobs.clear();
  await db.uploadManifests.clear();
  await db.config.clear();
}

describe('buildReviewSummary', () => {
  afterEach(async () => {
    await clearDb();
  });

  it('summarizes counts, domains, redaction warnings, media bytes, and upload estimate', async () => {
    await clearDb();
    const traceId = 'tr_summary';
    await db.recordings.put(recording(traceId));
    await db.events.bulkPut([
      screenshot(traceId),
      video(traceId),
      action(traceId),
      network(traceId),
      annotation(traceId, 'video_started'),
    ]);
    await db.blobs.bulkPut([
      {
        blob_key: 'blob_screen',
        trace_id: traceId,
        kind: 'screenshot',
        data: sizedBlob(5),
        created_at: 2_000,
      },
      {
        blob_key: 'blob_video',
        trace_id: traceId,
        kind: 'video',
        data: sizedBlob(7),
        created_at: 3_000,
      },
    ]);

    await expect(buildReviewSummary(traceId)).resolves.toEqual({
      domains: ['example.com', 'shop.example.com'],
      durationMs: 6_000,
      eventCounts: {
        action: 1,
        network_request: 1,
        screenshot: 1,
        video_chunk: 1,
        annotation: 1,
      },
      annotationCounts: {
        video_started: 1,
      },
      media: {
        screenshots: 1,
        videoChunks: 1,
        bytes: 12,
      },
      volume: {
        durationMinutes: 0.1,
        eventsPerMinute: 50,
        eventRates: {
          action: 10,
          annotation: 10,
          network_request: 10,
          screenshot: 10,
          video_chunk: 10,
        },
        actionCounts: { input: 1 },
        topActionTypes: [{ actionType: 'input', count: 1 }],
        topEventKinds: [
          { kind: 'action', count: 1 },
          { kind: 'annotation', count: 1 },
          { kind: 'network_request', count: 1 },
          { kind: 'screenshot', count: 1 },
          { kind: 'video_chunk', count: 1 },
        ],
      },
      redactionWarnings: [
        'classified_email: 1',
        'classified_token: 1',
        'video may contain visible sensitive text; review or exclude media if necessary',
      ],
      uploadBytesEstimate: expect.any(Number),
    });

    const summary = await buildReviewSummary(traceId);
    expect(summary.uploadBytesEstimate).toBeGreaterThan(12);
  });

  it('counts uploadable media blobs and warns when captured media exists', async () => {
    await clearDb();
    const traceId = 'tr_partial_media';
    await db.recordings.put(recording(traceId));
    await db.events.bulkPut([
      screenshot(traceId),
      {
        ...screenshot(traceId),
        event_id: 'ev_screen_missing',
        blob_key: 'blob_missing',
        timestamp: 2_500,
      },
      video(traceId),
    ]);
    await db.blobs.bulkPut([
      {
        blob_key: 'blob_screen',
        trace_id: traceId,
        kind: 'screenshot',
        data: sizedBlob(5),
        created_at: 2_000,
      },
      {
        blob_key: 'blob_video',
        trace_id: traceId,
        kind: 'video',
        data: sizedBlob(9),
        created_at: 3_000,
        excluded_from_upload: true,
        excluded_at: 4_000,
      },
    ]);

    const summary = await buildReviewSummary(traceId);

    expect(summary.media).toEqual({
      screenshots: 1,
      videoChunks: 0,
      bytes: 5,
    });
    expect(summary.redactionWarnings).toContain(
      'video may contain visible sensitive text; review or exclude media if necessary'
    );
  });

  it('reports event rates and top action types for trace volume QA', async () => {
    await clearDb();
    const traceId = 'tr_volume';
    await db.recordings.put(recording(traceId));
    await db.events.bulkPut([
      ...Array.from({ length: 4 }, (_, index) =>
        actionOf(traceId, {
          event_id: `ev_wheel_${index}`,
          timestamp: 1_000 + index * 100,
          action_type: 'wheel',
        })
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        actionOf(traceId, {
          event_id: `ev_click_${index}`,
          timestamp: 2_000 + index * 100,
          action_type: 'click',
        })
      ),
      ...Array.from({ length: 3 }, (_, index) => ({
        event_id: `ev_dom_${index}`,
        trace_id: traceId,
        tab_id: 1,
        timestamp: 3_000 + index * 100,
        url: 'https://example.test/form',
        kind: 'dom_snapshot' as const,
        hash: `hash_${index}`,
        nodes: [],
      })),
    ]);

    const summary = await buildReviewSummary(traceId);

    expect(summary.volume).toEqual({
      durationMinutes: 0.1,
      eventsPerMinute: 90,
      eventRates: {
        action: 60,
        dom_snapshot: 30,
      },
      actionCounts: { click: 2, wheel: 4 },
      topActionTypes: [
        { actionType: 'wheel', count: 4 },
        { actionType: 'click', count: 2 },
      ],
      topEventKinds: [
        { kind: 'action', count: 6 },
        { kind: 'dom_snapshot', count: 3 },
      ],
    });
  });
});

function sizedBlob(size: number): Blob {
  return { size } as Blob;
}

function actionOf(
  traceId: string,
  patch: Partial<Omit<ActionEvent, 'value'>> = {}
): ActionEvent {
  const { value: _value, ...base } = action(traceId);
  return {
    ...base,
    ...patch,
  };
}
