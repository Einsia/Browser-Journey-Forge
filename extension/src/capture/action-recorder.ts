import { createId } from '@/shared/id';
import type { ActionEvent, CapturedEvent } from '@/shared/types';
import { buildElementRef } from './selector';

export type CaptureSender = (event: CapturedEvent) => void | Promise<void>;

export type ActionRecorderOptions = {
  traceId: string;
  tabId?: number;
  sendEvent?: CaptureSender;
  now?: () => number;
  url?: () => string;
};

export type InstalledCapture = {
  stop(): void;
};

const SHORTCUT_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
]);
const SCROLL_THROTTLE_MS = 250;

export function installActionRecorder(
  options: ActionRecorderOptions
): InstalledCapture {
  const sendEvent = options.sendEvent ?? defaultSender;
  const now = options.now ?? (() => Date.now());
  const currentUrl = options.url ?? (() => location.href);
  const tabId = options.tabId ?? -1;
  const cleanup: Array<() => void> = [];
  const lastScrollByTarget = new WeakMap<EventTarget, number>();
  let lastWindowScroll = 0;

  const emit = (
    event: Omit<
      ActionEvent,
      'event_id' | 'trace_id' | 'tab_id' | 'timestamp' | 'url' | 'kind'
    >
  ) => {
    void sendEvent({
      event_id: createId('ev_'),
      trace_id: options.traceId,
      tab_id: tabId,
      timestamp: now(),
      url: currentUrl(),
      kind: 'action',
      ...event,
    });
  };

  const mouseHandler =
    (actionType: 'click' | 'dblclick') => (event: MouseEvent) => {
      const target = elementFromEvent(event);
      emit({
        action_type: actionType,
        ...(target ? { target: buildElementRef(target) } : {}),
        coords: { x: event.clientX, y: event.clientY },
        modifiers: modifiersFor(event),
      });
    };

  const dragHandler = (actionType: 'drag' | 'drop') => (event: DragEvent) => {
    const target = elementFromEvent(event);
    emit({
      action_type: actionType,
      ...(target ? { target: buildElementRef(target) } : {}),
      coords: { x: event.clientX, y: event.clientY },
      modifiers: modifiersFor(event),
    });
  };

  const inputHandler = (actionType: 'input' | 'change') => (event: Event) => {
    const target = elementFromEvent(event);
    if (
      actionType === 'change' &&
      target instanceof HTMLInputElement &&
      target.type === 'file'
    ) {
      emit({
        action_type: 'file_select',
        target: buildElementRef(target),
        files: fileMetadata(target),
      });
      return;
    }
    emit({
      action_type: actionType,
      ...(target
        ? {
            target: buildElementRef(target),
            value: { value: valueFor(target) },
          }
        : {}),
    });
  };

  const metadataInputHandler = (key: string) => (event: Event) => {
    const target = elementFromEvent(event);
    emit({
      action_type: 'input',
      key,
      ...(target ? { target: buildElementRef(target) } : {}),
    });
  };

  const submitHandler = (event: SubmitEvent) => {
    const target = elementFromEvent(event);
    emit({
      action_type: 'submit',
      ...(target ? { target: buildElementRef(target) } : {}),
    });
  };

  const keydownHandler = (event: KeyboardEvent) => {
    if (!isShortcut(event)) return;
    const target = elementFromEvent(event);
    emit({
      action_type: 'keydown',
      key: event.key,
      modifiers: modifiersFor(event),
      ...(target ? { target: buildElementRef(target) } : {}),
    });
  };

  const scrollHandler = (event: Event) => {
    const timestamp = now();
    if (
      event.target === document ||
      event.target === document.scrollingElement
    ) {
      if (timestamp - lastWindowScroll < SCROLL_THROTTLE_MS) return;
      lastWindowScroll = timestamp;
      emit({
        action_type: 'scroll',
        coords: { x: window.scrollX, y: window.scrollY },
      });
      return;
    }

    const target = elementFromEvent(event);
    if (!target) return;
    const last = lastScrollByTarget.get(target) ?? 0;
    if (timestamp - last < SCROLL_THROTTLE_MS) return;
    lastScrollByTarget.set(target, timestamp);
    emit({
      action_type: 'scroll',
      target: buildElementRef(target),
      coords: { x: target.scrollLeft, y: target.scrollTop },
    });
  };

  const focusHandler =
    (actionType: 'focus' | 'blur') => (event: FocusEvent) => {
      const target = elementFromEvent(event);
      emit({
        action_type: actionType,
        ...(target ? { target: buildElementRef(target) } : {}),
      });
    };

  const contextMenuHandler = (event: MouseEvent) => {
    const target = elementFromEvent(event);
    emit({
      action_type: 'contextmenu',
      ...(target ? { target: buildElementRef(target) } : {}),
      coords: { x: event.clientX, y: event.clientY },
      modifiers: modifiersFor(event),
    });
  };

  const clipboardMarkerHandler =
    (actionType: 'copy' | 'cut') => (event: ClipboardEvent) => {
      const target = elementFromEvent(event);
      emit({
        action_type: actionType,
        ...(target ? { target: buildElementRef(target) } : {}),
      });
    };

  const selectionHandler = () => {
    const text = selectedText();
    if (!text) return;
    emit({
      action_type: 'selection',
      selection: { length: text.length },
    });
  };

  on(
    window,
    'click',
    mouseHandler('click'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'dblclick',
    mouseHandler('dblclick'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'dragstart',
    dragHandler('drag'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'drop',
    dragHandler('drop'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'input',
    inputHandler('input'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'change',
    inputHandler('change'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'paste',
    metadataInputHandler('paste'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'compositionstart',
    metadataInputHandler('compositionstart'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'compositionend',
    metadataInputHandler('compositionend'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'submit',
    submitHandler,
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'keydown',
    keydownHandler,
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'scroll',
    scrollHandler,
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'focus',
    focusHandler('focus'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'blur',
    focusHandler('blur'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'contextmenu',
    contextMenuHandler,
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'copy',
    clipboardMarkerHandler('copy'),
    { capture: true, passive: true },
    cleanup
  );
  on(
    window,
    'cut',
    clipboardMarkerHandler('cut'),
    { capture: true, passive: true },
    cleanup
  );
  document.addEventListener('selectionchange', selectionHandler, {
    capture: true,
  });
  cleanup.push(() =>
    document.removeEventListener('selectionchange', selectionHandler, {
      capture: true,
    })
  );

  return {
    stop() {
      for (const dispose of cleanup.splice(0)) dispose();
    },
  };
}

function defaultSender(event: CapturedEvent): void {
  void chrome.runtime.sendMessage({ type: 'event', event });
}

function on<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options: AddEventListenerOptions,
  cleanup: Array<() => void>
): void {
  target.addEventListener(type, listener, options);
  cleanup.push(() => target.removeEventListener(type, listener, options));
}

function elementFromEvent(event: Event): Element | null {
  const target = event.target;
  return target instanceof Element ? target : null;
}

function modifiersFor(
  event: MouseEvent | KeyboardEvent
): NonNullable<ActionEvent['modifiers']> {
  const modifiers: NonNullable<ActionEvent['modifiers']> = {
    ...(event.ctrlKey ? { ctrl: true } : {}),
    ...(event.shiftKey ? { shift: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
    ...(event.metaKey ? { meta: true } : {}),
  };
  return modifiers;
}

function isShortcut(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    SHORTCUT_KEYS.has(event.key)
  );
}

function valueFor(element: Element): string {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio')
      return String(element.checked);
    return element.value;
  }
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  )
    return element.value;
  if (element instanceof HTMLElement && element.isContentEditable)
    return element.innerText;
  return '';
}

function selectedText(): string {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement
  ) {
    const start = activeElement.selectionStart;
    const end = activeElement.selectionEnd;
    if (start !== null && end !== null && end > start) {
      return activeElement.value.slice(start, end);
    }
  }

  return document.getSelection()?.toString() ?? '';
}

function fileMetadata(
  input: HTMLInputElement
): NonNullable<ActionEvent['files']> {
  const files = Array.from(input.files ?? []);
  return {
    count: files.length,
    total_bytes: files.reduce((total, file) => total + file.size, 0),
    accepted_types: input.accept
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    selected_types: [
      ...new Set(files.map((file) => file.type || 'application/octet-stream')),
    ],
  };
}
