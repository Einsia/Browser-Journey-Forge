import { describe, expect, it } from 'vitest';
import { installFormSummaryRecorder } from '@/capture/form-summary-recorder';
import type { FormSummaryEvent } from '@/shared/types';

describe('installFormSummaryRecorder', () => {
  it('emits opened, edited, and submitted summaries without raw field values', () => {
    document.body.innerHTML = `
      <form id="signup">
        <input name="email" type="email" value="">
        <input name="password" type="password" value="">
        <button type="submit">Submit</button>
      </form>
    `;
    const events: FormSummaryEvent[] = [];
    const recorder = installFormSummaryRecorder({
      traceId: 'tr_form',
      tabId: 1,
      sendEvent: (event) => {
        events.push(event as FormSummaryEvent);
      },
      now: () => 10
    });

    const email = document.querySelector('input[name="email"]')!;
    (email as HTMLInputElement).value = 'user@example.test';
    email.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    email.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));

    recorder.stop();

    expect(events.map((event) => event.phase)).toEqual(['opened', 'edited', 'submitted']);
    expect(JSON.stringify(events)).not.toContain('user@example.test');
    expect(events.at(-1)?.fields).toEqual([
      expect.objectContaining({ name: 'email', type: 'email', redactionClasses: ['classified_email'] }),
      expect.objectContaining({ name: 'password', type: 'password', redactionClasses: ['classified_password'] })
    ]);
  });

  it('emits reset summaries and removes listeners on stop', () => {
    document.body.innerHTML = `
      <form id="profile">
        <input name="phone" type="tel">
      </form>
    `;
    const events: FormSummaryEvent[] = [];
    const recorder = installFormSummaryRecorder({
      traceId: 'tr_form',
      sendEvent: (event) => {
        events.push(event as FormSummaryEvent);
      }
    });

    document.querySelector('form')!.dispatchEvent(new Event('reset', { bubbles: true }));
    recorder.stop();
    document.querySelector('form')!.dispatchEvent(new Event('reset', { bubbles: true }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'form_summary',
      phase: 'reset',
      fields: [expect.objectContaining({ name: 'phone', type: 'tel', redactionClasses: ['classified_phone'] })]
    });
  });

  it('does not emit duplicate opened or edited summaries for the same form', () => {
    document.body.innerHTML = `
      <form id="survey">
        <textarea name="address"></textarea>
      </form>
    `;
    const events: FormSummaryEvent[] = [];
    const recorder = installFormSummaryRecorder({
      traceId: 'tr_form',
      sendEvent: (event) => {
        events.push(event as FormSummaryEvent);
      }
    });

    const textarea = document.querySelector('textarea')!;
    textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

    recorder.stop();

    expect(events.map((event) => event.phase)).toEqual(['opened', 'edited']);
    expect(events.at(-1)?.fields[0]).toMatchObject({ name: 'address', type: 'textarea', redactionClasses: ['classified_address'] });
  });
});
