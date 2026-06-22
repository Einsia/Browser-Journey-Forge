import { getBrowserAdapter } from '@/browser';
import { requestIdentityBundle } from '@/identity/client';
import { IDENTITY_BEST_EFFORT } from '@/shared/product';
import { collectEventDomains } from '@/shared/events';
import { createId } from '@/shared/id';
import { systemClock, type Clock } from '@/shared/time';
import type { CapturedEvent, IdentityBundle, RecordingRow, TraceSummary } from '@/shared/types';
import { db, getConfig } from '@/storage/db';

export async function startRecording(
  clock: Clock = systemClock,
  opts?: { taskCaseId?: string }
): Promise<RecordingRow> {
  const config = await getConfig();
  if (!config.endpoint_url || !config.api_key) {
    throw new Error(
      'upload endpoint and API key are required before recording'
    );
  }

  // Identity bundles are a research concept. In the product build the local
  // server has no identity endpoint, so this is best-effort: a failure (or a
  // server that doesn't support it) must never block recording.
  let identity: IdentityBundle | undefined;
  if (config.recording_mode === 'research_free_form') {
    try {
      identity = await requestIdentityBundle({
        endpointUrl: config.endpoint_url,
        apiKey: config.api_key,
      });
    } catch (err) {
      if (!IDENTITY_BEST_EFFORT) throw err;
      console.warn('[journey-forge] identity bundle unavailable; continuing without it', err);
    }
  }
  const adapter = getBrowserAdapter();
  const captureSettings = {
    ...config.capture,
    screenshots: false,
    video: adapter.capabilities.video && config.capture.video,
  };
  const traceId = createId('tr_');
  const now = clock.now();
  const row: RecordingRow = {
    trace_id: traceId,
    status: 'draft',
    envelope: {
      schema_version: 'journey_trace_v1',
      trace_id: traceId,
      recording_mode: config.recording_mode,
      started_at: clock.isoNow(),
      tags: [],
      ...(opts?.taskCaseId ? { task_case_id: opts.taskCaseId, label: opts.taskCaseId } : {}),
      ...(identity ? { identity_bundle_id: identity.identity_bundle_id } : {}),
      capture_settings: captureSettings,
      browser: {
        extension_version: chrome.runtime.getManifest().version ?? '0.0.0',
        user_agent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      summary: {
        domains: [],
        duration_ms: 0,
        event_counts: {},
        screenshot_count: 0,
        video_chunk_count: 0,
      },
    },
    ...(identity ? { identity } : {}),
    created_at: now,
    updated_at: now,
  };

  await db.transaction('rw', db.recordings, db.events, async () => {
    await db.recordings.put(row);
    await db.events.put({
      event_id: createId('ev_'),
      trace_id: traceId,
      tab_id: -1,
      timestamp: clock.now(),
      url: '',
      kind: 'annotation',
      annotation_type: 'resume',
      text: `recording_started:${adapter.capabilities.browser}`,
    });
  });

  return row;
}

export async function stopRecording(
  traceId: string,
  clock: Clock = systemClock
): Promise<RecordingRow> {
  const now = clock.now();
  return await db.transaction('rw', db.recordings, db.events, async () => {
    const row = await db.recordings.get(traceId);
    if (!row) throw new Error(`recording not found: ${traceId}`);
    if (row.status !== 'draft') {
      throw new Error('recording must be draft before it can be stopped');
    }

    await db.events.put({
      event_id: createId('ev_'),
      trace_id: traceId,
      tab_id: -1,
      timestamp: now,
      url: '',
      kind: 'annotation',
      annotation_type: 'pause',
      text: 'recording_stopped',
    });

    const updated: RecordingRow = {
      ...row,
      status: 'review_required',
      capture_paused: false,
      envelope: {
        ...row.envelope,
        ended_at: clock.isoNow(),
        summary: await summarizeTrace(traceId, row.envelope.started_at, now),
      },
      updated_at: now,
    };

    await db.recordings.put(updated);
    return updated;
  });
}

export async function pauseCapture(
  traceId: string,
  clock: Clock = systemClock
): Promise<RecordingRow> {
  const now = clock.now();
  return await db.transaction('rw', db.recordings, db.events, async () => {
    const row = await db.recordings.get(traceId);
    if (!row) throw new Error(`recording not found: ${traceId}`);
    if (row.status !== 'draft') {
      throw new Error('recording must be draft before capture can be paused');
    }
    if (row.capture_paused) return row;

    await db.events.put({
      event_id: createId('ev_'),
      trace_id: traceId,
      tab_id: -1,
      timestamp: now,
      url: '',
      kind: 'annotation',
      annotation_type: 'pause',
      text: 'capture_paused',
    });

    const updated: RecordingRow = {
      ...row,
      capture_paused: true,
      updated_at: now,
    };
    await db.recordings.put(updated);
    return updated;
  });
}

export async function resumeCapture(
  traceId: string,
  clock: Clock = systemClock
): Promise<RecordingRow> {
  const now = clock.now();
  return await db.transaction('rw', db.recordings, db.events, async () => {
    const row = await db.recordings.get(traceId);
    if (!row) throw new Error(`recording not found: ${traceId}`);
    if (row.status !== 'draft') {
      throw new Error('recording must be draft before capture can be resumed');
    }
    if (!row.capture_paused) return row;

    await db.events.put({
      event_id: createId('ev_'),
      trace_id: traceId,
      tab_id: -1,
      timestamp: now,
      url: '',
      kind: 'annotation',
      annotation_type: 'resume',
      text: 'capture_resumed',
    });

    const updated: RecordingRow = {
      ...row,
      capture_paused: false,
      updated_at: now,
    };
    await db.recordings.put(updated);
    return updated;
  });
}

export async function saveReviewMetadata(opts: {
  traceId: string;
  label: string;
  description?: string;
  tags?: string[];
  clock?: Clock;
}): Promise<RecordingRow> {
  const updatedMetadata = await updateReviewMetadata(opts);
  const clock = opts.clock ?? systemClock;
  const now = clock.now();
  const updated: RecordingRow = {
    ...updatedMetadata,
    status: 'queued',
    reviewed_at: now,
    updated_at: now,
  };
  await db.recordings.put(updated);

  return updated;
}

export async function updateReviewMetadata(opts: {
  traceId: string;
  label: string;
  description?: string;
  tags?: string[];
  clock?: Clock;
}): Promise<RecordingRow> {
  const row = await db.recordings.get(opts.traceId);
  if (!row) throw new Error(`recording not found: ${opts.traceId}`);
  if (row.status !== 'review_required') {
    throw new Error(
      'recording must be review_required before metadata can be updated'
    );
  }

  const label = opts.label.trim();
  if (!label) throw new Error('label is required');

  const clock = opts.clock ?? systemClock;
  const now = clock.now();
  const envelope = {
    ...row.envelope,
    label,
    tags: opts.tags ?? [],
  };
  const description = opts.description?.trim();
  if (description) {
    envelope.description = description;
  } else {
    delete envelope.description;
  }

  const updated: RecordingRow = {
    ...row,
    envelope,
    updated_at: now,
  };
  await db.recordings.put(updated);

  return updated;
}

export async function appendEvent(event: CapturedEvent): Promise<void> {
  await db.transaction('rw', db.recordings, db.events, async () => {
    const row = await db.recordings.get(event.trace_id);
    if (!row || row.status !== 'draft') return;
    if (row.capture_paused && event.kind !== 'annotation') return;

    await db.events.put(event);
  });
}

async function summarizeTrace(
  traceId: string,
  startedAt: string,
  endedAt: number
): Promise<TraceSummary> {
  const events = await db.events.where('trace_id').equals(traceId).toArray();
  const domains = new Set<string>();
  const eventCounts: Record<string, number> = {};
  let screenshotCount = 0;
  let videoChunkCount = 0;

  for (const event of events) {
    eventCounts[event.kind] = (eventCounts[event.kind] ?? 0) + 1;
    collectEventDomains(domains, event);
    if (event.kind === 'screenshot') screenshotCount += 1;
    if (event.kind === 'video_chunk') videoChunkCount += 1;
  }

  return {
    domains: [...domains].sort(),
    duration_ms: Math.max(0, endedAt - Date.parse(startedAt)),
    event_counts: eventCounts,
    screenshot_count: screenshotCount,
    video_chunk_count: videoChunkCount,
  };
}
