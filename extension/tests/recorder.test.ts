import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { requestIdentityBundle } from '@/identity/client';
import {
  appendEvent,
  pauseCapture,
  resumeCapture,
  saveReviewMetadata,
  startRecording,
  stopRecording,
  updateReviewMetadata,
} from '@/recording/recorder';
import { DEFAULT_CONFIG, db, setConfig } from '@/storage/db';
import type {
  NavigationEvent,
  NetworkRequestEvent,
  RecordingRow,
  ScreenshotEvent,
  VideoChunkEvent,
} from '@/shared/types';
import type { Clock } from '@/shared/time';

const browserApi = vi.hoisted(() => ({
  alarms: {
    create: vi.fn(),
  },
  runtime: {
    getURL: vi.fn(),
  },
  tabs: {
    create: vi.fn(),
  },
}));

vi.mock('wxt/browser', () => ({
  browser: browserApi,
}));

const fixedClock = (now: number, iso: string): Clock => ({
  now: () => now,
  isoNow: () => iso,
});

const baseEnvelope = (
  traceId: string,
  startedAt = '2026-06-03T00:00:00.000Z'
) => ({
  schema_version: 'journey_trace_v1' as const,
  trace_id: traceId,
  recording_mode: 'research_free_form' as const,
  started_at: startedAt,
  tags: [],
  browser: { extension_version: '0.1.0', user_agent: 'test', timezone: 'UTC' },
  summary: {
    domains: [],
    duration_ms: 0,
    event_counts: {},
    screenshot_count: 0,
    video_chunk_count: 0,
  },
});

const recordingRow = (
  traceId: string,
  status: RecordingRow['status'],
  startedAt = '2026-06-03T00:00:00.000Z'
): RecordingRow => ({
  trace_id: traceId,
  status,
  envelope: baseEnvelope(traceId, startedAt),
  created_at: 1,
  updated_at: 1,
});

const navigationEvent = (
  eventId: string,
  traceId: string,
  overrides: Partial<
    Omit<NavigationEvent, 'event_id' | 'trace_id' | 'kind' | 'nav_type'>
  > = {}
): NavigationEvent => ({
  event_id: eventId,
  trace_id: traceId,
  tab_id: 1,
  timestamp: 10,
  url: 'https://example.test/path',
  kind: 'navigation',
  nav_type: 'load',
  ...overrides,
});

const screenshotEvent = (
  eventId: string,
  traceId: string,
  overrides: Partial<
    Omit<ScreenshotEvent, 'event_id' | 'trace_id' | 'kind' | 'blob_key'>
  > = {}
): ScreenshotEvent => ({
  event_id: eventId,
  trace_id: traceId,
  tab_id: 1,
  timestamp: 20,
  url: 'https://shop.example.com/b',
  kind: 'screenshot',
  blob_key: 'blob_screen',
  ...overrides,
});

const videoChunkEvent = (
  eventId: string,
  traceId: string,
  overrides: Partial<
    Omit<
      VideoChunkEvent,
      | 'event_id'
      | 'trace_id'
      | 'kind'
      | 'blob_key'
      | 'start_timestamp'
      | 'end_timestamp'
    >
  > = {}
): VideoChunkEvent => ({
  event_id: eventId,
  trace_id: traceId,
  tab_id: 1,
  timestamp: 30,
  url: 'not a url',
  kind: 'video_chunk',
  blob_key: 'blob_video',
  start_timestamp: 25,
  end_timestamp: 30,
  ...overrides,
});

const networkEvent = (
  eventId: string,
  traceId: string
): NetworkRequestEvent => ({
  event_id: eventId,
  trace_id: traceId,
  tab_id: 1,
  timestamp: 40,
  url: 'https://api.example.test/v1/checkout',
  kind: 'network_request',
  request_id: 'req_1',
  method: 'POST',
  full_url: 'https://api.example.test/v1/checkout',
  fetch_kind: 'fetch',
  req_headers: {},
});

async function clearDb() {
  await db.events.clear();
  await db.recordings.clear();
  await db.blobs.clear();
  await db.uploadManifests.clear();
  await db.config.clear();
}

function stubChromeRuntime() {
  vi.stubGlobal('chrome', {
    alarms: {
      create: vi.fn(),
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: '9.8.7' })),
      getURL: vi.fn(() => 'chrome-extension://extension-id/'),
    },
    tabs: {
      create: vi.fn(),
    },
  });
}

