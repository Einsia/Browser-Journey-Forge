import { describe, expect, it } from 'vitest';
import { bestSelector, buildElementRef, xpathFor } from '@/capture/selector';

describe('selector helpers', () => {
  it('prefers id selectors', () => {
    document.body.innerHTML = '<button id="submit">Submit</button>';
    const el = document.querySelector('button')!;

    expect(bestSelector(el)).toBe('#submit');
  });

  it('uses aria-label when no id exists', () => {
    document.body.innerHTML = '<button aria-label="Save draft">x</button>';
    const el = document.querySelector('button')!;

    expect(bestSelector(el)).toBe('[aria-label="Save draft"]');
  });

  it('builds xpath fallback', () => {
    document.body.innerHTML = '<main><section><button>Save</button></section></main>';
    const el = document.querySelector('button')!;

    expect(xpathFor(el)).toContain('/html');
  });

  it('escapes attribute selector values', () => {
    document.body.innerHTML = '<button aria-label=\'Save "draft"\'>x</button>';
    const el = document.querySelector('button')!;

    expect(bestSelector(el)).toBe('[aria-label="Save \\"draft\\""]');
    expect(document.querySelector(bestSelector(el))).toBe(el);
  });

  it('adds nth-of-type when a candidate selector is not unique', () => {
    document.body.innerHTML = `
      <form>
        <button class="primary">Cancel</button>
        <button class="primary">Save</button>
      </form>
    `;
    const el = document.querySelectorAll('button')[1]!;

    expect(bestSelector(el)).toBe('button.primary:nth-of-type(2)');
    expect(document.querySelector(bestSelector(el))).toBe(el);
  });

  it('builds an element ref with normalized text and rect', () => {
    document.body.innerHTML = '<button id="save" role="button"> Save draft </button>';
    const el = document.querySelector('button')!;
    el.getBoundingClientRect = () =>
      ({
        x: 1,
        y: 2,
        width: 3,
        height: 4
      }) as DOMRect;

    expect(buildElementRef(el)).toMatchObject({
      tag: 'button',
      id: 'save',
      role: 'button',
      text: 'Save draft',
      selector: '#save',
      rect: { x: 1, y: 2, w: 3, h: 4 }
    });
  });

  it('captures password input type metadata when the name is not password-like', () => {
    document.body.innerHTML = '<input type="password" name="current" value="secret">';
    const el = document.querySelector('input')!;

    expect(buildElementRef(el)).toMatchObject({
      tag: 'input',
      name: 'current',
      inputType: 'password'
    });
  });
});
