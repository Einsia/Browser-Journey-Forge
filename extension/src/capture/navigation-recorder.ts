import { createId } from '@/shared/id';
import type { CapturedEvent, NavigationEvent } from '@/shared/types';
import { navigationEventName } from './navigation-events';

export type NavigationRecorderOptions = {
  traceId: string;
  channel: string;
  tabId?: number;
  sendEvent?: (event: CapturedEvent) => void | Promise<void>;
  now?: () => number;
  url?: () => string;
};

type NavigationDetail = {
  navType: 'pushState' | 'replaceState';
  fromUrl: string;
  toUrl: string;
};

const MAX_NAVIGATION_URL_CHARS = 4 * 1024;

export function installNavigationRecorder(options: NavigationRecorderOptions): { stop(): void } {
  const sendEvent = options.sendEvent ?? defaultSender;
  const now = options.now ?? (() => Date.now());
  const readUrl = options.url ?? (() => location.href);
  const tabId = options.tabId ?? -1;
  const cleanup: Array<() => void> = [];
  let currentUrl = readUrl();
  let stopped = false;

  const emit = (navType: NavigationEvent['nav_type'], fromUrl?: string, toUrl = readUrl()) => {
    if (stopped) return;
    void sendEvent({
      event_id: createId('ev_'),
      trace_id: options.traceId,
      tab_id: tabId,
      timestamp: now(),
      url: toUrl,
      kind: 'navigation',
      nav_type: navType,
      ...(fromUrl ? { from_url: fromUrl } : {}),
      to_url: toUrl
    });
    currentUrl = toUrl;
  };

  const onHistoryNavigation = (event: Event) => {
    const detail = (event as CustomEvent<NavigationDetail>).detail;
    if (!isNavigationDetail(detail)) return;
    emit(detail.navType, detail.fromUrl, detail.toUrl);
  };
  const onPopState = () => emit('popState', currentUrl, readUrl());
  const onHashChange = (event: Event) => {
    const hashEvent = event as HashChangeEvent;
    emit('hashChange', hashEvent.oldURL || currentUrl, hashEvent.newURL || readUrl());
  };
  const onBeforeUnload = () => emit('beforeUnload', currentUrl, readUrl());

  emit('load', undefined, currentUrl);
  on(window, navigationEventName(options.channel), onHistoryNavigation, cleanup);
  on(window, 'popstate', onPopState, cleanup);
  on(window, 'hashchange', onHashChange, cleanup);
  on(window, 'beforeunload', onBeforeUnload, cleanup);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      for (const dispose of cleanup.splice(0)) dispose();
    }
  };
}

export function shouldInstallPageNavigationCapture(isTopFrame: boolean): boolean {
  return isTopFrame;
}

function defaultSender(event: CapturedEvent): void {
  void chrome.runtime.sendMessage({ type: 'event', event });
}

function on(target: Window, type: string, listener: EventListener, cleanup: Array<() => void>): void {
  target.addEventListener(type, listener);
  cleanup.push(() => target.removeEventListener(type, listener));
}

function isNavigationDetail(detail: unknown): detail is NavigationDetail {
  if (!detail || typeof detail !== 'object') return false;
  const value = detail as Partial<NavigationDetail>;
  return (
    (value.navType === 'pushState' || value.navType === 'replaceState') &&
    typeof value.fromUrl === 'string' &&
    typeof value.toUrl === 'string' &&
    value.fromUrl.length <= MAX_NAVIGATION_URL_CHARS &&
    value.toUrl.length <= MAX_NAVIGATION_URL_CHARS
  );
}
