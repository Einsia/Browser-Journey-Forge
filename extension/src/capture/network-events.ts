export const NETWORK_EVENT_PREFIX = 'journey-forge::network::';
export const NETWORK_DEACTIVATE_PREFIX = 'journey-forge::deactivate-network::';

export type NetworkHookConfig = {
  channel: string;
  eventName: string;
  deactivateEventName: string;
  captureBodies: boolean;
};

export function networkEventName(channel: string): string {
  return `${NETWORK_EVENT_PREFIX}${channel}`;
}

export function networkDeactivateEventName(channel: string): string {
  return `${NETWORK_DEACTIVATE_PREFIX}${channel}`;
}

export function networkHookConfig(channel: string, captureBodies = true): NetworkHookConfig {
  return {
    channel,
    eventName: networkEventName(channel),
    deactivateEventName: networkDeactivateEventName(channel),
    captureBodies
  };
}
