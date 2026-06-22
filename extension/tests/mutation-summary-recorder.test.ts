import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMutationSummaryRecorder } from '@/capture/mutation-summary-recorder';
import { redactEvent } from '@/redaction/redactor';
import type { DomMutationSummaryEvent } from '@/shared/types';

describe('mutation summary recorder', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('summarizes modal, status, list, and form-state mutations without full DOM dumps', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<form><button id="submit" disabled>Submit</button></form><ul id="results"></ul>`;
    const events: DomMutationSummaryEvent[] = [];
    const recorder = installMutationSummaryRecorder({
      traceId: 'tr_mutation',
      tabId: 1,
      now: () => 10,
      url: () => 'https://example.test/search',
      debounceMs: 50,
      sendEvent: (event) => {
        events.push(event as DomMutationSummaryEvent);
      }
    });

    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.textContent = 'Private reset token abc123 appeared';
    document.body.append(modal);
    document.querySelector('#results')!.append(document.createElement('li'));
    document.querySelector('#submit')!.removeAttribute('disabled');
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.textContent = 'Saved successfully';
    document.body.append(status);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60);
    recorder.stop();

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event).toMatchObject({
      kind: 'dom_mutation_summary',
      added_nodes: expect.any(Number),
      removed_nodes: 0,
      signals: expect.arrayContaining(['modal_added', 'status_added', 'list_changed', 'form_control_enabled'])
    });
    expect(event.selectors.length).toBeGreaterThan(0);
    expect(event.selectors.length).toBeLessThanOrEqual(20);
    expect(event.text_samples.value?.length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(event)).not.toContain('<div');
  });

  it('summarizes disabled controls and removed nodes', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<button id="toggle">Save</button><section id="remove-me">Done</section>`;
    const events: DomMutationSummaryEvent[] = [];
    const recorder = installMutationSummaryRecorder({
      traceId: 'tr_mutation',
      tabId: 1,
      debounceMs: 20,
      sendEvent: (event) => {
        events.push(event as DomMutationSummaryEvent);
      }
    });

    document.querySelector('#toggle')!.setAttribute('disabled', '');
    document.querySelector('#remove-me')!.remove();

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30);
    recorder.stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      removed_nodes: 1,
      signals: expect.arrayContaining(['form_control_disabled', 'node_removed'])
    });
  });

  it('rate-limits repeated mutation summary flushes without dropping later changes', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<section id="feed"></section>`;
    const events: DomMutationSummaryEvent[] = [];
    const recorder = installMutationSummaryRecorder({
      traceId: 'tr_mutation_rate',
      tabId: 1,
      debounceMs: 20,
      minFlushIntervalMs: 100,
      sendEvent: (event) => {
        events.push(event as DomMutationSummaryEvent);
      }
    });

    document.querySelector('#feed')!.append(document.createElement('button'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);

    document.querySelector('#feed')!.append(document.createElement('input'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);

    expect(events).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(75);
    recorder.stop();

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      added_nodes: 1
    });
  });

  it('removes raw text samples and redacts selectors and URLs during export redaction', () => {
    const redacted = redactEvent(
      {
        event_id: 'ev_mutation',
        trace_id: 'tr_mutation',
        tab_id: 1,
        timestamp: 10,
        url: 'https://example.test/reset?token=secret-token',
        kind: 'dom_mutation_summary',
        added_nodes: 1,
        removed_nodes: 0,
        attribute_changes: 0,
        signals: ['status_added'],
        selectors: ['#secret-token', '[aria-label="user@example.test"]'],
        text_samples: { value: ['Private reset token abc123 appeared'] }
      },
      undefined
    ) as DomMutationSummaryEvent;

    expect(JSON.stringify(redacted)).not.toContain('secret-token');
    expect(JSON.stringify(redacted)).not.toContain('user@example.test');
    expect(JSON.stringify(redacted)).not.toContain('Private reset token abc123 appeared');
    expect(redacted.text_samples).toMatchObject({
      value: null,
      redaction: { strategy: 'raw_removed', classes: ['classified_token'] }
    });
    expect(redacted.selectors).toEqual(['[redacted]', '[redacted]']);
    expect(redacted.url).toBe('https://example.test/reset?token=%5Bredacted%5D');
  });
});
