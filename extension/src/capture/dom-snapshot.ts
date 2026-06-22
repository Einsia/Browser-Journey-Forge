import { sha256Hex } from '@/shared/hash';
import { createId } from '@/shared/id';
import type { DomNode, DomSnapshotEvent, RedactedValue } from '@/shared/types';
import { frameMetadataFor } from './captcha';
import { bestSelector } from './selector';

const MAX_NODES = 300;
const INTERACTABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
  'iframe',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]'
].join(',');

export async function captureDomSnapshot(options: {
  traceId: string;
  tabId?: number;
  triggerEventId?: string;
  root?: ParentNode;
  now?: () => number;
  url?: () => string;
}): Promise<DomSnapshotEvent> {
  const root = options.root ?? document;
  const now = options.now ?? (() => Date.now());
  const currentUrl = options.url ?? (() => location.href);
  const nodes = Array.from(root.querySelectorAll(INTERACTABLE_SELECTOR))
    .filter(isVisible)
    .slice(0, MAX_NODES)
    .map((element, index) => nodeFor(element, index + 1));

  const hash = await sha256Hex(JSON.stringify(nodes));
  return {
    event_id: createId('ev_'),
    trace_id: options.traceId,
    tab_id: options.tabId ?? -1,
    timestamp: now(),
    url: currentUrl(),
    kind: 'dom_snapshot',
    ...(options.triggerEventId ? { trigger_event_id: options.triggerEventId } : {}),
    hash,
    nodes
  };
}

function nodeFor(element: Element, ref: number): DomNode {
  const rect = element.getBoundingClientRect();
  const text = textFor(element);
  const href = element instanceof HTMLAnchorElement ? element.href : undefined;
  const value = valueFor(element);
  const frame = element instanceof HTMLIFrameElement ? frameMetadataFor(element) : undefined;

  return {
    ref,
    tag: element.tagName.toLowerCase(),
    ...(element instanceof HTMLInputElement ? { inputType: element.type } : {}),
    ...stringAttr('role', element.getAttribute('role')),
    ...stringAttr('name', nameFor(element)),
    ...(text ? { text: raw(text) } : {}),
    ...(href ? { href } : {}),
    ...(value !== null ? { value: raw(value) } : {}),
    ...(frame ? { frame } : {}),
    selector: bestSelector(element),
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  };
}

function isVisible(element: Element): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function textFor(element: Element): string | null {
  const text = normalize(element.textContent ?? '');
  return text || null;
}

function nameFor(element: Element): string | undefined {
  if (element instanceof HTMLIFrameElement) {
    return (
      normalize(element.getAttribute('aria-label') ?? '') ||
      normalize(element.getAttribute('title') ?? '') ||
      normalize(element.getAttribute('name') ?? '') ||
      undefined
    );
  }
  return (
    normalize(element.getAttribute('aria-label') ?? '') ||
    normalize(element.getAttribute('name') ?? '') ||
    normalize(element.getAttribute('title') ?? '') ||
    undefined
  );
}

function valueFor(element: Element): string | null {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') return String(element.checked);
    return element.value || null;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value || null;
  if (element instanceof HTMLElement && element.isContentEditable) return normalize(element.innerText) || null;
  return null;
}

function raw(value: string): RedactedValue {
  return { value };
}

function stringAttr<K extends string>(key: K, value: string | null | undefined): { [P in K]?: string } {
  return (value ? { [key]: value } : {}) as { [P in K]?: string };
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}
