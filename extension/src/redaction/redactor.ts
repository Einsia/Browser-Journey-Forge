import type {
  CapturedEvent,
  DomNode,
  ElementRef,
  FormSummaryEvent,
  FrameMetadata,
  IdentityBundle,
  RedactedValue,
  Redaction,
  RedactionClass
} from '@/shared/types';
import { sha256HexSync } from '@/shared/hash';

const LARGE_BODY_LIMIT = 4096;
const MAX_STRUCTURED_DEPTH = 32;
const INTERNAL_URL_MARKER = '[internal-url-redacted]';
const REDACTED_STRING_MARKER = '[redacted]';
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?\d[\s().-]*){7,15}/;
const DIGIT_RE = /\d/g;
const OTP_RE = /\b\d{4,8}\b/;
const PASSWORD_FIELD_RE = /pass(word)?|pwd|secret/i;
const EMAIL_FIELD_RE = /e-?mail/i;
const PHONE_FIELD_RE = /phone|mobile|tel/i;
const PAYMENT_FIELD_RE = /card|cc|cvc|cvv|payment|expir(y|ation|e)?|exp_(month|year)/i;
const OTP_CONTEXT_RE = /otp|one[-_\s]?time|verification|verify|2fa|mfa|code/i;
const GOV_ID_FIELD_RE = /ssn|social[-_\s]?security|passport|government[-_\s]?id|national[-_\s]?id|tax[-_\s]?id/i;
const TOKEN_HEADER_RE = /^(authorization|cookie|set-cookie)$/i;
const TOKEN_HEADER_PART_RE = /(bearer|auth|csrf|xsrf|session|token|api[-_]?key|access[-_]?token|refresh[-_]?token)/i;
const SENSITIVE_QUERY_KEY_RE =
  /password|pwd|secret|token|auth|api[-_]?key|access[-_]?token|refresh[-_]?token|csrf|xsrf|session|cookie|email|phone|card|cvc|cvv|otp|code|verification|ssn|passport|government|national|tax[-_\s]?id/i;
const INTERNAL_PROTOCOLS = new Set([
  'about:',
  'blob:',
  'browser:',
  'chrome:',
  'chrome-extension:',
  'data:',
  'file:',
  'moz-extension:',
  'resource:',
  'view-source:'
]);

type RedactionContext = {
  fieldName?: string | undefined;
  inputType?: string | undefined;
  headerName?: string | undefined;
  identity?: IdentityBundle | undefined;
  body?: boolean | undefined;
};

export function redactText(value: string, context?: RedactionContext): RedactedValue {
  const classes = classifyText(value, context ?? {});
  if (classes.length === 0) {
    return { value };
  }

  return {
    value: null,
    redaction: buildRedaction(value, classes, classes.includes('large_body') ? 'body_excluded' : 'raw_removed')
  };
}

export type RedactEventOptions = {
  // ClawBench V2: keep raw request bodies (research mode, fake identity only).
  keepRequestBodies?: boolean;
};

export function redactEvent(
  event: CapturedEvent,
  identity?: IdentityBundle,
  opts?: RedactEventOptions
): CapturedEvent {
  switch (event.kind) {
    case 'navigation':
      return {
        ...event,
        url: redactUrl(event.url, identity),
        ...(event.from_url ? { from_url: redactUrl(event.from_url, identity) } : {}),
        ...(event.to_url ? { to_url: redactUrl(event.to_url, identity) } : {})
      };
    case 'action': {
      const targetContext = contextForElementRef(event.target, identity);
      return {
        ...event,
        url: redactUrl(event.url, identity),
        ...(event.target ? { target: redactElementRef(event.target, identity) } : {}),
        ...(event.value ? { value: redactValue(event.value, targetContext) } : {}),
        ...(event.selection?.text
          ? {
              selection: {
                ...event.selection,
                text: removeRawValue(event.selection.text)
              }
            }
          : {}),
        ...(event.files?.filenames
          ? {
              files: {
                ...event.files,
                filenames: removeRawValue(event.files.filenames)
              }
            }
          : {})
      };
    }
    case 'dom_snapshot': {
      return {
        ...event,
        url: redactUrl(event.url, identity),
        nodes: event.nodes.map((node) => redactDomNode(node, identity))
      };
    }
    case 'dom_mutation_summary':
      return {
        ...event,
        url: redactUrl(event.url, identity),
        selectors: event.selectors.map((selector) => redactMutationSelector(selector, identity)),
        text_samples: removeRawValue(event.text_samples)
      };
    case 'network_request': {
      return {
        ...event,
        url: redactUrl(event.url, identity),
        full_url: redactUrl(event.full_url, identity),
        ...(event.initiator ? { initiator: redactUrl(event.initiator, identity) } : {}),
        req_headers: Object.fromEntries(
          Object.entries(event.req_headers).map(([name, header]) => [
            name,
            redactValue(header, { identity, headerName: name, fieldName: name })
          ])
        ),
        ...(event.req_body
          ? {
              // V2 research mode keeps the raw body so the judge can read the
              // submission; request headers are still redacted above.
              req_body: opts?.keepRequestBodies
                ? event.req_body
                : redactValue(event.req_body, {
                    identity,
                    fieldName: 'request_body',
                    body: true
                  })
            }
          : {})
      };
    }
    case 'network_response': {
      return {
        ...event,
        url: redactUrl(event.url, identity),
        ...(event.res_body
          ? {
              res_body: redactValue(event.res_body, {
                identity,
                fieldName: 'response_body',
                body: true
              })
            }
          : {})
      };
    }
    case 'network_stream':
      return {
        ...event,
        url: redactUrl(event.url, identity),
        full_url: redactUrl(event.full_url, identity)
      };
    case 'download':
      return {
        ...event,
        url: redactUrl(event.url, identity),
        ...(event.source_url ? { source_url: redactUrl(event.source_url, identity) } : {})
      };
    case 'screenshot':
    case 'video_chunk':
      return {
        ...event,
        url: redactUrl(event.url, identity)
      };
    case 'form_summary': {
      return redactFormSummary({ ...event, url: redactUrl(event.url, identity) }, identity);
    }
    case 'annotation': {
      return event.text
        ? {
            ...event,
            url: redactUrl(event.url, identity),
            text: redactAnnotationText(event.text, identity)
          }
        : { ...event, url: redactUrl(event.url, identity) };
    }
  }
}

