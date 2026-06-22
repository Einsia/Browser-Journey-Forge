import type { NavigationHookConfig } from './navigation-events';

type NavigationDetail = {
  navType: 'pushState' | 'replaceState';
  fromUrl: string;
  toUrl: string;
};

export type NavigationHookState = {
  installed: boolean;
  activeConfig: NavigationHookConfig | null;
  originalPushState?: History['pushState'];
  originalReplaceState?: History['replaceState'];
};

declare global {
  interface Window {
    __journeyForgeNavigationHookState?: NavigationHookState;
  }
}

export function installNavigationHook(config: NavigationHookConfig): void {
  const state = getHookState();
  state.activeConfig = config;
  if (state.installed) return;
  state.installed = true;

  hookHistory(state);
}

export function deactivateNavigationHook(): void {
  getHookState().activeConfig = null;
}

export function restoreNavigationHookForTest(): void {
  const state = window.__journeyForgeNavigationHookState;
  if (!state) return;
  if (state.originalPushState && history.pushState !== state.originalPushState) history.pushState = state.originalPushState;
  if (state.originalReplaceState && history.replaceState !== state.originalReplaceState) history.replaceState = state.originalReplaceState;
  delete window.__journeyForgeNavigationHookState;
}

function hookHistory(state: NavigationHookState): void {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  state.originalPushState = originalPushState;
  state.originalReplaceState = originalReplaceState;

  history.pushState = function pushState(this: History, data: unknown, unused: string, url?: string | URL | null): void {
    const fromUrl = location.href;
    const result = originalPushState.apply(this, [data, unused, url] as Parameters<History['pushState']>);
    emit({ navType: 'pushState', fromUrl, toUrl: location.href });
    return result;
  };

  history.replaceState = function replaceState(this: History, data: unknown, unused: string, url?: string | URL | null): void {
    const fromUrl = location.href;
    const result = originalReplaceState.apply(this, [data, unused, url] as Parameters<History['replaceState']>);
    emit({ navType: 'replaceState', fromUrl, toUrl: location.href });
    return result;
  };
}

function emit(detail: NavigationDetail): void {
  const config = getHookState().activeConfig;
  if (!config) return;
  window.dispatchEvent(new CustomEvent(config.eventName, { detail }));
}

function getHookState(): NavigationHookState {
  if (window.__journeyForgeNavigationHookState) return window.__journeyForgeNavigationHookState;
  const state: NavigationHookState = {
    installed: false,
    activeConfig: null
  };
  window.__journeyForgeNavigationHookState = state;
  return state;
}
