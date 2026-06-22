import { afterEach, describe, expect, it } from 'vitest';
import { subscribeLocalStoreChanges } from '@/storage/live-refresh';
import { DEFAULT_CONFIG, JourneyForgeDB } from '@/storage/db';

describe('local store live refresh', () => {
  let testDb: JourneyForgeDB | null = null;

  afterEach(async () => {
    if (testDb) {
      await testDb.delete();
      testDb.close();
      testDb = null;
    }
  });

  it('notifies after config and recording changes without firing initial load', async () => {
    testDb = new JourneyForgeDB(`journey-forge-live-refresh-${crypto.randomUUID()}`);
    let calls = 0;
    const subscription = subscribeLocalStoreChanges(() => {
      calls += 1;
    }, { debounceMs: 0, database: testDb });

    await subscription.ready;
    await settle();
    expect(calls).toBe(0);

    await testDb.config.put({ ...DEFAULT_CONFIG, endpoint_url: 'https://api.example.test' });
    await waitFor(() => calls === 1);

    await testDb.recordings.put(recording('tr_live_refresh'));
    await waitFor(() => calls === 2);

    subscription.unsubscribe();
  });

  it('debounces bursty event writes into one refresh', async () => {
    testDb = new JourneyForgeDB(`journey-forge-live-refresh-${crypto.randomUUID()}`);
    let calls = 0;
    const subscription = subscribeLocalStoreChanges(() => {
      calls += 1;
    }, { debounceMs: 20, database: testDb });

    await subscription.ready;
    await settle();
    await testDb.recordings.put(recording('tr_event_burst'));
    await waitFor(() => calls === 1);

    await testDb.events.bulkPut([
      event('ev_1', 'tr_event_burst', 1),
      event('ev_2', 'tr_event_burst', 2),
      event('ev_3', 'tr_event_burst', 3)
    ]);

    await waitFor(() => calls === 2);
    await settle(40);
    expect(calls).toBe(2);

    subscription.unsubscribe();
  });
});

function recording(traceId: string) {
  return {
    trace_id: traceId,
    status: 'draft' as const,
    created_at: 1,
    updated_at: 1,
    envelope: {
      schema_version: 'journey_trace_v1' as const,
      trace_id: traceId,
      recording_mode: 'research_free_form' as const,
      started_at: '2026-06-04T00:00:00.000Z',
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

function event(eventId: string, traceId: string, timestamp: number) {
  return {
    event_id: eventId,
    trace_id: traceId,
    tab_id: 1,
    timestamp,
    url: 'https://example.test',
    kind: 'action' as const,
    action_type: 'click' as const
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) {
      throw new Error('timed out waiting for live refresh notification');
    }
    await settle(10);
  }
}

function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