function redactValue<T>(input: RedactedValue<T>, context: RedactionContext): RedactedValue<T> {
  if (typeof input.value !== 'string') {
    return copyRedactedValue(input);
  }

  const redacted = redactText(input.value, context);
  if (!redacted.redaction) {
    return { ...input, value: input.value };
  }

  return redacted as RedactedValue<T>;
}

function removeRawValue<T>(input: RedactedValue<T>): RedactedValue<T> {
  if (input.value === null) return copyRedactedValue(input);
  const serialized = Array.isArray(input.value) ? input.value.join('\n') : String(input.value);
  return {
    value: null,
    redaction: {
      strategy: 'raw_removed',
      classes: ['classified_token'],
      digest: digestFor(serialized),
      originalLength: serialized.length
    }
  };
}

function redactElementRef(target: ElementRef, identity?: IdentityBundle): ElementRef {
  return {
    ...target,
    ...(target.id ? { id: redactMetadataString(target.id, { identity }) } : {}),
    ...(target.name ? { name: redactMetadataString(target.name, { identity }) } : {}),
    ...(target.text ? { text: redactMetadataString(target.text, contextForElementRef(target, identity)) } : {}),
    ...(target.selector ? { selector: redactMetadataString(target.selector, { identity }) } : {}),
    ...(target.xpath ? { xpath: redactMetadataString(target.xpath, { identity }) } : {}),
    ...(target.classes ? { classes: target.classes.map((className) => redactMetadataString(className, { identity })) } : {})
  };
}

function redactDomNode(node: DomNode, identity?: IdentityBundle): DomNode {
  const context = contextForDomNode(node, identity);
  return {
    ...node,
    ...(node.name ? { name: redactMetadataString(node.name, context) } : {}),
    ...(node.selector ? { selector: redactMetadataString(node.selector, context) } : {}),
    ...(node.href ? { href: redactUrl(node.href, identity) } : {}),
    ...(node.text ? { text: redactValue(node.text, context) } : {}),
    ...(node.value ? { value: redactValue(node.value, context) } : {}),
    ...(node.frame ? { frame: redactFrameMetadata(node.frame, identity) } : {})
  };
}

function redactFrameMetadata(frame: FrameMetadata, identity?: IdentityBundle): FrameMetadata {
  return {
    ...frame,
    ...(frame.srcHost ? { srcHost: redactMetadataString(frame.srcHost, { identity }) } : {}),
    ...(frame.srcPath ? { srcPath: redactMetadataString(frame.srcPath, { identity }) } : {}),
    ...(frame.title ? { title: redactMetadataString(frame.title, { identity }) } : {}),
    ...(frame.name ? { name: redactMetadataString(frame.name, { identity }) } : {}),
    ...(frame.sandbox ? { sandbox: redactMetadataString(frame.sandbox, { identity }) } : {})
  };
}

