import type { NetworkHookConfig } from './network-events';

type NetworkPhase = 'request' | 'response';
type NetworkKind = 'fetch' | 'xhr' | 'beacon';
type StreamType = 'websocket' | 'eventsource';
type StreamPhase = 'open' | 'message' | 'close' | 'error';
type StreamDirection = 'incoming' | 'outgoing';

type NetworkDetail = {
  phase: NetworkPhase;
  requestId: string;
  fetchKind: NetworkKind;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  status?: number;
  contentType?: string;
  durationMs?: number;
};

type StreamDetail = {
  kind: 'stream';
  stream_type: StreamType;
  phase: StreamPhase;
  stream_id: string;
  full_url: string;
  direction?: StreamDirection;
  byte_count?: number;
};

export type NetworkHookState = {
  installed: boolean;
  activeConfig: NetworkHookConfig | null;
};

declare global {
  interface Window {
    __journeyForgeNetworkHookState?: NetworkHookState;
  }
}

export function installNetworkHook(config: NetworkHookConfig): void {
  const state = getHookState();
  state.activeConfig = config;
  if (state.installed) return;
  state.installed = true;

  hookFetch();
  hookXhr();
  hookBeacon();
  hookWebSocket();
  hookEventSource();
}

export function deactivateNetworkHook(): void {
  getHookState().activeConfig = null;
}

function hookFetch(): void {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestId = createNetworkId();
    const started = performance.now();
    const request = await requestFromFetch(input, init);
    emit({
      phase: 'request',
      requestId,
      fetchKind: 'fetch',
      ...request
    });

    try {
      const response = await originalFetch.call(window, input, init);
      emit({
        phase: 'response',
        requestId,
        fetchKind: 'fetch',
        method: request.method,
        url: request.url,
        status: response.status,
        ...optionalString('contentType', response.headers.get('content-type')),
        durationMs: performance.now() - started
      });
      return response;
    } catch (error) {
      emit({
        phase: 'response',
        requestId,
        fetchKind: 'fetch',
        method: request.method,
        url: request.url,
        durationMs: performance.now() - started
      });
      throw error;
    }
  };
}

function hookXhr(): void {
  const OriginalXhr = window.XMLHttpRequest;
  if (!OriginalXhr) return;
  const originalOpen = OriginalXhr.prototype.open;
  const originalSend = OriginalXhr.prototype.send;
  const originalSetRequestHeader = OriginalXhr.prototype.setRequestHeader;
  const metadata = new WeakMap<XMLHttpRequest, { requestId: string; method: string; url: string; headers: Record<string, string>; started: number }>();

  OriginalXhr.prototype.open = function open(method: string, url: string | URL, ...rest: unknown[]) {
    metadata.set(this, {
      requestId: createNetworkId(),
      method: method.toUpperCase(),
      url: String(url),
      headers: {},
      started: 0
    });
    return originalOpen.apply(this, [method, url, ...rest] as Parameters<typeof originalOpen>);
  };

  OriginalXhr.prototype.setRequestHeader = function setRequestHeader(name: string, value: string) {
    const data = metadata.get(this);
    if (data) data.headers[name] = value;
    return originalSetRequestHeader.call(this, name, value);
  };

  OriginalXhr.prototype.send = function send(body?: Document | XMLHttpRequestBodyInit | null) {
    const data = metadata.get(this) ?? {
      requestId: createNetworkId(),
      method: 'GET',
      url: '',
      headers: {},
      started: 0
    };
    data.started = performance.now();
    metadata.set(this, data);
    emit({
      phase: 'request',
      requestId: data.requestId,
      fetchKind: 'xhr',
      method: data.method,
      url: data.url,
      headers: data.headers,
      ...bodyField(body)
    });
    this.addEventListener(
      'loadend',
      () => {
        emit({
          phase: 'response',
          requestId: data.requestId,
          fetchKind: 'xhr',
          method: data.method,
          url: data.url,
          ...(this.status ? { status: this.status } : {}),
          ...optionalString('contentType', this.getResponseHeader('content-type')),
          durationMs: performance.now() - data.started
        });
      },
      { once: true }
    );
    return originalSend.call(this, body);
  };
}

function hookBeacon(): void {
  const originalSendBeacon = navigator.sendBeacon;
  if (typeof originalSendBeacon !== 'function') return;

  navigator.sendBeacon = function sendBeacon(url: string | URL, data?: BodyInit | null): boolean {
    const requestId = createNetworkId();
    const started = performance.now();
    const ok = originalSendBeacon.call(navigator, url, data);
    const targetUrl = String(url);
    emit({
      phase: 'request',
      requestId,
      fetchKind: 'beacon',
      method: 'POST',
      url: targetUrl,
      ...bodyField(data)
    });
    emit({
      phase: 'response',
      requestId,
      fetchKind: 'beacon',
      method: 'POST',
      url: targetUrl,
      ...(ok ? { status: 202 } : {}),
      durationMs: performance.now() - started
    });
    return ok;
  };
}

const streamIds = new WeakMap<object, string>();
const encoder = new TextEncoder();

