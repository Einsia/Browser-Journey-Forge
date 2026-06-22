import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRecordingExport } from '@/storage/export-recording';
import { db } from '@/storage/db';
import { redactEvent } from '@/redaction/redactor';
import type { UploadManifestWithPayload } from '@/upload/manifest';
import type { BlobRow, RecordingRow } from '@/shared/types';

describe('recording export', () => {
  afterEach(async () => {
    await db.blobs.clear();
    await db.events.clear();
    await db.recordings.clear();
    await db.uploadManifests.clear();
  });

  it('exports a local recording with events and media blobs for recovery inspection', async () => {
    const row = recording('tr_export');
    row.envelope = {
      ...row.envelope,
      label: 'fill out survey',
      description: 'researcher reviewed path',
      tags: ['survey', 'reviewed'],
    };
    await db.recordings.put(row);
    await db.events.put({
      event_id: 'ev_action',
      trace_id: 'tr_export',
      tab_id: 1,
      timestamp: 2,
      url: 'https://example.test',
      kind: 'action',
      action_type: 'click'
    });
    await db.blobs.put({
      blob_key: 'blob_screen',
      trace_id: 'tr_export',
      kind: 'screenshot',
      data: new NodeBlob(['png-bytes'], { type: 'image/png' }) as Blob,
      created_at: 3,
      sha256: 'sha'
    } satisfies BlobRow);
    const manifestWithPayload: UploadManifestWithPayload = {
      trace_id: 'tr_export',
      upload_id: 'upl_export',
      finalized: false,
      chunks: [{ index: 0, kind: 'events', sha256: 'chunk-sha', bytes: 12, uploaded: false }],
      payloads: [{ index: 0, kind: 'events', contentEncoding: 'gzip', body: new Uint8Array([1, 2, 3]).buffer }],
      redaction_report: {},
      event_counts: {},
      media_counts: { screenshot: 0, video: 0 }
    };
    await db.uploadManifests.put(manifestWithPayload);

    const exported = await buildRecordingExport('tr_export');

    expect(exported.schema_version).toBe('journey_local_export_v1');
    expect(exported.recording.trace_id).toBe('tr_export');
    expect(exported.recording.envelope).toMatchObject({
      label: 'fill out survey',
      description: 'researcher reviewed path',
      tags: ['survey', 'reviewed'],
    });
    expect(exported.events.map((event) => event.event_id)).toEqual(['ev_action']);
    expect(exported.media).toEqual([
      expect.objectContaining({
        blob_key: 'blob_screen',
        kind: 'screenshot',
        content_type: 'image/png',
        data_base64: 'cG5nLWJ5dGVz'
      })
    ]);
    expect(exported.upload_manifest).toEqual({
      trace_id: 'tr_export',
      upload_id: 'upl_export',
      finalized: false,
      chunks: [{ index: 0, kind: 'events', sha256: 'chunk-sha', bytes: 12, uploaded: false }]
    });
    expect(JSON.stringify(exported)).not.toContain('payloads');
  });

  it('exports redacted events instead of raw IndexedDB payloads', async () => {
    const traceId = 'tr_export_redaction';
    const row = recording(traceId);
    // This test asserts the default redaction path; V2 body retention is opted
    // out here (covered separately by redactor.test.ts).
    row.envelope.capture_settings = {
      screenshots: false,
      video: true,
      networkBodies: true,
      keepRequestBodies: false
    };
    row.identity = {
      identity_bundle_id: 'id_export',
      email: 'deep-verify@example.test',
      email_password: 'verify-password-123',
      webmail_url: 'https://mail.example.test/user/login',
      persona: { first_name: 'Alex', last_name: 'Green' },
      payment: { enabled: true, card_number: '4242424242424242', cvc: '123' },
      expires_at: '2026-06-04T00:00:00.000Z'
    };
    await db.recordings.put(row);
    await db.events.bulkPut([
      {
        event_id: 'ev_network_password',
        trace_id: traceId,
        tab_id: 1,
        timestamp: 1,
        url: 'https://example.test/login',
        kind: 'network_request',
        request_id: 'req_1',
        method: 'POST',
        full_url: 'https://example.test/api/login',
        fetch_kind: 'fetch',
        req_headers: {},
        req_body: {
          value: JSON.stringify({
            email: 'deep-verify@example.test',
            password: 'verify-password-123',
            card_number: '4242424242424242',
            cvc: '123',
            site_echo: '4242424242424242'
          })
        }
      },
      {
        event_id: 'ev_dom_password',
        trace_id: traceId,
        tab_id: 1,
        timestamp: 2,
        url: 'https://example.test/login',
        kind: 'dom_snapshot',
        hash: 'hash_1',
        nodes: [
          {
            ref: 1,
            tag: 'input',
            inputType: 'password',
            name: 'password',
            selector: 'input[name="password"]',
            value: { value: 'verify-password-123' }
          }
        ]
      }
    ]);

    const exported = await buildRecordingExport(traceId);
    const rawJson = JSON.stringify(exported);

    expect(rawJson).not.toContain('verify-password-123');
    expect(rawJson).not.toContain('deep-verify@example.test');
    expect(rawJson).not.toContain('4242424242424242');
    expect(exported.recording.identity).toBeUndefined();
    expect(exported.events).toEqual([
      redactEvent((await db.events.get('ev_network_password'))!, row.identity),
      redactEvent((await db.events.get('ev_dom_password'))!, row.identity)
    ]);
  });

  it('omits locally excluded media from recording exports', async () => {
    await db.recordings.put(recording('tr_export_media_excluded'));
    await db.blobs.bulkPut([
      {
        blob_key: 'blob_keep',
        trace_id: 'tr_export_media_excluded',
        kind: 'screenshot',
        data: new NodeBlob(['keep-png'], { type: 'image/png' }) as Blob,
        created_at: 1
      },
      {
        blob_key: 'blob_drop',
        trace_id: 'tr_export_media_excluded',
        kind: 'screenshot',
        data: new NodeBlob(['drop-png'], { type: 'image/png' }) as Blob,
        created_at: 2,
        excluded_from_upload: true,
        excluded_at: 3
      }
    ] satisfies BlobRow[]);

    const exported = await buildRecordingExport('tr_export_media_excluded');

    expect(exported.media.map((blob) => blob.blob_key)).toEqual(['blob_keep']);
    expect(JSON.stringify(exported.media)).toContain('a2VlcC1wbmc=');
    expect(JSON.stringify(exported.media)).not.toContain('ZHJvcC1wbmc=');
  });

  it('fails loudly when exporting a missing recording', async () => {
    await expect(buildRecordingExport('tr_missing')).rejects.toThrow('recording not found: tr_missing');
  });
});

function recording(traceId: string): RecordingRow {
  return {
    trace_id: traceId,
    status: 'review_required',
    created_at: 1,
    updated_at: 1,
    envelope: {
      schema_version: 'journey_trace_v1',
      trace_id: traceId,
      recording_mode: 'research_free_form',
      started_at: '2026-06-03T00:00:00.000Z',
      tags: [],
      browser: { extension_version: '0.1.0', user_agent: 'vitest', timezone: 'UTC' },
      summary: {
        domains: ['example.test'],
        duration_ms: 1000,
        event_counts: { action: 1 },
        screenshot_count: 1,
        video_chunk_count: 0
      }
    }
  };
}
