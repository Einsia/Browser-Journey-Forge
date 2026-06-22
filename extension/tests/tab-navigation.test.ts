import { describe, expect, it } from 'vitest';
import { shouldRecordBrowserNavigationUrl, tabNavigationEvent } from '@/capture/tab-navigation';

describe('tab navigation helpers', () => {
  it('builds tab-opened navigation events', () => {
    expect(
      tabNavigationEvent({
        traceId: 'tr_tabs',
        tabId: 9,
        timestamp: 10,
        url: 'https://example.test',
        navType: 'tabOpened',
        openerTabId: 3
      })
    ).toMatchObject({
      trace_id: 'tr_tabs',
      kind: 'navigation',
      nav_type: 'tabOpened',
      tab_id: 9,
      opener_tab_id: 3,
      url: 'https://example.test',
      to_url: 'https://example.test'
    });
  });

  it('builds tab-closed navigation events', () => {
    expect(
      tabNavigationEvent({
        traceId: 'tr_tabs',
        tabId: 9,
        timestamp: 20,
        url: 'https://example.test/closed',
        navType: 'tabClosed'
      })
    ).toMatchObject({
      kind: 'navigation',
      nav_type: 'tabClosed',
      from_url: 'https://example.test/closed',
      url: 'https://example.test/closed'
    });
  });

  it('builds load events with from and to URLs', () => {
    expect(
      tabNavigationEvent({
        traceId: 'tr_tabs',
        tabId: 9,
        timestamp: 30,
        url: 'https://example.test/next',
        navType: 'load',
        fromUrl: 'https://example.test/start'
      })
    ).toMatchObject({
      kind: 'navigation',
      nav_type: 'load',
      from_url: 'https://example.test/start',
      to_url: 'https://example.test/next'
    });
  });

  it('filters browser-only URLs from tab navigation capture', () => {
    expect(shouldRecordBrowserNavigationUrl('https://example.test')).toBe(true);
    expect(shouldRecordBrowserNavigationUrl('http://example.test')).toBe(true);
    expect(shouldRecordBrowserNavigationUrl('about:blank')).toBe(true);
    expect(shouldRecordBrowserNavigationUrl('chrome-extension://abc/popup.html')).toBe(false);
    expect(shouldRecordBrowserNavigationUrl('javascript:alert(1)')).toBe(false);
    expect(shouldRecordBrowserNavigationUrl('not a url')).toBe(false);
    expect(shouldRecordBrowserNavigationUrl(`https://example.test/${'a'.repeat(5000)}`)).toBe(false);
  });
});