function redactFormSummary(event: FormSummaryEvent, identity?: IdentityBundle): FormSummaryEvent {
  return {
    ...event,
    fields: event.fields.map((field) => {
      const classes = mergeClasses(
        field.redactionClasses,
        classifyText(field.name, {
          identity,
          fieldName: field.name,
          inputType: field.type
        })
      ).filter((redactionClass) => redactionClass !== 'large_body');
      return {
        ...field,
        redactionClasses: classes,
        ...(classes.length > 0 ? { digest: field.digest ?? digestFor(`${field.name}:${field.type}`) } : {})
      };
    })
  };
}

function redactAnnotationText(value: string, identity?: IdentityBundle): string {
  const redacted = redactText(value, { identity });
  return redacted.value ?? REDACTED_STRING_MARKER;
}

function redactMetadataString(value: string, context: RedactionContext): string {
  const redacted = redactText(value, context);
  return redacted.redaction ? REDACTED_STRING_MARKER : value;
}

function redactMutationSelector(value: string, identity?: IdentityBundle): string {
  if (SENSITIVE_QUERY_KEY_RE.test(value)) return REDACTED_STRING_MARKER;
  return redactMetadataString(value, { identity });
}

function classifyText(value: string, context: RedactionContext): RedactionClass[] {
  const classes: RedactionClass[] = [];
  const field = `${context.fieldName ?? ''} ${context.inputType ?? ''}`;

  if (context.headerName && isSensitiveHeader(context.headerName)) {
    classes.push('classified_token');
  }

  if (context.body) {
    classes.push(...classifyStructuredBody(value));
  }

  if (isInternalUrl(value)) {
    classes.push('classified_token');
  }

  if (value.length > LARGE_BODY_LIMIT) {
    classes.push('large_body');
  }

  if (PASSWORD_FIELD_RE.test(field) || context.inputType?.toLowerCase() === 'password') {
    classes.push('classified_password');
  }
  if (context.inputType?.toLowerCase() === 'file') {
    classes.push('classified_token');
  }
  if (EMAIL_FIELD_RE.test(field)) {
    classes.push('classified_email');
  }
  if (PHONE_FIELD_RE.test(field)) {
    classes.push('classified_phone');
  }
  if (PAYMENT_FIELD_RE.test(field)) {
    classes.push('classified_payment');
  }
  // There is no government identifier redaction class in v1. Use token because these values behave like
  // high-risk identifiers and should never be exposed as free text.
  if (GOV_ID_FIELD_RE.test(field)) {
    classes.push('classified_token');
  }
  if (OTP_CONTEXT_RE.test(field) && OTP_RE.test(value)) {
    classes.push('classified_otp');
  }
  if (OTP_CONTEXT_RE.test(value) && OTP_RE.test(value)) {
    classes.push('classified_otp');
  }

  for (const identityClass of classifyIdentityMatch(value, context.identity)) {
    classes.push(identityClass);
  }

  if (EMAIL_RE.test(value)) {
    classes.push('classified_email');
  }

  const digits = digitsOnly(value);
  if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
    classes.push('classified_payment');
  } else if (PHONE_RE.test(value) && digits.length >= 7 && digits.length <= 15) {
    classes.push('classified_phone');
  }

  return mergeClasses([], classes);
}

function classifyStructuredBody(value: string): RedactionClass[] {
  return mergeClasses(classifyJsonBody(value), classifyUrlEncodedBody(value));
}

function classifyJsonBody(value: string): RedactionClass[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];

  try {
    return classifyStructuredValue(JSON.parse(trimmed));
  } catch {
    return [];
  }
}

function classifyStructuredValue(value: unknown, key = '', depth = 0): RedactionClass[] {
  const classes: RedactionClass[] = [];
  if (key) {
    classes.push(...classesForSensitiveKey(key, String(value ?? '')));
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') classes.push(...classifyText(value, {}));
    return mergeClasses([], classes);
  }
  // Guard against stack overflow on pathologically nested network bodies.
  if (depth >= MAX_STRUCTURED_DEPTH) return mergeClasses([], classes);
  if (Array.isArray(value)) {
    for (const item of value) classes.push(...classifyStructuredValue(item, key, depth + 1));
    return mergeClasses([], classes);
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    classes.push(...classifyStructuredValue(childValue, childKey, depth + 1));
  }
  return mergeClasses([], classes);
}

function classifyUrlEncodedBody(value: string): RedactionClass[] {
  if (!value.includes('=')) return [];
  const classes: RedactionClass[] = [];
  const params = new URLSearchParams(value);
  for (const [key, paramValue] of params.entries()) {
    classes.push(...classesForSensitiveKey(key, paramValue));
    classes.push(...classifyText(paramValue, {}));
  }
  return mergeClasses([], classes);
}

