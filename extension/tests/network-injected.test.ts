import { afterEach, describe, expect, it, vi } from 'vitest';
import { deactivateNetworkHook, installNetworkHook } from '@/capture/network-injected';
import { networkHookConfig } from '@/capture/network-events';

describe('network injected hook', () => {
  afterEach(() => {
    deactivateNetworkHook();
    delete window.__journeyForgeNetworkHookState;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses reusable page-global state so capture resumes after stop and restart', async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', originalFetch);
    const seen: Array<{ type: string; detail: unknown }> = [];
    window.addEventListener('journey-forge::network::first', (event) => {
      seen.push({ type: 'first', detail: (event as CustomEvent).detail });
    });
    window.addEventListener('journey-forge::network::second', (event) => {
      seen.push({ type: 'second', detail: (event as CustomEvent).detail });
    });

    installNetworkHook(networkHookConfig('first'));
    await fetch('https://example.test/one');
    deactivateNetworkHook();
    await fetch('https://example.test/inactive');
    installNetworkHook(networkHookConfig('second'));
    await fetch('https://example.test/two');

    expect(window.__journeyForgeNetworkHookState?.activeConfig?.eventName).toBe('journey-forge::network::second');
    expect(seen.map((event) => event.type)).toEqual(['first', 'first', 'second', 'second']);
    expect(originalFetch).toHaveBeenCalledTimes(3);
  });

  it('omits fetch request bodies when body capture is disabled', async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', originalFetch);
    const seen: unknown[] = [];
    window.addEventListener('journey-forge::network::private', (event) => {
      seen.push((event as CustomEvent).detail);
    });

    installNetworkHook(networkHookConfig('private', false));
    await fetch('https://example.test/private', {
      method: 'POST',
      body: new URLSearchParams({ secret: 'value' })
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      phase: 'request',
      fetchKind: 'fetch',
      method: 'POST',
      url: 'https://example.test/private'
    });
    expect(seen[0]).not.toHaveProperty('body');
  });

  it('captures textual bodies from Request inputs when body capture is enabled', async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', originalFetch);
    const seen: unknown[] = [];
    window.addEventListener('journey-forge::network::request-body', (event) => {
      seen.push((event as CustomEvent).detail);
    });

    installNetworkHook(networkHookConfig('request-body'));
    const request = new Request('https://example.test/request-object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'secret=value'
    });
    await fetch(request);

    expect(seen[0]).toMatchObject({
      phase: 'request',
      fetchKind: 'fetch',
      method: 'POST',
      url: 'https://example.test/request-object',
      body: 'secret=value'
    });
    expect(originalFetch).toHaveBeenCalledWith(request, undefined);
  });

  it('emits WebSocket metadata without raw payloads', () => {
    const sentPayloads: unknown[] = [];
    class FakeWebSocket extends EventTarget {
      readonly url: string;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
      }

      send(data: unknown): void {
        sentPayloads.push(data);
      }
    }

    vi.stubGlobal('WebSocket', FakeWebSocket);
    const seen: unknown[] = [];
    window.addEventListener('journey-forge::network::stream', (event) => {
      seen.push((event as CustomEvent).detail);
    });

    installNetworkHook(networkHookConfig('stream'));
    const socket = new WebSocket('wss://example.test/socket');
    socket.dispatchEvent(new Event('open'));
    socket.dispatchEvent(new MessageEvent('message', { data: 'incoming secret' }));
    socket.send('outgoing secret');
    socket.dispatchEvent(new Event('close'));

    expect(seen).toEqual([
      expect.objectContaining({
        kind: 'stream',
        stream_type: 'websocket',
        phase: 'open',
        full_url: 'wss://example.test/socket'
      }),
      expect.objectContaining({
        kind: 'stream',
        stream_type: 'websocket',
        phase: 'message',
        full_url: 'wss://example.test/socket',
        direction: 'incoming',
        byte_count: 15
      }),
      expect.objectContaining({
        kind: 'stream',
        stream_type: 'websocket',
        phase: 'message',
        full_url: 'wss://example.test/socket',
        direction: 'outgoing',
        byte_count: 15
      }),
      expect.objectContaining({
        kind: 'stream',
        stream_type: 'websocket',
        phase: 'close',
        full_url: 'wss://example.test/socket'
      })
    ]);
    expect(sentPayloads).toEqual(['outgoing secret']);
    expect(JSON.stringify(seen)).not.toContain('secret');
  });

  it('does not emit WebSocket open metadata before the native open event', () => {
    class FakeWebSocket extends EventTarget {
      readonly url: string;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
      }

      send(): void {}
    }

    vi.stubGlobal('WebSocket', FakeWebSocket);
    const seen: unknown[] = [];
    window.addEventListener('journey-forge::network::pending-socket', (event) => {
      seen.push((event as CustomEvent).detail);
    });

    installNetworkHook(networkHookConfig('pending-socket'));
    const socket = new WebSocket('wss://example.test/socket');
    expect(seen).toHaveLength(0);
    socket.dispatchEvent(new Event('error'));

    expect(seen).toEqual([
      expect.objectContaining({
        kind: 'stream',
        stream_type: 'websocket',
        phase: 'error',
        full_url: 'wss://example.test/socket'
      })
    ]);
  });

  it('emits EventSource metadata without raw payloads', () => {
    class FakeEventSource extends EventTarget {
      readonly url: string;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
      }

      close(): void {}
    }

    vi.stubGlobal('EventSource', FakeEventSource);
    const seen: unknown[] = [];
    window.addEventListener('journey-forge::network::events', (event) => {
      seen.push((event as CustomEvent).detail);
    });

    installNetworkHook(networkHookConfig('events'));
    const source = new EventSource('https://example.test/events');
    source.dispatchEvent(new Event('open'));
    source.dispatchEvent(new MessageEvent('message', { data: 'stream secret' }));
    source.dispatchEvent(new Event('error'));
    source.close();

    expect(seen).toEqual([
      expect.objectContaining({
        kind: 'stream',
        stream_type: 'eventsource',
        phase: 'open',
        full_url: 'https://example.test/events'
      }),
      expect.objectContaining({
        kind: 'stream',
        stream_type: 'eventsource',
        phase: 'message',
        full_url: 'https://example.test/events',
        direction: 'incoming',
        byte_count: 13
      }),
      expect.objectContaining({
        kind: 'stream',
        stream_type: 'eventsource',
        phase: 'error',
        full_url: 'https://example.test/events'
      }),
      expect.objectContaining({
        kind: 'stream',
        stream_type: 'eventsource',
        phase: 'close',
        full_url: 'https://example.test/events'
      })
    ]);
    expect(JSON.stringify(seen)).not.toContain('secret');
  });
});
