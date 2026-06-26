import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrowserAdapter } from '@/browser';

const browserApi = vi.hoisted(() => ({
  alarms: {
    create: vi.fn()
  },
  runtime: {
    getURL: vi.fn()
  },
  tabs: {
    create: vi.fn()
  }
}));

vi.mock('wxt/browser', () => ({
  browser: browserApi
}));

function stubChromeRuntime(url: string) {
  vi.stubGlobal('chrome', {
    alarms: {
      create: vi.fn()
    },
    runtime: {
      getURL: vi.fn(() => url)
    },
    tabs: {
      create: vi.fn()
    }
  });
}

describe('browser adapter selection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    browserApi.alarms.create.mockReset();
    browserApi.runtime.getURL.mockReset();
    browserApi.tabs.create.mockReset();
  });

  it('returns Firefox capabilities for moz extension URLs', () => {
    stubChromeRuntime('moz-extension://extension-id/');

    expect(getBrowserAdapter().capabilities).toMatchObject({
      browser: 'firefox',
      screenshots: false,
      video: false
    });
  });

  it('returns Chrome capabilities for chrome extension URLs', () => {
    stubChromeRuntime('chrome-extension://extension-id/');

    expect(getBrowserAdapter().capabilities).toMatchObject({
      browser: 'chrome',
      screenshots: false,
      video: false
    });
  });

  it('falls back to unknown capabilities for unrecognized extension URLs', () => {
    stubChromeRuntime('safari-web-extension://extension-id/');

    expect(getBrowserAdapter().capabilities).toMatchObject({
      browser: 'unknown',
      screenshots: false,
      video: false
    });
  });
});
