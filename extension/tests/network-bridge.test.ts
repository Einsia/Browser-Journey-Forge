import { describe, expect, it } from 'vitest';
import { installNetworkBridge } from '@/capture/network-bridge';
import { NETWORK_EVENT_PREFIX, networkEventName } from '@/capture/network-events';
import type { CapturedEvent, NetworkRequestEvent } from '@/shared/types';

describe('network bridge', () => {
  it('listens only on the per-recording event name without storing channel in payload', () => {
    const events: unknown[] = [];
    const channel = 'channel_good';
    const eventName = networkEventName(channel);
    const bridge = installNetworkBridge({
      traceId: 'tr_test',
      channel,
      sendEvent: (event) => {
        events.push(event);
      }
    });

    window.dispatchEvent(
      new CustomEvent(`${NETWORK_EVENT_PREFIX}fixed`, {
        detail: {
          phase: 'request',
          requestId: 'net_1',
          fetchKind: 'fetch',
          method: 'POST',
          url: 'https://example.test/api'
        }
      })
    );

    window.dispatchEvent(
      new CustomEvent(eventName, {
        detail: {
          phase: 'request',
          requestId: 'net_2',
          fetchKind: 'fetch',
          method: 'POST',
          url: 'https://example.test/api',
          channel: 'must_not_be_used'
        }
      })
    );

    bridge.stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'network_request', request_id: 'net_2' });
    expect(JSON.stringify(events[0])).not.toContain('must_not_be_used');
  });

  it('rejects oversized bodies before forwarding to background', () => {
    const events: unknown[] = [];
    const channel = 'channel_good';
    const bridge = installNetworkBridge({
      traceId: 'tr_test',
      channel,
      sendEvent: (event) => {
        events.push(event);
      }
    });

    window.dispatchEvent(
      new CustomEvent(networkEventName(channel), {
        detail: {
          phase: 'request',
          requestId: 'net_big',
          fetchKind: 'fetch',
          method: 'POST',
          url: 'https://example.test/api',
          body: 'x'.repeat(33 * 1024)
        }
      })
    );

    bridge.stop();
    expect(events).toHaveLength(0);
  });

  it('omits request bodies when body capture is disabled', () => {
    const events: unknown[] = [];
    const channel = 'channel_good';
    const bridge = installNetworkBridge({
      traceId: 'tr_test',
      channel,
      captureBodies: false,
      sendEvent: (event) => {
        events.push(event);
      }
    });

    window.dispatchEvent(
      new CustomEvent(networkEventName(channel), {
        detail: {
          phase: 'request',
          requestId: 'net_body_disabled',
          fetchKind: 'fetch',
          method: 'POST',
          url: 'https://example.test/api',
          body: 'secret=value'
        }
      })
    );

    bridge.stop();
    expect(events).toHaveLength(1);
    expect((events[0] as NetworkRequestEvent).req_body).toBeUndefined();
  });

  it('emits WebSocket/EventSource metadata without raw payloads', () => {
    const events: Array<CapturedEvent | Record<string, unknown>> = [];
    const channel = 'jf_network_test';
    const bridge = installNetworkBridge({
      traceId: 'tr_stream',
      channel,
      captureBodies: true,
      sendEvent: (event) => {
        events.push(event);
      }
    });

    window.dispatchEvent(
      new CustomEvent(networkEventName(channel), {
        detail: {
          kind: 'stream',
          stream_type: 'websocket',
          phase: 'message',
          stream_id: 'ws_1',
          full_url: 'wss://example.test/socket',
          direction: 'incoming',
          byte_count: 18,
          payload_preview: 'secret socket body'
        }
      })
    );

    bridge.stop();

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'network_stream',
        stream_type: 'websocket',
        phase: 'message',
        stream_id: 'ws_1',
        full_url: 'wss://example.test/socket',
        direction: 'incoming',
        byte_count: 18
      })
    ]);
    expect(JSON.stringify(events)).not.toContain('secret socket body');
  });

  it('removes listeners on stop', () => {
    const events: unknown[] = [];
    const channel = 'channel_good';
    const bridge = installNetworkBridge({
      traceId: 'tr_test',
      channel,
      sendEvent: (event) => {
        events.push(event);
      }
    });

    bridge.stop();
    window.dispatchEvent(
      new CustomEvent(networkEventName(channel), {
        detail: {
          phase: 'request',
          requestId: 'net_after_stop',
          fetchKind: 'fetch',
          method: 'POST',
          url: 'https://example.test/api'
        }
      })
    );

    expect(events).toHaveLength(0);
  });

  it('rejects oversized methods before forwarding to background', () => {
    const events: unknown[] = [];
    const channel = 'channel_good';
    const bridge = installNetworkBridge({
      traceId: 'tr_test',
      channel,
      sendEvent: (event) => {
        events.push(event);
      }
    });

    window.dispatchEvent(
      new CustomEvent(networkEventName(channel), {
        detail: {
          phase: 'request',
          requestId: 'net_method',
          fetchKind: 'fetch',
          method: 'M'.repeat(33),
          url: 'https://example.test/api'
        }
      })
    );

    bridge.stop();
    expect(events).toHaveLength(0);
  });

  it('rejects invalid response numeric fields before forwarding to background', () => {
    const events: unknown[] = [];
    const channel = 'channel_good';
    const bridge = installNetworkBridge({
      traceId: 'tr_test',
      channel,
      sendEvent: (event) => {
        events.push(event);
      }
    });

    for (const detail of [
      { status: Number.NaN, durationMs: 10 },
      { status: 200, durationMs: Number.POSITIVE_INFINITY },
      { status: 9999, durationMs: 10 },
      { status: 200, durationMs: -1 }
    ]) {
      window.dispatchEvent(
        new CustomEvent(networkEventName(channel), {
          detail: {
            phase: 'response',
            requestId: `net_${events.length}`,
            fetchKind: 'fetch',
            method: 'GET',
            url: 'https://example.test/api',
            ...detail
          }
        })
      );
    }

    bridge.stop();
    expect(events).toHaveLength(0);
  });
});
