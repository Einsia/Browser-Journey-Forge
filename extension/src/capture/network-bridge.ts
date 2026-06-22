import { createId } from '@/shared/id';
import type { CapturedEvent, NetworkRequestEvent, NetworkResponseEvent, NetworkStreamEvent, RedactedValue } from '@/shared/types';
import { networkEventName } from './network-events';

export type NetworkBridgeOptions = {
  traceId: string;
  channel: string;
  tabId?: number;
  sendEvent?: NetworkBridgeSender;
  now?: () => number;
  url?: () => string;
  captureBodies?: boolean;
};

type NetworkBridgeSender = { send(event: CapturedEvent): void | Promise<void> }['send'];

type NetworkDetail = {
  phase: 'request' | 'response';
  requestId: string;
  fetchKind: NetworkRequestEvent['fetch_kind'];
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  status?: number;
  contentType?: string;
  durationMs?: number;
};

type NetworkStreamDetail = {
  kind: 'stream';
  stream_type: NetworkStreamEvent['stream_type'];
  phase: NetworkStreamEvent['phase'];
  stream_id: string;
  full_url: string;
  direction?: NetworkStreamEvent['direction'];
  byte_count?: number;
};

export const MAX_NETWORK_BODY_CHARS = 32 * 1024;
export const MAX_NETWORK_HEADER_CHARS = 16 * 1024;
export const MAX_NETWORK_HEADER_VALUE_CHARS = 4 * 1024;
const MAX_NETWORK_HEADERS = 64;
const MAX_URL_CHARS = 4 * 1024;
const MAX_ID_CHARS = 256;
const MAX_CONTENT_TYPE_CHARS = 512;
const MAX_METHOD_CHARS = 32;
const MAX_STATUS = 599;
const MAX_DURATION_MS = 10 * 60 * 1000;
const MAX_STREAM_BYTE_COUNT = 32 * 1024 * 1024;

export function installNetworkBridge(options: NetworkBridgeOptions): { stop(): void } {
  const sendEvent = options.sendEvent ?? defaultSender;
  const now = options.now ?? (() => Date.now());
  const currentUrl = options.url ?? (() => location.href);
  const eventName = networkEventName(options.channel);
  const seenRequests = new Set<string>();

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<NetworkDetail | NetworkStreamDetail>).detail;
    if (isNetworkStreamDetail(detail)) {
      void sendEvent(streamEvent(detail, options.traceId, options.tabId ?? -1, now(), currentUrl()));
      return;
    }

    if (!isNetworkDetail(detail)) return;

    if (detail.phase === 'request') {
      seenRequests.add(detail.requestId);
      void sendEvent(requestEvent(detail, options.traceId, options.tabId ?? -1, now(), currentUrl(), options.captureBodies !== false));
      return;
    }

    if (!seenRequests.has(detail.requestId)) seenRequests.add(detail.requestId);
    void sendEvent(responseEvent(detail, options.traceId, options.tabId ?? -1, now(), currentUrl()));
  };

  window.addEventListener(eventName, listener);
  return {
    stop() {
      window.removeEventListener(eventName, listener);
    }
  };
}

function defaultSender(event: CapturedEvent): void {
  void chrome.runtime.sendMessage({ type: 'event', event });
}

function requestEvent(
  detail: NetworkDetail,
  traceId: string,
  tabId: number,
  timestamp: number,
  pageUrl: string,
  captureBodies: boolean
): NetworkRequestEvent {
  return {
    event_id: createId('ev_'),
    trace_id: traceId,
    tab_id: tabId,
    timestamp,
    url: pageUrl,
    kind: 'network_request',
    request_id: detail.requestId,
    method: detail.method,
    full_url: detail.url,
    initiator: pageUrl,
    fetch_kind: detail.fetchKind,
    req_headers: wrapHeaders(detail.headers ?? {}),
    ...(captureBodies && detail.body !== undefined ? { req_body: raw(detail.body) } : {})
  };
}

