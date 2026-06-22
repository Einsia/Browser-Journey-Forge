import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  finalizeTraceUpload,
  getTraceUploadStatus,
  initTraceUpload,
  uploadChunk,
  UploadApiError
} from '@/upload/client';

const endpointUrl = 'https://api.example.test/base/';
const apiKey = 'test-api-key';

describe('upload API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes trace uploads with normalized paths and bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ upload_id: 'upl_1', accepted_chunks: [0], status: 'initialized' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await initTraceUpload({
      endpointUrl,
      apiKey,
      trace: {
        trace_id: 'tr_1',
        schema_version: 'journey_trace_v1',
        recording_mode: 'research_free_form',
        label: 'Survey',
        description: '',
        tags: ['research'],
        identity_bundle_id: 'idb_1',
        summary: { event_counts: { action: 1 } },
        capture_settings: { screenshots: true }
      }
    });

    expect(result).toEqual({ uploadId: 'upl_1', acceptedChunks: [0], status: 'initialized' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/base/v1/traces/init',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          trace_id: 'tr_1',
          schema_version: 'journey_trace_v1',
          recording_mode: 'research_free_form',
          label: 'Survey',
          description: '',
          tags: ['research'],
          identity_bundle_id: 'idb_1',
          summary: { event_counts: { action: 1 } },
          capture_settings: { screenshots: true }
        })
      })
    );
  });

  it('uploads compressed chunks with required headers and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, chunk_index: 2, sha256: 'abc123' }));
    vi.stubGlobal('fetch', fetchMock);
    const body = new Uint8Array([1, 2, 3]);

    await expect(
      uploadChunk({
        endpointUrl,
        apiKey,
        uploadId: 'upl_1',
        chunkIndex: 2,
        kind: 'media',
        sha256: 'abc123',
        body
      })
    ).resolves.toEqual({ ok: true, chunkIndex: 2, sha256: 'abc123' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/base/v1/traces/upl_1/chunks/2',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'gzip',
          'X-Trace-Chunk-Sha256': 'abc123',
          'X-Trace-Chunk-Kind': 'media'
        })
      })
    );
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(Array.from(new Uint8Array(requestBody as ArrayBuffer))).toEqual([1, 2, 3]);
  });

  it('finalizes trace uploads with manifest metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'processing', trace_id: 'tr_1' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      finalizeTraceUpload({
        endpointUrl,
        apiKey,
        uploadId: 'upl_1',
        manifest: {
          trace_id: 'tr_1',
          chunks: [
            { index: 0, kind: 'events', sha256: 'abc', bytes: 3, uploaded: true },
            {
              index: 1,
              kind: 'media',
              sha256: 'def',
              bytes: 5,
              uploaded: true,
              media: {
                blob_key: 'blob_video',
                media_kind: 'video',
                mime_type: 'video/webm',
                created_at: 10,
                segment_index: 0,
                segment_count: 2,
                uncompressed_bytes: 8
              }
            }
          ],
          finalized: false,
          redaction_report: { classified_email: 1 },
          event_counts: { action: 1 },
          media_counts: { screenshot: 0, video: 0 }
        }
      })
    ).resolves.toEqual({ status: 'processing', traceId: 'tr_1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/base/v1/traces/upl_1/finalize',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' })
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      trace_id: 'tr_1',
      chunks: [
        { index: 0, kind: 'events', sha256: 'abc', bytes: 3 },
        {
          index: 1,
          kind: 'media',
          sha256: 'def',
          bytes: 5,
          media: {
            blob_key: 'blob_video',
            media_kind: 'video',
            mime_type: 'video/webm',
            created_at: 10,
            segment_index: 0,
            segment_count: 2,
            uncompressed_bytes: 8
          }
        }
      ],
      redaction_report: { classified_email: 1 },
      event_counts: { action: 1 },
      media_counts: { screenshot: 0, video: 0 }
    });
  });

  it('parses upload status accepted and missing chunks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'uploading', missing_chunks: [3, 4], accepted_chunks: [0, 1, 2], reason: 'waiting' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getTraceUploadStatus({ endpointUrl, apiKey, uploadId: 'upl_1' })).resolves.toEqual({
      status: 'uploading',
      missingChunks: [3, 4],
      acceptedChunks: [0, 1, 2],
      reason: 'waiting'
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/base/v1/traces/upl_1/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${apiKey}` })
      })
    );
  });

  it('throws robust errors for non-2xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad chunk' }, 409)));

    await expect(getTraceUploadStatus({ endpointUrl, apiKey, uploadId: 'upl_1' })).rejects.toMatchObject({
      name: 'UploadApiError',
      status: 409,
      body: { error: 'bad chunk' }
    } satisfies Partial<UploadApiError>);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
