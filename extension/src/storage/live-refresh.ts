import { liveQuery } from 'dexie';
import { db, type JourneyForgeDB } from '@/storage/db';

export type LocalStoreSubscription = {
  ready: Promise<void>;
  unsubscribe(): void;
};

export type LocalStoreRefreshOptions = {
  debounceMs?: number;
  fireImmediately?: boolean;
  database?: JourneyForgeDB;
};

export function subscribeLocalStoreChanges(
  onChange: () => void,
  options: LocalStoreRefreshOptions = {}
): LocalStoreSubscription {
  const database = options.database ?? db;
  const debounceMs = options.debounceMs ?? 200;
  const baseline = localStoreVersion(database);
  let firstEmission = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const subscription = liveQuery(() => localStoreVersion(database)).subscribe({
    next(version) {
      void baseline.then((baselineVersion) => {
        if (closed) return;
        if (firstEmission) {
          firstEmission = false;
          if (!options.fireImmediately && version === baselineVersion) return;
        }
        schedule();
      });
    },
    error() {
      if (!closed) {
        schedule();
      }
    }
  });

  function schedule(): void {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) onChange();
    }, debounceMs);
  }

  return {
    ready: baseline.then(() => undefined),
    unsubscribe() {
      closed = true;
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    }
  };
}

async function localStoreVersion(database: JourneyForgeDB): Promise<string> {
  const [configRows, recordings, eventCount, latestEvent, blobs, manifests] = await Promise.all([
    database.config.toArray(),
    database.recordings.toArray(),
    database.events.count(),
    database.events.orderBy('timestamp').last(),
    database.blobs.toArray(),
    database.uploadManifests.toArray()
  ]);

  return JSON.stringify({
    config: configRows[0] ?? null,
    recordings: recordings
      .map((recording) => ({
        trace_id: recording.trace_id,
        status: recording.status,
        capture_paused: recording.capture_paused,
        updated_at: recording.updated_at,
        upload_id: recording.upload_id,
        last_error: recording.last_error,
        summary: recording.envelope.summary,
        capture_settings: recording.envelope.capture_settings
      }))
      .sort((left, right) => left.trace_id.localeCompare(right.trace_id)),
    events: {
      count: eventCount,
      latest_event_id: latestEvent?.event_id,
      latest_trace_id: latestEvent?.trace_id,
      latest_timestamp: latestEvent?.timestamp
    },
    blobs: blobs
      .map((blob) => ({
        blob_key: blob.blob_key,
        trace_id: blob.trace_id,
        kind: blob.kind,
        created_at: blob.created_at,
        excluded_from_upload: blob.excluded_from_upload,
        excluded_at: blob.excluded_at,
        sha256: blob.sha256
      }))
      .sort((left, right) => left.blob_key.localeCompare(right.blob_key)),
    manifests: manifests
      .map((manifest) => ({
        trace_id: manifest.trace_id,
        upload_id: manifest.upload_id,
        finalized: manifest.finalized,
        chunks: manifest.chunks.map((chunk) => ({
          index: chunk.index,
          uploaded: chunk.uploaded,
          bytes: chunk.bytes,
          sha256: chunk.sha256
        }))
      }))
      .sort((left, right) => left.trace_id.localeCompare(right.trace_id))
  });
}
