import { afterEach, describe, expect, it, vi } from 'vitest';
import { installActionRecorder } from '@/capture/action-recorder';
import type { ActionEvent } from '@/shared/types';

describe('action recorder', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('captures drag, drop, paste, and composition without clipboard or composition text', () => {
    document.body.innerHTML = `
      <input id="field" name="field" value="">
      <div id="drag-source" draggable="true">Drag source</div>
      <div id="drop-target">Drop target</div>
    `;
    const events: ActionEvent[] = [];
    const recorder = installActionRecorder({
      traceId: 'tr_actions',
      tabId: 1,
      now: () => 10,
      url: () => 'https://example.test/form',
      sendEvent: (event) => {
        events.push(event as ActionEvent);
      },
    });

    document
      .querySelector('#drag-source')!
      .dispatchEvent(
        new MouseEvent('dragstart', { bubbles: true, clientX: 10, clientY: 12 })
      );
    document
      .querySelector('#drop-target')!
      .dispatchEvent(
        new MouseEvent('drop', { bubbles: true, clientX: 30, clientY: 36 })
      );

    const input = document.querySelector<HTMLInputElement>('#field')!;
    const paste = new Event('paste', { bubbles: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'secret-clipboard-text' },
    });
    input.dispatchEvent(paste);
    input.dispatchEvent(
      new CompositionEvent('compositionstart', {
        bubbles: true,
        data: 'secret-composition-text',
      })
    );
    input.dispatchEvent(
      new CompositionEvent('compositionend', {
        bubbles: true,
        data: 'secret-composition-text',
      })
    );

    recorder.stop();

    expect(events.map((event) => event.action_type)).toEqual([
      'drag',
      'drop',
      'input',
      'input',
      'input',
    ]);
    expect(events.map((event) => event.key)).toEqual([
      undefined,
      undefined,
      'paste',
      'compositionstart',
      'compositionend',
    ]);
    expect(JSON.stringify(events)).not.toContain('secret-clipboard-text');
    expect(JSON.stringify(events)).not.toContain('secret-composition-text');
  });

  it('captures high-signal interaction markers without raw selected text or file names', () => {
    document.body.innerHTML = `
      <input id="file" type="file" accept="application/pdf,.txt" multiple>
      <textarea id="notes">copy me</textarea>
      <button id="menu">Menu</button>
    `;
    const events: ActionEvent[] = [];
    const recorder = installActionRecorder({
      traceId: 'tr_actions_more',
      tabId: 1,
      now: () => 10,
      url: () => 'https://example.test/form',
      sendEvent: (event) => {
        events.push(event as ActionEvent);
      },
    });

    const notes = document.querySelector<HTMLTextAreaElement>('#notes')!;
    notes.focus();
    notes.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    notes.setSelectionRange(0, 4);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    notes.dispatchEvent(new Event('copy', { bubbles: true }));
    notes.dispatchEvent(new Event('cut', { bubbles: true }));
    document
      .querySelector('#menu')!
      .dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 5 })
      );
    document
      .querySelector('#menu')!
      .dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          deltaX: 1,
          deltaY: 20,
          deltaMode: 0,
        })
      );

    const file = document.querySelector<HTMLInputElement>('#file')!;
    Object.defineProperty(file, 'files', {
      configurable: true,
      value: [
        { name: 'private-resume.pdf', size: 1200, type: 'application/pdf' },
        { name: 'notes.txt', size: 100, type: 'text/plain' },
      ],
    });
    file.dispatchEvent(new Event('change', { bubbles: true }));

    notes.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    recorder.stop();

    expect(events.map((event) => event.action_type)).toEqual(
      expect.arrayContaining([
        'focus',
        'selection',
        'copy',
        'cut',
        'contextmenu',
        'file_select',
        'blur',
      ])
    );
    expect(events.map((event) => event.action_type)).not.toContain('wheel');
    expect(JSON.stringify(events)).not.toContain('private-resume.pdf');
    expect(
      events.find((event) => event.action_type === 'selection')
    ).toMatchObject({
      selection: { length: 4 },
    });
    expect(
      events.find((event) => event.action_type === 'selection')?.selection?.text
    ).toBeUndefined();
    expect(
      events.find((event) => event.action_type === 'file_select')
    ).toMatchObject({
      files: {
        count: 2,
        total_bytes: 1300,
        accepted_types: ['application/pdf', '.txt'],
        selected_types: ['application/pdf', 'text/plain'],
      },
    });
  });

  it('ignores raw wheel ticks because scroll events carry the useful signal', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="scroll-zone">Scrollable area</div>`;
    const events: ActionEvent[] = [];
    const recorder = installActionRecorder({
      traceId: 'tr_wheel',
      tabId: 1,
      now: () => 10,
      url: () => 'https://example.test/map',
      sendEvent: (event) => {
        events.push(event as ActionEvent);
      },
    });

    const target = document.querySelector('#scroll-zone')!;
    target.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        clientX: 10,
        clientY: 12,
        deltaX: 1,
        deltaY: 20,
        deltaMode: 0,
      })
    );
    target.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        clientX: 10,
        clientY: 24,
        deltaX: 2,
        deltaY: 30,
        deltaMode: 0,
      })
    );
    target.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        clientX: 10,
        clientY: 36,
        deltaX: 3,
        deltaY: 40,
        deltaMode: 0,
      })
    );

    await vi.advanceTimersByTimeAsync(260);
    recorder.stop();

    expect(events).toHaveLength(0);
  });
});