function hookWebSocket(): void {
  const NativeWebSocket = window.WebSocket;
  if (typeof NativeWebSocket !== 'function') return;

  const JourneyForgeWebSocket = (function JourneyForgeWebSocket(url: string | URL, protocols?: string | string[]) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    const streamId = createStreamId('ws_');
    const fullUrl = String(url);
    streamIds.set(socket, streamId);
    socket.addEventListener('open', () => {
      emitStream({ stream_type: 'websocket', phase: 'open', stream_id: streamId, full_url: fullUrl });
    });
    socket.addEventListener('message', (event) => {
      emitStream({
        stream_type: 'websocket',
        phase: 'message',
        stream_id: streamId,
        full_url: fullUrl,
        direction: 'incoming',
        byte_count: byteLength(event.data)
      });
    });
    socket.addEventListener('close', () => {
      emitStream({ stream_type: 'websocket', phase: 'close', stream_id: streamId, full_url: fullUrl });
    });
    socket.addEventListener('error', () => {
      emitStream({ stream_type: 'websocket', phase: 'error', stream_id: streamId, full_url: fullUrl });
    });
    return socket;
  } as unknown) as typeof WebSocket;

  JourneyForgeWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(JourneyForgeWebSocket, NativeWebSocket);
  window.WebSocket = JourneyForgeWebSocket;

  const nativeSend = NativeWebSocket.prototype.send;
  NativeWebSocket.prototype.send = function patchedSend(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    const streamId = streamIds.get(this) ?? createStreamId('ws_');
    streamIds.set(this, streamId);
    emitStream({
      stream_type: 'websocket',
      phase: 'message',
      stream_id: streamId,
      full_url: this.url,
      direction: 'outgoing',
      byte_count: byteLength(data)
    });
    return nativeSend.call(this, data);
  };
}

function hookEventSource(): void {
  const NativeEventSource = window.EventSource;
  if (typeof NativeEventSource !== 'function') return;

  const JourneyForgeEventSource = (function JourneyForgeEventSource(url: string | URL, eventSourceInitDict?: EventSourceInit) {
    const source = new NativeEventSource(url, eventSourceInitDict);
    const streamId = createStreamId('es_');
    const fullUrl = String(url);
    streamIds.set(source, streamId);
    source.addEventListener('open', () => {
      emitStream({ stream_type: 'eventsource', phase: 'open', stream_id: streamId, full_url: fullUrl });
    });
    source.addEventListener('message', (event) => {
      emitStream({
        stream_type: 'eventsource',
        phase: 'message',
        stream_id: streamId,
        full_url: fullUrl,
        direction: 'incoming',
        byte_count: byteLength(event.data)
      });
    });
    source.addEventListener('error', () => {
      emitStream({ stream_type: 'eventsource', phase: 'error', stream_id: streamId, full_url: fullUrl });
    });
    const nativeClose = source.close.bind(source);
    source.close = () => {
      emitStream({ stream_type: 'eventsource', phase: 'close', stream_id: streamId, full_url: fullUrl });
      nativeClose();
    };
    return source;
  } as unknown) as typeof EventSource;

  JourneyForgeEventSource.prototype = NativeEventSource.prototype;
  Object.setPrototypeOf(JourneyForgeEventSource, NativeEventSource);
  window.EventSource = JourneyForgeEventSource;
}

async function requestFromFetch(input: RequestInfo | URL, init?: RequestInit): Promise<{ method: string; url: string; headers: Record<string, string>; body?: string }> {
  const fromRequest = input instanceof Request ? input : null;
  const method = (init?.method ?? fromRequest?.method ?? 'GET').toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  const headers = headersToRecord(init?.headers ?? fromRequest?.headers);
  const body = init?.body !== undefined ? bodyField(init.body) : await bodyFieldFromRequest(fromRequest);

  return {
    method,
    url,
    headers,
    ...body
  };
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  return { ...headers };
}

function bodyField(body: BodyInit | Document | XMLHttpRequestBodyInit | null | undefined): { body?: string } {
  if (getHookState().activeConfig?.captureBodies === false) return {};
  if (typeof body === 'string') return { body };
  if (body instanceof URLSearchParams) return { body: body.toString() };
  if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof FormData || body instanceof Document) {
    return {};
  }
  return {};
}

async function bodyFieldFromRequest(request: Request | null): Promise<{ body?: string }> {
  if (!request || getHookState().activeConfig?.captureBodies === false || request.bodyUsed) return {};
  const contentType = request.headers.get('content-type') ?? '';
  if (!isTextualRequestBody(contentType)) return {};
  try {
    const body = await request.clone().text();
    return body ? { body } : {};
  } catch {
    return {};
  }
}

function isTextualRequestBody(contentType: string): boolean {
  return /application\/json|application\/x-www-form-urlencoded|text\//i.test(contentType);
}

function emit(detail: NetworkDetail): void {
  const config = getHookState().activeConfig;
  if (!config) return;
  window.dispatchEvent(new CustomEvent(config.eventName, { detail }));
}

function emitStream(detail: Omit<StreamDetail, 'kind'>): void {
  const config = getHookState().activeConfig;
  if (!config) return;
  window.dispatchEvent(new CustomEvent(config.eventName, { detail: { kind: 'stream', ...detail } satisfies StreamDetail }));
}

function getHookState(): NetworkHookState {
  if (window.__journeyForgeNetworkHookState) return window.__journeyForgeNetworkHookState;
  const state: NetworkHookState = {
    installed: false,
    activeConfig: null
  };
  window.__journeyForgeNetworkHookState = state;
  return state;
}

function optionalString<K extends string>(key: K, value: string | null | undefined): { [P in K]?: string } {
  return (value ? { [key]: value } : {}) as { [P in K]?: string };
}

function createNetworkId(): string {
  const random = Math.random().toString(16).slice(2);
  return `net_${Date.now().toString(36)}_${random}`;
}

function createStreamId(prefix: string): string {
  const random = Math.random().toString(16).slice(2);
  return `${prefix}${Date.now().toString(36)}_${random}`;
}

function byteLength(data: unknown): number {
  if (typeof data === 'string') return encoder.encode(data).byteLength;
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}
