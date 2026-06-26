import type { BrowserCapabilities } from '@/shared/types';

export type BrowserAdapter = {
  capabilities: BrowserCapabilities;
  createAlarm(name: string, periodInMinutes: number): void;
};
