import type { CapturedEvent } from '@/shared/types';

/**
 * Whether an event's URL counts toward the journey's visited-domain set.
 * Network and download events are excluded — they reflect resource fetches,
 * not pages the user navigated to.
 */
export function isJourneyDomainEvent(event: CapturedEvent): boolean {
  return (
    event.kind !== 'network_request' &&
    event.kind !== 'network_response' &&
    event.kind !== 'network_stream' &&
    event.kind !== 'download'
  );
}

export function addDomain(domains: Set<string>, value: string): void {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, '');
    if (hostname) domains.add(hostname);
  } catch {
    // Some event kinds carry empty URLs or local fixture values.
  }
}

/**
 * Collect every domain an event touches: its own URL plus, for navigations,
 * both the source and destination URLs.
 */
export function collectEventDomains(domains: Set<string>, event: CapturedEvent): void {
  if (isJourneyDomainEvent(event)) addDomain(domains, event.url);
  if (event.kind === 'navigation') {
    if (event.from_url) addDomain(domains, event.from_url);
    if (event.to_url) addDomain(domains, event.to_url);
  }
}
