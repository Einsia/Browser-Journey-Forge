import { collectEventDomains } from '@/shared/events';
import type {
  ActionEvent,
  CapturedEvent,
  RecordingRow,
  RedactionClass,
} from '@/shared/types';
import { db } from '@/storage/db';

const MEDIA_PRIVACY_WARNING =
  'video may contain visible sensitive text; review or exclude media if necessary';

export type ReviewSummary = {
  domains: string[];
  durationMs: number;
  eventCounts: Record<string, number>;
  annotationCounts: Record<string, number>;
  media: { screenshots: number; videoChunks: number; bytes: number };
  volume: TraceVolumeSummary;
  redactionWarnings: string[];
  uploadBytesEstimate: number;
};

export type TraceVolumeSummary = {
  durationMinutes: number;
  eventsPerMinute: number;
  eventRates: Record<string, number>;
  actionCounts: Partial<Record<ActionEvent['action_type'], number>>;
  topActionTypes: Array<{
    actionType: ActionEvent['action_type'];
    count: number;
  }>;
  topEventKinds: Array<{ kind: string; count: number }>;
};

export async function buildReviewSummary(
  traceId: string
): Promise<ReviewSummary> {
  const [recording, events, blobs] = await Promise.all([
    db.recordings.get(traceId),
    db.events.where('trace_id').equals(traceId).toArray(),
    db.blobs.where('trace_id').equals(traceId).toArray(),
  ]);

  if (!recording) throw new Error(`recording not found: ${traceId}`);

  const domains = new Set<string>();
  const eventCounts: Record<string, number> = {};
  const annotationCounts: Record<string, number> = {};
  const actionCounts: Partial<Record<ActionEvent['action_type'], number>> = {};
  const redactionCounts: Partial<Record<RedactionClass, number>> = {};
  let screenshotEvents = 0;
  let videoChunkEvents = 0;

  for (const event of events) {
    eventCounts[event.kind] = (eventCounts[event.kind] ?? 0) + 1;
    if (event.kind === 'action') {
      actionCounts[event.action_type] =
        (actionCounts[event.action_type] ?? 0) + 1;
    }
    if (event.kind === 'annotation') {
      annotationCounts[event.annotation_type] =
        (annotationCounts[event.annotation_type] ?? 0) + 1;
    }
    collectEventDomains(domains, event);
    if (event.kind === 'screenshot') screenshotEvents += 1;
    if (event.kind === 'video_chunk') videoChunkEvents += 1;
    collectRedactions(event, redactionCounts);
  }

  const uploadableBlobs = blobs.filter((blob) => !blob.excluded_from_upload);
  let mediaBytes = 0;
  let screenshotBlobs = 0;
  let videoBlobs = 0;
  for (const blob of uploadableBlobs) {
    mediaBytes += await blobByteLength(blob.data);
    if (blob.kind === 'screenshot') screenshotBlobs += 1;
    if (blob.kind === 'video') videoBlobs += 1;
  }

  const eventsBytes = new Blob([JSON.stringify(events)]).size;
  const envelopeBytes = new Blob([JSON.stringify(recording.envelope)]).size;
  const durationMs = durationFor(recording, events);

  return {
    domains: [...domains].sort(),
    durationMs,
    eventCounts,
    annotationCounts,
    media: {
      screenshots: blobs.length > 0 ? screenshotBlobs : screenshotEvents,
      videoChunks: blobs.length > 0 ? videoBlobs : videoChunkEvents,
      bytes: mediaBytes,
    },
    volume: buildTraceVolumeSummary(
      events,
      eventCounts,
      actionCounts,
      durationMs
    ),
    redactionWarnings: buildRedactionWarnings(
      redactionCounts,
      screenshotEvents + videoChunkEvents + screenshotBlobs + videoBlobs > 0
    ),
    uploadBytesEstimate: envelopeBytes + eventsBytes + mediaBytes,
  };
}

function buildTraceVolumeSummary(
  events: CapturedEvent[],
  eventCounts: Record<string, number>,
  actionCounts: Partial<Record<ActionEvent['action_type'], number>>,
  durationMs: number
): TraceVolumeSummary {
  const durationMinutes = roundRate(durationMs / 60_000);
  const rateDenominatorMinutes = Math.max(durationMs / 60_000, 1 / 60);
  const eventRates = Object.fromEntries(
    Object.entries(eventCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, count]) => [kind, roundRate(count / rateDenominatorMinutes)])
  );

  return {
    durationMinutes,
    eventsPerMinute: roundRate(events.length / rateDenominatorMinutes),
    eventRates,
    actionCounts,
    topActionTypes: Object.entries(actionCounts)
      .sort(
        ([leftType, leftCount], [rightType, rightCount]) =>
          (rightCount ?? 0) - (leftCount ?? 0) ||
          leftType.localeCompare(rightType)
      )
      .slice(0, 5)
      .map(([actionType, count]) => ({
        actionType: actionType as ActionEvent['action_type'],
        count: count ?? 0,
      })),
    topEventKinds: Object.entries(eventCounts)
      .sort(
        ([leftKind, leftCount], [rightKind, rightCount]) =>
          rightCount - leftCount || leftKind.localeCompare(rightKind)
      )
      .slice(0, 5)
      .map(([kind, count]) => ({ kind, count })),
  };
}

function roundRate(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildRedactionWarnings(
  redactionCounts: Partial<Record<RedactionClass, number>>,
  hasMedia: boolean
): string[] {
  const warnings = Object.entries(redactionCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([redactionClass, count]) => `${redactionClass}: ${count}`);
  if (hasMedia) warnings.push(MEDIA_PRIVACY_WARNING);
  return warnings;
}

async function blobByteLength(blob: Blob): Promise<number> {
  if (Number.isFinite(blob.size)) return blob.size;
  if (typeof blob.arrayBuffer === 'function')
    return (await blob.arrayBuffer()).byteLength;
  return 0;
}

function durationFor(recording: RecordingRow, events: CapturedEvent[]): number {
  const started = Date.parse(recording.envelope.started_at);
  const ended = recording.envelope.ended_at
    ? Date.parse(recording.envelope.ended_at)
    : NaN;
  if (Number.isFinite(started) && Number.isFinite(ended)) {
    return Math.max(0, ended - started);
  }

  if (events.length > 0) {
    const timestamps = events.map((event) => event.timestamp);
    return Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
  }

  return Math.max(0, recording.updated_at - recording.created_at);
}

function collectRedactions(
  value: unknown,
  counts: Partial<Record<RedactionClass, number>>
): void {
  if (!value || typeof value !== 'object') return;
  const maybe = value as {
    redaction?: { classes?: RedactionClass[] };
    redactionClasses?: RedactionClass[];
  };
  for (const redactionClass of maybe.redaction?.classes ?? []) {
    counts[redactionClass] = (counts[redactionClass] ?? 0) + 1;
  }
  for (const redactionClass of maybe.redactionClasses ?? []) {
    counts[redactionClass] = (counts[redactionClass] ?? 0) + 1;
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) collectRedactions(item, counts);
    } else if (child && typeof child === 'object') {
      collectRedactions(child, counts);
    }
  }
}
