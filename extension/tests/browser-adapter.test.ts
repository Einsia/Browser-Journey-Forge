import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firefoxAdapter } from '@/browser/firefox-adapter';
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
      video: true
    });
  });

  it('returns Chrome capabilities for chrome extension URLs', () => {
    stubChromeRuntime('chrome-extension://extension-id/');

    expect(getBrowserAdapter().capabilities).toMatchObject({
      browser: 'chrome',
      screenshots: false,
      video: true
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

  it('uses WXT browser namespace for Firefox dashboard opening', async () => {
    const chromeTabsCreate = vi.fn();
    vi.stubGlobal('chrome', {
      alarms: {
        create: vi.fn()
      },
      runtime: {
        getURL: vi.fn()
      },
      tabs: {
        create: chromeTabsCreate
      }
    });
    browserApi.runtime.getURL.mockReturnValue('moz-extension://extension-id/dashboard.html#review');
    browserApi.tabs.create.mockResolvedValue({ id: 1 });

    await firefoxAdapter.openDashboard('#review');

    expect(browserApi.runtime.getURL).toHaveBeenCalledWith('dashboard.html#review');
    expect(browserApi.tabs.create).toHaveBeenCalledWith({
      url: 'moz-extension://extension-id/dashboard.html#review'
    });
    expect(chromeTabsCreate).not.toHaveBeenCalled();
  });
});
