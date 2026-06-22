import { networkHookConfig } from '@/capture/network-events';
import { deactivateNetworkHook, installNetworkHook } from '@/capture/network-injected';
import { navigationHookConfig } from '@/capture/navigation-events';
import { deactivateNavigationHook, installNavigationHook } from '@/capture/navigation-injected';

export default defineUnlistedScript(() => {
  const config = configFromCurrentScript();
  if (!config) return;
  installNetworkHook(config.network);
  window.addEventListener(config.network.deactivateEventName, () => deactivateNetworkHook());
  if (config.navigation) {
    installNavigationHook(config.navigation);
    window.addEventListener(config.navigation.deactivateEventName, () => deactivateNavigationHook());
  }
});

function configFromCurrentScript() {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return null;
  const hash = new URL(script.src).hash.slice(1);
  if (!hash) return null;
  const decoded = decodeURIComponent(hash);
  try {
    const parsed = JSON.parse(decoded) as {
      channel?: unknown;
      captureBodies?: unknown;
      network?: { channel?: unknown; captureBodies?: unknown };
      navigation?: { channel?: unknown };
    };
    const networkChannel = parsed.network?.channel ?? parsed.channel;
    if (typeof networkChannel !== 'string') return null;
    const navigationChannel = parsed.navigation?.channel;
    return {
      network: networkHookConfig(networkChannel, (parsed.network?.captureBodies ?? parsed.captureBodies) !== false),
      ...(typeof navigationChannel === 'string' ? { navigation: navigationHookConfig(navigationChannel) } : {})
    };
  } catch {
    return { network: networkHookConfig(decoded) };
  }
}
