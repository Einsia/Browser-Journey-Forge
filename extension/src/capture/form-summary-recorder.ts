import { createId } from '@/shared/id';
import type { CapturedEvent, FormSummaryEvent, RedactionClass } from '@/shared/types';
import { bestSelector } from './selector';

export type FormSummaryRecorderOptions = {
  traceId: string;
  tabId?: number;
  sendEvent?: (event: CapturedEvent) => void | Promise<void>;
  now?: () => number;
  url?: () => string;
};

const PASSWORD_FIELD_RE = /password|passcode|pwd/i;
const EMAIL_FIELD_RE = /email|e-mail/i;
const PHONE_FIELD_RE = /phone|mobile|tel/i;
const ADDRESS_FIELD_RE = /address|street|city|state|province|postal|zip|country/i;
const PAYMENT_FIELD_RE = /card|cvc|cvv|security.?code|expiry|expiration|payment/i;
const OTP_FIELD_RE = /otp|one.?time|verification.?code|2fa|mfa/i;
const TOKEN_FIELD_RE = /token|secret|api.?key|auth/i;

export function installFormSummaryRecorder(options: FormSummaryRecorderOptions): { stop(): void } {
  const sendEvent = options.sendEvent ?? defaultSender;
  const now = options.now ?? (() => Date.now());
  const currentUrl = options.url ?? (() => location.href);
  const tabId = options.tabId ?? -1;
  const openedForms = new WeakSet<HTMLFormElement>();
  const editedForms = new WeakSet<HTMLFormElement>();
  const cleanup: Array<() => void> = [];

  const emit = (form: HTMLFormElement, phase: FormSummaryEvent['phase']) => {
    void sendEvent({
      event_id: createId('ev_'),
      trace_id: options.traceId,
      tab_id: tabId,
      timestamp: now(),
      url: currentUrl(),
      kind: 'form_summary',
      form_selector: bestSelector(form),
      phase,
      fields: summarizeFields(form)
    });
  };

  const onFocusIn = (event: Event) => {
    const form = formForTarget(event.target);
    if (!form || openedForms.has(form)) return;
    openedForms.add(form);
    emit(form, 'opened');
  };

  const onEdit = (event: Event) => {
    const form = formForTarget(event.target);
    if (!form || editedForms.has(form)) return;
    editedForms.add(form);
    emit(form, 'edited');
  };

  const onSubmit = (event: Event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : formForTarget(event.target);
    if (form) emit(form, 'submitted');
  };

  const onReset = (event: Event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : formForTarget(event.target);
    if (form) emit(form, 'reset');
  };

  on(window, 'focusin', onFocusIn, cleanup);
  on(window, 'input', onEdit, cleanup);
  on(window, 'change', onEdit, cleanup);
  on(window, 'submit', onSubmit, cleanup);
  on(window, 'reset', onReset, cleanup);

  return {
    stop() {
      for (const dispose of cleanup.splice(0)) dispose();
    }
  };
}

function defaultSender(event: CapturedEvent): void {
  void chrome.runtime.sendMessage({ type: 'event', event });
}

function summarizeFields(form: HTMLFormElement): FormSummaryEvent['fields'] {
  return Array.from(form.elements)
    .filter((element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
      return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
    })
    .filter((element) => {
      return !(element instanceof HTMLInputElement && ['button', 'submit', 'reset', 'image'].includes(element.type));
    })
    .map((element) => {
      const name = fieldName(element);
      const type = fieldType(element);
      return {
        name,
        type,
        redactionClasses: classifyField(element, name, type)
      };
    });
}

function fieldName(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  return element.getAttribute('name') || element.id || bestSelector(element);
}

function fieldType(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (element instanceof HTMLInputElement) return element.type || 'text';
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  return element.multiple ? 'select-multiple' : 'select-one';
}

function classifyField(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  name: string,
  type: string
): RedactionClass[] {
  const haystack = `${name} ${type} ${element.getAttribute('autocomplete') ?? ''}`.trim();
  const classes: RedactionClass[] = [];
  if (PASSWORD_FIELD_RE.test(haystack)) classes.push('classified_password');
  if (EMAIL_FIELD_RE.test(haystack)) classes.push('classified_email');
  if (PHONE_FIELD_RE.test(haystack)) classes.push('classified_phone');
  if (ADDRESS_FIELD_RE.test(haystack)) classes.push('classified_address');
  if (PAYMENT_FIELD_RE.test(haystack)) classes.push('classified_payment');
  if (OTP_FIELD_RE.test(haystack)) classes.push('classified_otp');
  if (TOKEN_FIELD_RE.test(haystack)) classes.push('classified_token');
  return [...new Set(classes)];
}

function formForTarget(target: EventTarget | null): HTMLFormElement | null {
  if (!(target instanceof Element)) return null;
  if (target instanceof HTMLFormElement) return target;
  return target.closest('form');
}

function on<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  cleanup: Array<() => void>
): void {
  const options: AddEventListenerOptions = { capture: true };
  target.addEventListener(type, listener, options);
  cleanup.push(() => target.removeEventListener(type, listener, options));
}
