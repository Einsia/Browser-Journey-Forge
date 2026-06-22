import { afterEach, describe, expect, it } from 'vitest';
import { navigationHookConfig, navigationEventName } from '@/capture/navigation-events';
import { deactivateNavigationHook, installNavigationHook, restoreNavigationHookForTest } from '@/capture/navigation-injected';
import { installNavigationRecorder, shouldInstallPageNavigationCapture } from '@/capture/navigation-recorder';
import type { NavigationEvent } from '@/shared/types';

describe('installNavigationRecorder', () => {
  afterEach(() => {
    history.replaceState({}, '', '/');
  });

  const absoluteUrl = (path: string) => new URL(path, location.origin).href;

  it('emits an initial load event when installed', () => {
    const events: NavigationEvent[] = [];
    const recorder = installNavigationRecorder({
      traceId: 'tr_nav',
      channel: 'nav_test',
      tabId: 3,
      sendEvent: (event) => {
        events.push(event as NavigationEvent);
      },
      now: () => 123
    });

    recorder.stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      trace_id: 'tr_nav',
      tab_id: 3,
      timestamp: 123,
      url: absoluteUrl('/'),
      kind: 'navigation',
      nav_type: 'load',
      to_url: absoluteUrl('/')
    });
  });

  it('converts page-world pushState and replaceState details into navigation events', () => {
    const events: NavigationEvent[] = [];
    const recorder = installNavigationRecorder({
      traceId: 'tr_nav',
      channel: 'nav_test',
      tabId: 3,
      sendEvent: (event) => {
        events.push(event as NavigationEvent);
      },
      now: () => 123
    });

    window.dispatchEvent(
      new CustomEvent(navigationEventName('nav_test'), {
        detail: { navType: 'pushState', fromUrl: absoluteUrl('/'), toUrl: absoluteUrl('/next') }
      })
    );
    window.dispatchEvent(
      new CustomEvent(navigationEventName('nav_test'), {
        detail: { navType: 'replaceState', fromUrl: absoluteUrl('/next'), toUrl: absoluteUrl('/final') }
      })
    );

    recorder.stop();

    expect(events.map((event) => event.nav_type)).toEqual(['load', 'pushState', 'replaceState']);
    expect(events[1]).toMatchObject({ from_url: absoluteUrl('/'), to_url: absoluteUrl('/next') });
    expect(events[2]).toMatchObject({ from_url: absoluteUrl('/next'), to_url: absoluteUrl('/final') });
  });

  it('does not patch content-world history methods', () => {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const recorder = installNavigationRecorder({ traceId: 'tr_nav', channel: 'nav_test', sendEvent: () => undefined });

    expect(history.pushState).toBe(originalPushState);
    expect(history.replaceState).toBe(originalReplaceState);

    recorder.stop();

    expect(history.pushState).toBe(originalPushState);
    expect(history.replaceState).toBe(originalReplaceState);
  });

  it('emits hashChange events and removes listeners on stop', () => {
    const events: NavigationEvent[] = [];
    const recorder = installNavigationRecorder({
      traceId: 'tr_nav',
      channel: 'nav_test',
      sendEvent: (event) => {
        events.push(event as NavigationEvent);
      },
      now: () => 123
    });

    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: absoluteUrl('/'), newURL: absoluteUrl('/#next') }));
    recorder.stop();
    window.dispatchEvent(
      new HashChangeEvent('hashchange', { oldURL: absoluteUrl('/#next'), newURL: absoluteUrl('/#after-stop') })
    );
    window.dispatchEvent(
      new CustomEvent(navigationEventName('nav_test'), {
        detail: { navType: 'pushState', fromUrl: absoluteUrl('/#next'), toUrl: absoluteUrl('/after-stop') }
      })
    );

    expect(events.map((event) => event.nav_type)).toEqual(['load', 'hashChange']);
    expect(events[1]).toMatchObject({
      from_url: absoluteUrl('/'),
      to_url: absoluteUrl('/#next')
    });
  });

  it('ignores oversized forged page-world navigation details', () => {
    const events: NavigationEvent[] = [];
    const recorder = installNavigationRecorder({
      traceId: 'tr_nav',
      channel: 'nav_test',
      sendEvent: (event) => {
        events.push(event as NavigationEvent);
      }
    });

    window.dispatchEvent(
      new CustomEvent(navigationEventName('nav_test'), {
        detail: { navType: 'pushState', fromUrl: absoluteUrl('/'), toUrl: `https://example.test/${'a'.repeat(5000)}` }
      })
    );

    recorder.stop();

    expect(events.map((event) => event.nav_type)).toEqual(['load']);
  });

  it('captures page-level navigation only in the top frame', () => {
    expect(shouldInstallPageNavigationCapture(true)).toBe(true);
    expect(shouldInstallPageNavigationCapture(false)).toBe(false);
  });
});

describe('navigation injected hook', () => {
  afterEach(() => {
    restoreNavigationHookForTest();
    history.replaceState({}, '', '/');
  });

  const absoluteUrl = (path: string) => new URL(path, location.origin).href;

  it('emits history navigation details on the active page-world channel', () => {
    const seen: unknown[] = [];
    window.addEventListener(navigationEventName('first'), (event) => {
      seen.push((event as CustomEvent).detail);
    });

    installNavigationHook(navigationHookConfig('first'));
    history.pushState({}, '', '/next');
    history.replaceState({}, '', '/final');

    expect(seen).toEqual([
      { navType: 'pushState', fromUrl: absoluteUrl('/'), toUrl: absoluteUrl('/next') },
      { navType: 'replaceState', fromUrl: absoluteUrl('/next'), toUrl: absoluteUrl('/final') }
    ]);
  });

  it('reuses page-global history patches across deactivate and restart', () => {
    const seen: Array<{ type: string; detail: unknown }> = [];
    window.addEventListener(navigationEventName('first'), (event) => {
      seen.push({ type: 'first', detail: (event as CustomEvent).detail });
    });
    window.addEventListener(navigationEventName('second'), (event) => {
      seen.push({ type: 'second', detail: (event as CustomEvent).detail });
    });

    installNavigationHook(navigationHookConfig('first'));
    history.pushState({}, '', '/one');
    deactivateNavigationHook();
    history.pushState({}, '', '/inactive');
    installNavigationHook(navigationHookConfig('second'));
    history.pushState({}, '', '/two');

    expect(window.__journeyForgeNavigationHookState?.activeConfig?.eventName).toBe(navigationEventName('second'));
    expect(seen.map((event) => event.type)).toEqual(['first', 'second']);
  });
});
