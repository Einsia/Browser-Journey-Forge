import type { BrowserAdapter } from './adapter';
import { chromeAdapter } from './chrome-adapter';
import { firefoxAdapter } from './firefox-adapter';
import { BASE_CAPABILITIES, makeBrowserAdapter } from './make-adapter';

export function getBrowserAdapter(): BrowserAdapter {
  const url = chrome.runtime.getURL('');
  if (url.startsWith('moz-extension://')) return firefoxAdapter;
  if (url.startsWith('chrome-extension://')) return chromeAdapter;
  return makeBrowserAdapter({ ...BASE_CAPABILITIES, browser: 'unknown', video: false });
}