describe('identity client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts identity bundle requests with bearer auth and normalized endpoint URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        identity_bundle_id: 'idb_test',
        email: 'test@example.test',
        email_password: 'secret',
        webmail_url: 'https://mail.example.test',
        persona: {},
        payment: { enabled: false },
        expires_at: '2026-06-04T00:00:00.000Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      requestIdentityBundle({
        endpointUrl: 'https://api.example.test///',
        apiKey: 'key_test',
      })
    ).resolves.toMatchObject({ identity_bundle_id: 'idb_test' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/identity-bundles',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer key_test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ purpose: 'research_free_form' }),
      }
    );
  });
});

describe('recorder lifecycle', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await clearDb();
  });

  afterEach(async () => {
    await clearDb();
    vi.unstubAllGlobals();
  });

  it('starts a draft recording with an identity bundle and persisted lifecycle annotation', async () => {
    stubChromeRuntime();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          identity_bundle_id: 'idb_start',
          email: 'start@example.test',
          email_password: 'secret',
          webmail_url: 'https://mail.example.test',
          persona: { name: 'Start User' },
          payment: { enabled: false },
          expires_at: '2026-06-04T00:00:00.000Z',
        }),
      })
    );
    await setConfig({
      endpoint_url: 'https://api.example.test',
      api_key: 'key_start',
    });

    const row = await startRecording(
      fixedClock(100, '2026-06-03T00:00:00.100Z')
    );
    const persisted = await db.recordings.get(row.trace_id);
    const events = await db.events
      .where('trace_id')
      .equals(row.trace_id)
      .toArray();

    expect(row.status).toBe('draft');
    expect(row.identity?.identity_bundle_id).toBe('idb_start');
    expect(row.envelope).toMatchObject({
      trace_id: row.trace_id,
      recording_mode: 'research_free_form',
      identity_bundle_id: 'idb_start',
      browser: {
        extension_version: '9.8.7',
      },
    });
    expect(persisted?.status).toBe('draft');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      trace_id: row.trace_id,
      kind: 'annotation',
      annotation_type: 'resume',
      text: 'recording_started:chrome',
    });
  });

  it('starts real-user recordings without requesting generated identity', async () => {
    stubChromeRuntime();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await setConfig({
      endpoint_url: 'https://api.example.test',
      api_key: 'key_real',
      recording_mode: 'real_user_free_form',
    });

    const row = await startRecording(
      fixedClock(100, '2026-06-03T00:00:00.100Z')
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(row.identity).toBeUndefined();
    expect(row.envelope).toMatchObject({
      recording_mode: 'real_user_free_form',
    });
    expect(row.envelope).not.toHaveProperty('identity_bundle_id');
  });

  it('requires endpoint config before starting a recording', async () => {
    await db.config.put(DEFAULT_CONFIG);

    await expect(
      startRecording(fixedClock(100, '2026-06-03T00:00:00.100Z'))
    ).rejects.toThrow(
      'upload endpoint and API key are required before recording'
    );
  });

  it('rolls back startRecording when the start annotation cannot be persisted', async () => {
    stubChromeRuntime();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          identity_bundle_id: 'idb_rollback',
          email: 'rollback@example.test',
          email_password: 'secret',
          webmail_url: 'https://mail.example.test',
          persona: {},
          payment: { enabled: false },
          expires_at: '2026-06-04T00:00:00.000Z',
        }),
      })
    );
    await setConfig({
      endpoint_url: 'https://api.example.test',
      api_key: 'key_start',
    });
    db.events.hook('creating', failOnce('event insert failed'));

    await expect(
      startRecording(fixedClock(100, '2026-06-03T00:00:00.100Z'))
    ).rejects.toThrow('event insert failed');

    await expect(db.recordings.count()).resolves.toBe(0);
    await expect(db.events.count()).resolves.toBe(0);
  });

  it('saveReviewMetadata rejects empty label', async () => {
    await db.recordings.put(recordingRow('tr_label', 'review_required'));

    await expect(
      saveReviewMetadata({ traceId: 'tr_label', label: '   ' })
    ).rejects.toThrow('label is required');

    const row = await db.recordings.get('tr_label');
    expect(row?.status).toBe('review_required');
    expect(row?.envelope).not.toHaveProperty('label');
  });

  it('saveReviewMetadata rejects draft recordings and leaves them unchanged', async () => {
    await db.recordings.put(recordingRow('tr_active', 'draft'));

    await expect(
      saveReviewMetadata({ traceId: 'tr_active', label: 'active journey' })
    ).rejects.toThrow(
      'recording must be review_required before metadata can be updated'
    );

    const row = await db.recordings.get('tr_active');
    expect(row?.status).toBe('draft');
    expect(row?.envelope).not.toHaveProperty('label');
  });

  it('appendEvent ignores events for non-draft recordings', async () => {
    await db.recordings.put(recordingRow('tr_reviewed', 'review_required'));

    await appendEvent(navigationEvent('ev_ignored', 'tr_reviewed'));

    await expect(db.events.get('ev_ignored')).resolves.toBeUndefined();
  });

  it('appendEvent persists events only while the recording is a draft', async () => {
    await db.recordings.put(recordingRow('tr_draft', 'draft'));

    await appendEvent(navigationEvent('ev_saved', 'tr_draft'));

    await expect(db.events.get('ev_saved')).resolves.toMatchObject({
      event_id: 'ev_saved',
      trace_id: 'tr_draft',
      kind: 'navigation',
    });
  });

  it('pauses and resumes capture without changing upload status', async () => {
    await db.recordings.put(recordingRow('tr_pause', 'draft'));

    const paused = await pauseCapture(
      'tr_pause',
      fixedClock(500, '2026-06-03T00:00:00.500Z')
    );
    await appendEvent(navigationEvent('ev_during_pause', 'tr_pause'));
    const resumed = await resumeCapture(
      'tr_pause',
      fixedClock(600, '2026-06-03T00:00:00.600Z')
    );
    const annotations = await db.events
      .where('trace_id')
      .equals('tr_pause')
      .and((event) => event.kind === 'annotation')
      .toArray();

    expect(paused).toMatchObject({ status: 'draft', capture_paused: true });
    expect(resumed).toMatchObject({ status: 'draft', capture_paused: false });
    await expect(db.events.get('ev_during_pause')).resolves.toBeUndefined();
    expect(
      annotations.map((event) =>
        event.kind === 'annotation' ? event.annotation_type : null
      )
    ).toEqual(['pause', 'resume']);
    expect(
      annotations.map((event) =>
        event.kind === 'annotation' ? event.text : null
      )
    ).toEqual(['capture_paused', 'capture_resumed']);
  });

  it('clears capture pause state when stopping a paused draft', async () => {
    await db.recordings.put(recordingRow('tr_stop_paused', 'draft'));

    await pauseCapture(
      'tr_stop_paused',
      fixedClock(500, '2026-06-03T00:00:00.500Z')
    );
    const stopped = await stopRecording(
      'tr_stop_paused',
      fixedClock(600, '2026-06-03T00:00:00.600Z')
    );

    expect(stopped).toMatchObject({
      status: 'review_required',
      capture_paused: false,
    });
  });

  it('rejects pausing or resuming non-draft recordings', async () => {
    await db.recordings.put(recordingRow('tr_review', 'review_required'));

    await expect(pauseCapture('tr_review')).rejects.toThrow(
      'recording must be draft before capture can be paused'
    );
    await expect(resumeCapture('tr_review')).rejects.toThrow(
      'recording must be draft before capture can be resumed'
    );
  });

  it('appendEvent writes events inside a transaction that also covers recording state', async () => {
    await db.recordings.put(recordingRow('tr_append_tx', 'draft'));
    let storeNames: string[] = [];
    db.events.hook('creating', () => {
      storeNames = [
        ...((
          Dexie.currentTransaction as unknown as {
            storeNames?: string[];
          } | null
        )?.storeNames ?? []),
      ];
    });

    await appendEvent(navigationEvent('ev_tx', 'tr_append_tx'));

    expect(storeNames).toEqual(
      expect.arrayContaining(['recordings', 'events'])
    );
  });

  it('stopRecording sets review_required and summarizes persisted event domains', async () => {
    await db.recordings.put(
      recordingRow('tr_stop', 'draft', '1970-01-01T00:00:00.000Z')
    );
    await db.events.bulkPut([
      navigationEvent('ev_one', 'tr_stop', {
        timestamp: 10,
        url: 'https://www.example.com/a',
      }),
      screenshotEvent('ev_two', 'tr_stop'),
      videoChunkEvent('ev_three', 'tr_stop'),
      networkEvent('ev_four', 'tr_stop'),
    ]);

    const row = await stopRecording(
      'tr_stop',
      fixedClock(1_000, '2026-06-03T00:00:01.000Z')
    );
    const stopEvents = await db.events
      .where('trace_id')
      .equals('tr_stop')
      .and((event) => event.kind === 'annotation')
      .toArray();

    expect(row.status).toBe('review_required');
    expect(row.envelope.ended_at).toBe('2026-06-03T00:00:01.000Z');
    expect(row.envelope.summary).toEqual({
      domains: ['example.com', 'shop.example.com'],
      duration_ms: 1_000,
      event_counts: {
        annotation: 1,
        navigation: 1,
        network_request: 1,
        screenshot: 1,
        video_chunk: 1,
      },
      screenshot_count: 1,
      video_chunk_count: 1,
    });
    expect(stopEvents).toHaveLength(1);
    expect(stopEvents[0]).toMatchObject({
      annotation_type: 'pause',
      text: 'recording_stopped',
    });
  });

  it('stopRecording rejects non-draft recordings and leaves status unchanged', async () => {
    await db.recordings.put(recordingRow('tr_queued', 'queued'));

    await expect(
      stopRecording('tr_queued', fixedClock(1_000, '2026-06-03T00:00:01.000Z'))
    ).rejects.toThrow('recording must be draft before it can be stopped');

    const row = await db.recordings.get('tr_queued');
    const events = await db.events
      .where('trace_id')
      .equals('tr_queued')
      .toArray();
    expect(row?.status).toBe('queued');
    expect(row?.envelope).not.toHaveProperty('ended_at');
    expect(events).toHaveLength(0);
  });

  it('rolls back stopRecording when the row update cannot be persisted', async () => {
    await db.recordings.put(
      recordingRow('tr_stop_rollback', 'draft', '1970-01-01T00:00:00.000Z')
    );
    db.recordings.hook('updating', failOnce('recording update failed'));

    await expect(
      stopRecording(
        'tr_stop_rollback',
        fixedClock(1_000, '2026-06-03T00:00:01.000Z')
      )
    ).rejects.toThrow('recording update failed');

    const row = await db.recordings.get('tr_stop_rollback');
    const events = await db.events
      .where('trace_id')
      .equals('tr_stop_rollback')
      .toArray();
    expect(row?.status).toBe('draft');
    expect(row?.envelope).not.toHaveProperty('ended_at');
    expect(events).toHaveLength(0);
  });

  it('saveReviewMetadata queues reviewed recordings with a trimmed label', async () => {
    await db.recordings.put(recordingRow('tr_queue', 'review_required'));

    const row = await saveReviewMetadata({
      traceId: 'tr_queue',
      label: '  fill out survey  ',
      description: '  short run  ',
      tags: ['survey'],
      clock: fixedClock(2_000, '2026-06-03T00:00:02.000Z'),
    });

    expect(row.status).toBe('queued');
    expect(row.reviewed_at).toBe(2_000);
    expect(row.envelope).toMatchObject({
      label: 'fill out survey',
      description: 'short run',
      tags: ['survey'],
    });
  });

  it('updateReviewMetadata saves review details without queueing upload', async () => {
    await db.recordings.put(recordingRow('tr_save_details', 'review_required'));

    const row = await updateReviewMetadata({
      traceId: 'tr_save_details',
      label: '  browser checkout  ',
      description: '  includes payment form  ',
      tags: ['checkout', 'payment'],
      clock: fixedClock(3_000, '2026-06-03T00:00:03.000Z'),
    });

    expect(row.status).toBe('review_required');
    expect(row.reviewed_at).toBeUndefined();
    expect(row.updated_at).toBe(3_000);
    expect(row.envelope).toMatchObject({
      label: 'browser checkout',
      description: 'includes payment form',
      tags: ['checkout', 'payment'],
    });
  });
});

function failOnce(message: string) {
  let failed = false;
  return () => {
    if (failed) return;
    failed = true;
    throw new Error(message);
  };
}
