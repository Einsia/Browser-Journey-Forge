import type { ElementRef } from '@/shared/types';

const STABLE_ATTRS = ['data-testid', 'data-test', 'data-cy', 'aria-label', 'name', 'title'] as const;
const MAX_TEXT_LENGTH = 120;

export function buildElementRef(element: Element): ElementRef {
  const rect = element.getBoundingClientRect();
  const htmlElement = element instanceof HTMLElement ? element : null;
  const text = normalizeText(element.textContent ?? '');
  const classes = Array.from(element.classList).filter(Boolean);

  return {
    tag: element.tagName.toLowerCase(),
    ...(element instanceof HTMLInputElement ? { inputType: element.type } : {}),
    ...(htmlElement?.id ? { id: htmlElement.id } : {}),
    ...(classes.length ? { classes } : {}),
    ...stringAttr('role', element.getAttribute('role')),
    ...stringAttr('name', accessibleName(element)),
    ...(text ? { text } : {}),
    selector: bestSelector(element),
    xpath: xpathFor(element),
    rect: {
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height
    }
  };
}

export function bestSelector(element: Element): string {
  const id = element.getAttribute('id');
  if (id) {
    const selector = `#${cssIdent(id)}`;
    if (isUnique(element, selector)) return selector;
  }

  for (const attr of STABLE_ATTRS) {
    const value = element.getAttribute(attr);
    if (!value) continue;
    const selector = `[${attr}="${cssString(value)}"]`;
    if (isUnique(element, selector)) return selector;
  }

  const role = element.getAttribute('role');
  if (role) {
    const selector = `[role="${cssString(role)}"]`;
    if (isUnique(element, selector)) return selector;
  }

  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    segments.unshift(segmentFor(current));
    const selector = segments.join(' > ');
    if (isUnique(element, selector)) return selector;
    if (current.tagName.toLowerCase() === 'html') break;
    current = current.parentElement;
  }

  return xpathFor(element);
}

export function xpathFor(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html') {
      parts.unshift('html');
      break;
    }

    const parent = current.parentElement;
    const siblings = parent ? Array.from(parent.children).filter((sibling) => sibling.tagName === current!.tagName) : [];
    const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : '';
    parts.unshift(`${tag}${index}`);
    current = current.parentElement;
  }

  return `/${parts.join('/')}`;
}

function segmentFor(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const stable = stableSegmentAttr(element);
  const classes = Array.from(element.classList)
    .filter((name) => /^[A-Za-z_][\w-]*$/.test(name))
    .slice(0, 2)
    .map((name) => `.${cssIdent(name)}`)
    .join('');
  let segment = `${tag}${stable ?? classes}`;

  if (needsNthOfType(element, segment)) {
    segment += `:nth-of-type(${nthOfType(element)})`;
  }

  return segment;
}

function stableSegmentAttr(element: Element): string | null {
  for (const attr of STABLE_ATTRS) {
    const value = element.getAttribute(attr);
    if (value) return `[${attr}="${cssString(value)}"]`;
  }
  const role = element.getAttribute('role');
  return role ? `[role="${cssString(role)}"]` : null;
}

function needsNthOfType(element: Element, segment: string): boolean {
  const parent = element.parentElement;
  if (!parent) return false;
  try {
    const matches = Array.from(parent.querySelectorAll(`:scope > ${segment}`));
    return matches.length !== 1 || matches[0] !== element;
  } catch {
    return true;
  }
}

function nthOfType(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  return Array.from(parent.children)
    .filter((sibling) => sibling.tagName === element.tagName)
    .indexOf(element) + 1;
}

function isUnique(element: Element, selector: string): boolean {
  try {
    const matches = Array.from(element.ownerDocument.querySelectorAll(selector));
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

function accessibleName(element: Element): string | undefined {
  return (
    normalizeText(element.getAttribute('aria-label') ?? '') ||
    normalizeText(element.getAttribute('name') ?? '') ||
    normalizeText(element.getAttribute('title') ?? '') ||
    undefined
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function stringAttr<K extends string>(key: K, value: string | null | undefined): { [P in K]?: string } {
  return (value ? { [key]: value } : {}) as { [P in K]?: string };
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ');
}

function cssIdent(value: string): string {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return value.replace(/(^-?\d)|[^\w-]/g, (match, firstDigit: string | undefined) => {
    if (firstDigit) return `\\3${firstDigit} `;
    return `\\${match}`;
  });
}
