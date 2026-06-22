import { createId } from '@/shared/id';
import type { NavigationEvent } from '@/shared/types';

export type BrowserNavigationType = Extract<NavigationEvent['nav_type'], 'load' | 'tabOpened' | 'tabClosed'>;

export type TabNavigationEventOptions = {
  traceId: string;
  tabId: number;
  timestamp: number;
  url: string;
  navType: BrowserNavigationType;
  fromUrl?: string;
  openerTabId?: number;
};

const MAX_BROWSER_NAVIGATION_URL_CHARS = 4 * 1024;

export function tabNavigationEvent(options: TabNavigationEventOptions): NavigationEvent {
  return {
    event_id: createId('ev_'),
    trace_id: options.traceId,
    tab_id: options.tabId,
    timestamp: options.timestamp,
    url: options.url,
    kind: 'navigation',
    nav_type: options.navType,
    ...(options.fromUrl ? { from_url: options.fromUrl } : {}),
    ...(options.navType === 'tabClosed' ? { from_url: options.fromUrl ?? options.url } : {}),
    ...(options.navType === 'load' || options.navType === 'tabOpened' ? { to_url: options.url } : {}),
    ...(options.openerTabId !== undefined ? { opener_tab_id: options.openerTabId } : {})
  };
}

export function shouldRecordBrowserNavigationUrl(url: string | undefined): url is string {
  if (!url) return false;
  if (url.length > MAX_BROWSER_NAVIGATION_URL_CHARS) return false;
  if (url === 'about:blank') return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