function classesForSensitiveKey(key: string, value: string): RedactionClass[] {
  const classes: RedactionClass[] = [];
  if (PASSWORD_FIELD_RE.test(key)) classes.push('classified_password');
  if (EMAIL_FIELD_RE.test(key)) classes.push('classified_email');
  if (PHONE_FIELD_RE.test(key)) classes.push('classified_phone');
  if (PAYMENT_FIELD_RE.test(key)) classes.push('classified_payment');
  if (TOKEN_HEADER_PART_RE.test(key) || /cookie/i.test(key)) classes.push('classified_token');
  if (OTP_CONTEXT_RE.test(key) && (!value || OTP_RE.test(value) || /code/i.test(key))) classes.push('classified_otp');
  // No dedicated SSN/government ID class exists in v1; classify as token to force removal.
  if (GOV_ID_FIELD_RE.test(key)) classes.push('classified_token');
  return mergeClasses([], classes);
}

function classifyIdentityMatch(value: string, identity?: IdentityBundle): RedactionClass[] {
  if (!identity) return [];
  if (value === identity.email) return ['classified_email'];
  if (value === identity.email_password) return ['classified_password'];

  const classes: RedactionClass[] = [];
  for (const [key, personaValue] of Object.entries(identity.persona)) {
    if (!personaValue || value !== personaValue) continue;
    if (EMAIL_FIELD_RE.test(key) || EMAIL_RE.test(personaValue)) classes.push('classified_email');
    else if (PHONE_FIELD_RE.test(key) || PHONE_RE.test(personaValue)) classes.push('classified_phone');
    else if (/address|street|city|state|zip|postal|name/i.test(key)) classes.push('classified_address');
    else classes.push('classified_address');
  }
  for (const [key, paymentValue] of Object.entries(identity.payment)) {
    if (key === 'enabled' || paymentValue === null || paymentValue === undefined) continue;
    if (String(paymentValue) === value) classes.push('classified_payment');
  }
  return classes;
}

function buildRedaction(value: string, classes: RedactionClass[], strategy: Redaction['strategy']): Redaction {
  return {
    strategy,
    classes,
    digest: digestFor(value),
    originalLength: value.length
  };
}

function contextForElementRef(target: ElementRef | undefined, identity?: IdentityBundle): RedactionContext {
  if (!target) return { identity };
  return {
    identity,
    fieldName: [target.name, target.id, target.selector, target.tag, target.role].filter(Boolean).join(' '),
    inputType: target.inputType
  };
}

function contextForDomNode(node: DomNode, identity?: IdentityBundle): RedactionContext {
  return {
    identity,
    fieldName: [node.name, node.selector, node.tag].filter(Boolean).join(' '),
    inputType: node.inputType
  };
}

function copyRedactedValue<T>(input: RedactedValue<T>): RedactedValue<T> {
  return input.redaction ? { value: input.value, redaction: { ...input.redaction, classes: [...input.redaction.classes] } } : { ...input };
}

function redactUrl(url: string, identity?: IdentityBundle): string {
  if (isInternalUrl(url)) return INTERNAL_URL_MARKER;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return url;
  if (!parsed.search) return url;

  let changed = false;
  for (const [key, value] of parsed.searchParams.entries()) {
    if (isSensitiveQueryParam(key, value, identity)) {
      parsed.searchParams.set(key, REDACTED_STRING_MARKER);
      changed = true;
    }
  }

  return changed ? parsed.toString() : url;
}

function isInternalUrl(value: string): boolean {
  try {
    return INTERNAL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return /^(about|blob|browser|chrome|chrome-extension|data|file|moz-extension|resource|view-source):/i.test(value);
  }
}

function isSensitiveQueryParam(key: string, value: string, identity?: IdentityBundle): boolean {
  if (SENSITIVE_QUERY_KEY_RE.test(key)) return true;
  if (classifyIdentityMatch(value, identity).length > 0) return true;
  if (EMAIL_RE.test(value)) return true;

  const digits = digitsOnly(value);
  if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  if (PHONE_RE.test(value) && digits.length >= 7 && digits.length <= 15) return true;
  return OTP_CONTEXT_RE.test(key) && OTP_RE.test(value);
}

function isSensitiveHeader(headerName: string): boolean {
  return TOKEN_HEADER_RE.test(headerName) || TOKEN_HEADER_PART_RE.test(headerName);
}

function mergeClasses(existing: RedactionClass[], next: RedactionClass[]): RedactionClass[] {
  return [...new Set([...existing, ...next])];
}

function digitsOnly(value: string): string {
  return Array.from(String(value).matchAll(DIGIT_RE), (match) => match[0]).join('');
}

function luhnValid(value: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum > 0 && sum % 10 === 0;
}

function digestFor(value: string): string {
  return `sha256:${sha256HexSync(value)}`;
}