function responseEvent(detail: NetworkDetail, traceId: string, tabId: number, timestamp: number, pageUrl: string): NetworkResponseEvent {
  return {
    event_id: createId('ev_'),
    trace_id: traceId,
    tab_id: tabId,
    timestamp,
    url: pageUrl,
    kind: 'network_response',
    request_id: detail.requestId,
    ...(detail.status !== undefined ? { status: detail.status } : {}),
    ...(detail.contentType ? { content_type: detail.contentType } : {}),
    ...(detail.durationMs !== undefined ? { duration_ms: detail.durationMs } : {})
  };
}

function streamEvent(detail: NetworkStreamDetail, traceId: string, tabId: number, timestamp: number, pageUrl: string): NetworkStreamEvent {
  return {
    event_id: createId('ev_'),
    trace_id: traceId,
    tab_id: tabId,
    timestamp,
    url: pageUrl,
    kind: 'network_stream',
    stream_type: detail.stream_type,
    phase: detail.phase,
    stream_id: detail.stream_id,
    full_url: detail.full_url,
    ...(detail.direction ? { direction: detail.direction } : {}),
    ...(detail.byte_count !== undefined ? { byte_count: detail.byte_count } : {})
  };
}

function wrapHeaders(headers: Record<string, string>): Record<string, RedactedValue> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, raw(value)]));
}

function raw(value: string): RedactedValue {
  return { value };
}

function isNetworkDetail(detail: unknown): detail is NetworkDetail {
  if (!detail || typeof detail !== 'object') return false;
  const value = detail as Partial<NetworkDetail>;
  if (
    !(
      (value.phase === 'request' || value.phase === 'response') &&
      typeof value.requestId === 'string' &&
      typeof value.method === 'string' &&
      typeof value.url === 'string' &&
      (value.fetchKind === 'fetch' || value.fetchKind === 'xhr' || value.fetchKind === 'beacon')
    )
  ) {
    return false;
  }

  // Page-context events are forgeable if a page learns this random event name
  // or monkeypatches dispatchEvent. The channel narrows blind injection and size
  // caps protect storage; this is not a cryptographic trust boundary.
  if (value.requestId.length > MAX_ID_CHARS || value.url.length > MAX_URL_CHARS) return false;
  if (value.method.length > MAX_METHOD_CHARS) return false;
  if (value.body !== undefined && value.body.length > MAX_NETWORK_BODY_CHARS) return false;
  if (value.contentType !== undefined && value.contentType.length > MAX_CONTENT_TYPE_CHARS) return false;
  if (!validStatus(value.status)) return false;
  if (!validDuration(value.durationMs)) return false;
  if (!headersWithinLimit(value.headers)) return false;
  return true;
}

function isNetworkStreamDetail(detail: unknown): detail is NetworkStreamDetail {
  if (!detail || typeof detail !== 'object') return false;
  const value = detail as Partial<NetworkStreamDetail>;
  if (
    !(
      value.kind === 'stream' &&
      (value.stream_type === 'websocket' || value.stream_type === 'eventsource') &&
      (value.phase === 'open' || value.phase === 'message' || value.phase === 'close' || value.phase === 'error') &&
      typeof value.stream_id === 'string' &&
      typeof value.full_url === 'string'
    )
  ) {
    return false;
  }

  if (value.stream_id.length > MAX_ID_CHARS || value.full_url.length > MAX_URL_CHARS) return false;
  if (value.direction !== undefined && value.direction !== 'incoming' && value.direction !== 'outgoing') return false;
  if (value.byte_count !== undefined && (!Number.isInteger(value.byte_count) || value.byte_count < 0 || value.byte_count > MAX_STREAM_BYTE_COUNT)) {
    return false;
  }
  return true;
}

function validStatus(status: number | undefined): boolean {
  return status === undefined || (Number.isInteger(status) && status >= 100 && status <= MAX_STATUS);
}

function validDuration(durationMs: number | undefined): boolean {
  return durationMs === undefined || (Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= MAX_DURATION_MS);
}

function headersWithinLimit(headers: Record<string, string> | undefined): boolean {
  if (!headers) return true;
  const entries = Object.entries(headers);
  if (entries.length > MAX_NETWORK_HEADERS) return false;

  let total = 0;
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || typeof value !== 'string') return false;
    if (value.length > MAX_NETWORK_HEADER_VALUE_CHARS) return false;
    total += key.length + value.length;
    if (total > MAX_NETWORK_HEADER_CHARS) return false;
  }
  return true;
}
