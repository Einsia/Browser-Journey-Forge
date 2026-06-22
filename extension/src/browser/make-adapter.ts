import { browser } from 'wxt/browser';
import type { BrowserAdapter } from './adapter';
import type { BrowserCapabilities } from '@/shared/types';

/**
 * Capabilities shared by every supported browser. Per-browser adapters spread
 * this and set `browser` (and override anything that differs).
 */
export const BASE_CAPABILITIES = {
  screenshots: false,
  video: true,
  webRequestBody: true,
  injectedResponseBody: true,
} satisfies Omit<BrowserCapabilities, 'browser'>;

/**
 * Chrome and Firefox adapters were byte-for-byte identical apart from the
 * capability label, so they share one implementation built on WXT's `browser`
 * namespace (which is polyfilled on Chrome too).
 */
export function makeBrowserAdapter(capabilities: BrowserCapabilities): BrowserAdapter {
  return {
    capabilities,
    createAlarm(name, periodInMinutes) {
      void browser.alarms.create(name, { periodInMinutes });
    },
    async openDashboard(hash = '') {
      const dashboardUrl = browser.runtime.getURL(
        'dashboard.html' as Parameters<typeof browser.runtime.getURL>[0]
      );
      const existing = (await browser.tabs.query({})).find((tab) =>
        tab.url?.startsWith(dashboardUrl)
      );
      const fragment = hash.startsWith('#') ? hash : hash ? `#${hash}` : '';
      const fullUrl = `${dashboardUrl}${fragment}`;
      if (existing?.id) {
        await browser.tabs.update(existing.id, { url: fullUrl, active: true });
        if (existing.windowId) await browser.windows.update(existing.windowId, { focused: true });
      } else {
        await browser.tabs.create({ url: fullUrl });
      }
    },
  };
}
