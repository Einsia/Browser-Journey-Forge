import { createId } from '@/shared/id';
import type { CapturedEvent, DomMutationSignal, DomMutationSummaryEvent } from '@/shared/types';
import { bestSelector } from './selector';

const MAX_SELECTORS = 20;
const MAX_TEXT_SAMPLES = 10;
const MAX_TEXT_SAMPLE_LENGTH = 160;

export type MutationSummaryRecorderOptions = {
  traceId: string;
  tabId?: number;
  sendEvent?: (event: CapturedEvent) => void | Promise<void>;
  now?: () => number;
  url?: () => string;
  debounceMs?: number;
  minFlushIntervalMs?: number;
};

export function installMutationSummaryRecorder(options: MutationSummaryRecorderOptions): { stop(): void } {
  const sendEvent = options.sendEvent ?? defaultSender;
  const now = options.now ?? (() => Date.now());
  const currentUrl = options.url ?? (() => location.href);
  const debounceMs = options.debounceMs ?? 500;
  const minFlushIntervalMs = options.minFlushIntervalMs ?? 2_000;
  let addedNodes = 0;
  let removedNodes = 0;
  let attributeChanges = 0;
  const signals = new Set<DomMutationSignal>();
  const selectors = new Set<string>();
  const textSamples: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let lastFlushAt = Number.NEGATIVE_INFINITY;

  const flush = () => {
    timer = null;
    if (!addedNodes && !removedNodes && !attributeChanges && signals.size === 0) return;
    const event: DomMutationSummaryEvent = {
      event_id: createId('ev_'),
      trace_id: options.traceId,
      tab_id: options.tabId ?? -1,
      timestamp: now(),
      url: currentUrl(),
      kind: 'dom_mutation_summary',
      added_nodes: addedNodes,
      removed_nodes: removedNodes,
      attribute_changes: attributeChanges,
      signals: [...signals],
      selectors: [...selectors].slice(0, MAX_SELECTORS),
      text_samples: { value: textSamples.slice(0, MAX_TEXT_SAMPLES) }
    };
    addedNodes = 0;
    removedNodes = 0;
    attributeChanges = 0;
    signals.clear();
    selectors.clear();
    textSamples.length = 0;
    lastFlushAt = Date.now();
    void sendEvent(event);
  };

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const timeSinceLastFlush = Date.now() - lastFlushAt;
    const delay = Math.max(debounceMs, minFlushIntervalMs - timeSinceLastFlush);
    timer = setTimeout(flush, delay);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        attributeChanges += 1;
        const element = mutation.target instanceof Element ? mutation.target : null;
        if (element) {
          selectors.add(bestSelector(element));
          collectAttributeSignal(element, mutation.attributeName, signals);
        }
      }
      for (const node of mutation.addedNodes) collectAddedNode(node, signals, selectors, textSamples);
      for (const node of mutation.removedNodes) {
        removedNodes += 1;
        if (node instanceof Element) selectors.add(bestSelector(node));
        signals.add('node_removed');
      }
      addedNodes += mutation.addedNodes.length;
    }
    schedule();
  });

  observer.observe(document.documentElement, {
    childList: true,
    attributes: true,
    subtree: true,
    attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'role', 'class']
  });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    }
  };
}

function collectAddedNode(node: Node, signals: Set<DomMutationSignal>, selectors: Set<string>, textSamples: string[]): void {
  if (!(node instanceof Element)) return;
  selectors.add(bestSelector(node));
  const role = node.getAttribute('role') ?? '';
  if (role === 'dialog' || node.matches('dialog,[aria-modal="true"]')) signals.add('modal_added');
  if (role === 'status' || role === 'alert' || /toast|notification/i.test(String(node.className))) signals.add('status_added');
  if (node.matches('li,[role="listitem"]') || node.querySelector('li,[role="listitem"]')) signals.add('list_changed');
  const text = node.textContent?.replace(/\s+/g, ' ').trim();
  if (text) textSamples.push(text.slice(0, MAX_TEXT_SAMPLE_LENGTH));
}

function collectAttributeSignal(element: Element, attributeName: string | null, signals: Set<DomMutationSignal>): void {
  if (!attributeName || !isFormControl(element)) return;
  if (attributeName === 'disabled') {
    signals.add(element.hasAttribute('disabled') ? 'form_control_disabled' : 'form_control_enabled');
  }
  if (attributeName === 'aria-disabled') {
    signals.add(element.getAttribute('aria-disabled') === 'true' ? 'form_control_disabled' : 'form_control_enabled');
  }
}

function isFormControl(element: Element): boolean {
  return element.matches('input, textarea, select, button, [role="button"], [role="textbox"]');
}

function defaultSender(event: CapturedEvent): void {
  void chrome.runtime.sendMessage({ type: 'event', event });
}
