import { browser } from 'wxt/browser';
import type { BrowserAdapter } from './adapter';
import type { BrowserCapabilities } from '@/shared/types';

/**
 * Capabilities shared by every supported browser. Per-browser adapters spread
 * this and set `browser` (and override anything that differs).
 */
export const BASE_CAPABILITIES = {
  screenshots: false,
  video: false,
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
  };
}
