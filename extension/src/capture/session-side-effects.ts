import { captchaProvidersFromSnapshot } from './captcha';
import { createId } from '@/shared/id';
import type {
  ActionEvent,
  AnnotationEvent,
  CaptchaProvider,
  DomSnapshotEvent,
} from '@/shared/types';

export type CaptchaTraceStateOptions = {
  traceId: string;
  tabId?: number;
  now?: () => number;
  url?: () => string;
};

const DEFAULT_DOM_SNAPSHOT_INTERVAL_MS = 10_000;

const DOM_SNAPSHOT_ACTION_TYPES = new Set<ActionEvent['action_type']>([
  'click',
  'dblclick',
  'change',
  'submit',
  'keydown',
  'file_select',
]);

export function shouldCaptureDomSnapshotAfterAction(
  event: ActionEvent
): boolean {
  return DOM_SNAPSHOT_ACTION_TYPES.has(event.action_type);
}

export function createDomSnapshotScheduler(
  options: { minIntervalMs?: number; now?: () => number } = {}
) {
  const now = options.now ?? (() => Date.now());
  const minIntervalMs =
    options.minIntervalMs ?? DEFAULT_DOM_SNAPSHOT_INTERVAL_MS;
  let lastCaptureAt = Number.NEGATIVE_INFINITY;

  return {
    shouldCaptureAfterAction(event: ActionEvent): boolean {
      if (!shouldCaptureDomSnapshotAfterAction(event)) return false;
      const current = now();
      if (current - lastCaptureAt < minIntervalMs) return false;
      lastCaptureAt = current;
      return true;
    },

    reset(): void {
      lastCaptureAt = Number.NEGATIVE_INFINITY;
    },
  };
}

export function createDomSnapshotDedupe() {
  const lastKeyByTrace = new Map<string, string>();

  return {
    shouldSend(snapshot: DomSnapshotEvent): boolean {
      const key = `${snapshot.url}\n${snapshot.hash}`;
      const lastKey = lastKeyByTrace.get(snapshot.trace_id);
      if (lastKey === key) return false;
      lastKeyByTrace.set(snapshot.trace_id, key);
      return true;
    },

    clear(traceId: string): void {
      lastKeyByTrace.delete(traceId);
    },
  };
}

export function createCaptchaTraceState(options: CaptchaTraceStateOptions) {
  const seenProviders = new Set<CaptchaProvider>();
  const now = options.now ?? (() => Date.now());
  const currentUrl = options.url ?? (() => location.href);

  return {
    annotationEventsForSnapshot(snapshot: DomSnapshotEvent): AnnotationEvent[] {
      const newProviders = captchaProvidersFromSnapshot(snapshot).filter(
        (provider) => !seenProviders.has(provider)
      );
      if (!newProviders.length) return [];
      for (const provider of newProviders) seenProviders.add(provider);
      return [
        {
          event_id: createId('ev_'),
          trace_id: options.traceId,
          tab_id: options.tabId ?? snapshot.tab_id ?? -1,
          timestamp: now(),
          url: currentUrl(),
          kind: 'annotation',
          annotation_type: 'captcha_detected',
          text: newProviders.join(','),
        },
      ];
    },
  };
}

export function createCaptchaProviderDedupe() {
  const seenByTrace = new Map<string, Set<CaptchaProvider>>();

  return {
    newProviders(
      traceId: string,
      providers: CaptchaProvider[]
    ): CaptchaProvider[] {
      const seen = seenByTrace.get(traceId) ?? new Set<CaptchaProvider>();
      seenByTrace.set(traceId, seen);
      const result: CaptchaProvider[] = [];
      for (const provider of providers) {
        if (seen.has(provider)) continue;
        seen.add(provider);
        result.push(provider);
      }
      return result;
    },

    clear(traceId: string): void {
      seenByTrace.delete(traceId);
    },
  };
}
