export const NAVIGATION_EVENT_PREFIX = 'journey-forge::navigation::';
export const NAVIGATION_DEACTIVATE_PREFIX = 'journey-forge::deactivate-navigation::';

export type NavigationHookConfig = {
  channel: string;
  eventName: string;
  deactivateEventName: string;
};

export function navigationEventName(channel: string): string {
  return `${NAVIGATION_EVENT_PREFIX}${channel}`;
}

export function navigationDeactivateEventName(channel: string): string {
  return `${NAVIGATION_DEACTIVATE_PREFIX}${channel}`;
}

export function navigationHookConfig(channel: string): NavigationHookConfig {
  return {
    channel,
    eventName: navigationEventName(channel),
    deactivateEventName: navigationDeactivateEventName(channel)
  };
}
