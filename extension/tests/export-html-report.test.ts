import { describe, expect, it } from 'vitest';
import { buildRecordingHtmlReport } from '@/storage/export-html-report';
import type { RecordingExport } from '@/storage/export-recording';

describe('recording HTML report export', () => {
  it('renders a self-contained trace report with skill-distillation sections and media previews', () => {
    const html = buildRecordingHtmlReport(exportedTrace(), { requireSkillSignals: true });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Journey Forge Trace Report');
    expect(html).toContain('tr_html');
    expect(html).toContain('Event Counts');
    expect(html).toContain('Timeline');
    expect(html).toContain('Forms');
    expect(html).toContain('DOM Snapshots');
    expect(html).toContain('Media');
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('escapes labels and descriptions before rendering HTML', () => {
    const exported = exportedTrace();
    exported.recording.envelope.label = '<script>alert("x")</script>';
    exported.recording.envelope.description = 'try <b>bold</b>';

    const html = buildRecordingHtmlReport(exported);

    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('try <b>bold</b>');
    expect(html).toContain('&lt;script&gt;alert');
    expect(html).toContain('try &lt;b&gt;bold&lt;/b&gt;');
  });

  it('warns when required skill signal events are missing', () => {
    const exported = exportedTrace();
    exported.events = exported.events.filter((event) => event.kind !== 'form_summary');

    const html = buildRecordingHtmlReport(exported, { requireSkillSignals: true });

    expect(html).toContain('Missing form_summary events');
  });
});

function exportedTrace(): RecordingExport {
  return {
    schema_version: 'journey_local_export_v1',
    exported_at: '2026-06-04T00:00:00.000Z',
    recording: {
      trace_id: 'tr_html',
      status: 'accepted',
      created_at: 1,
      updated_at: 2,
      envelope: {
        schema_version: 'journey_trace_v1',
        trace_id: 'tr_html',
        recording_mode: 'research_free_form',
        started_at: '2026-06-04T00:00:00.000Z',
        ended_at: '2026-06-04T00:01:00.000Z',
        label: 'HTML trace report',
        description: 'Reviewable local export',
        tags: ['html'],
        browser: { extension_version: '0.1.0', user_agent: 'vitest', timezone: 'UTC' },
        summary: {
          domains: ['example.test'],
          duration_ms: 60_000,
          event_counts: { navigation: 1, action: 1, dom_snapshot: 1, form_summary: 1 },
          screenshot_count: 1,
          video_chunk_count: 0
        }
      }
    },
    events: [
      {
        event_id: 'ev_nav',
        trace_id: 'tr_html',
        tab_id: 1,
        timestamp: 1,
        url: 'https://example.test',
        kind: 'navigation',
        nav_type: 'load'
      },
      {
        event_id: 'ev_action',
        trace_id: 'tr_html',
        tab_id: 1,
        timestamp: 2,
        url: 'https://example.test',
        kind: 'action',
        action_type: 'click'
      },
      {
        event_id: 'ev_dom',
        trace_id: 'tr_html',
        tab_id: 1,
        timestamp: 3,
        url: 'https://example.test',
        kind: 'dom_snapshot',
        hash: 'dom_hash',
        nodes: [
          {
            ref: 1,
            tag: 'button',
            text: { value: 'Submit' },
            selector: '#submit'
          }
        ]
      },
      {
        event_id: 'ev_form',
        trace_id: 'tr_html',
        tab_id: 1,
        timestamp: 4,
        url: 'https://example.test',
        kind: 'form_summary',
        form_selector: '#signup',
        phase: 'submitted',
        fields: [{ name: 'email', type: 'email', redactionClasses: ['classified_email'], digest: 'email_digest' }]
      }
    ],
    media: [
      {
        blob_key: 'blob_screen',
        kind: 'screenshot',
        created_at: 5,
        content_type: 'image/png',
        bytes: 8,
        data_base64: 'iVBORw0KGgo='
      }
    ]
  };
}
