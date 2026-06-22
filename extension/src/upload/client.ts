import type { RecordingMode, TraceSchemaVersion, UploadManifest } from '@/shared/types';
import type { UploadManifestWithPayload } from '@/upload/manifest';
import { TUNNEL_BYPASS_HEADERS } from '@/shared/http';

export type InitTraceUploadRequest = {
  trace_id: string;
  schema_version: TraceSchemaVersion;
  recording_mode: RecordingMode;
  label: string;
  description: string;
  tags: string[];
  task_case_id?: string;
  identity_bundle_id?: string;
  summary: Record<string, unknown>;
  capture_settings: Record<string, unknown>;
};

export type InitTraceUploadResult = {
  uploadId: string;
  acceptedChunks: number[];
  status: string;
};

export type UploadChunkResult = {
  ok: boolean;
  chunkIndex: number;
  sha256: string;
};

export type FinalizeTraceUploadResult = {
  status: string;
  traceId: string;
};

export type TraceUploadStatus = {
  status: string;
  missingChunks: number[];
  acceptedChunks: number[];
  reason?: string;
};

type ClientOpts = {
  endpointUrl: string;
  apiKey: string;
  signal?: AbortSignal | undefined;
};

export class UploadApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'UploadApiError';
    this.status = status;
    this.body = body;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// The `request()` helper already throws on non-2xx, so these only run on a
// successful response — but the body may still be malformed or mis-shaped.
async function parseJsonResponse<T>(
  response: Response,
  isValid: (body: Record<string, unknown>) => boolean,
  context: string
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new UploadApiError(`invalid JSON in ${context} response`, response.status, String(error));
  }
  if (!isRecord(body) || !isValid(body)) {
    throw new UploadApiError(`unexpected ${context} response shape`, response.status, body);
  }
  return body as T;
}

export async function initTraceUpload(
  opts: ClientOpts & { trace: InitTraceUploadRequest }
): Promise<InitTraceUploadResult> {
  const response = await request(opts, '/v1/traces/init', {
    method: 'POST',
    headers: jsonHeaders(opts.apiKey),
    body: JSON.stringify(opts.trace)
  });
  const body = await parseJsonResponse<{ upload_id: string; accepted_chunks?: number[]; status: string }>(
    response,
    (b) => typeof b.upload_id === 'string' && typeof b.status === 'string',
    'trace init'
  );
  return {
    uploadId: body.upload_id,
    acceptedChunks: body.accepted_chunks ?? [],
    status: body.status
  };
}

export async function uploadChunk(
  opts: ClientOpts & {
    uploadId: string;
    chunkIndex: number;
    kind: 'events' | 'media';
    sha256: string;
    body: Uint8Array | ArrayBuffer;
  }
): Promise<UploadChunkResult> {
  const response = await request(opts, `/v1/traces/${encodeURIComponent(opts.uploadId)}/chunks/${opts.chunkIndex}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'gzip',
      'X-Trace-Chunk-Sha256': opts.sha256,
      'X-Trace-Chunk-Kind': opts.kind
    },
    body: toArrayBuffer(opts.body)
  });
  const body = await parseJsonResponse<{ ok: boolean; chunk_index: number; sha256: string }>(
    response,
    (b) => typeof b.ok === 'boolean' && typeof b.chunk_index === 'number',
    'chunk upload'
  );
  return {
    ok: body.ok,
    chunkIndex: body.chunk_index,
    sha256: body.sha256
  };
}

function toArrayBuffer(body: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  }

  const bytes = Uint8Array.from(body as ArrayLike<number>);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function finalizeTraceUpload(
  opts: ClientOpts & {
    uploadId: string;
    manifest: UploadManifest & Partial<Pick<UploadManifestWithPayload, 'redaction_report' | 'event_counts' | 'media_counts'>>;
  }
): Promise<FinalizeTraceUploadResult> {
  const requestBody = {
    trace_id: opts.manifest.trace_id,
    chunks: opts.manifest.chunks.map((chunk) => ({
      index: chunk.index,
      kind: chunk.kind,
      sha256: chunk.sha256,
      bytes: chunk.bytes,
      ...(chunk.media ? { media: chunk.media } : {})
    })),
    redaction_report: opts.manifest.redaction_report ?? {},
    event_counts: opts.manifest.event_counts ?? {},
    media_counts: opts.manifest.media_counts ?? {}
  };
  const response = await request(opts, `/v1/traces/${encodeURIComponent(opts.uploadId)}/finalize`, {
    method: 'POST',
    headers: jsonHeaders(opts.apiKey),
    body: JSON.stringify(requestBody)
  });
  const body = await parseJsonResponse<{ status: string; trace_id: string }>(
    response,
    (b) => typeof b.status === 'string',
    'finalize'
  );
  return {
    status: body.status,
    traceId: body.trace_id
  };
}

export async function getTraceUploadStatus(opts: ClientOpts & { uploadId: string }): Promise<TraceUploadStatus> {
  const response = await request(opts, `/v1/traces/${encodeURIComponent(opts.uploadId)}/status`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`
    }
  });
  const body = await parseJsonResponse<{ status: string; missing_chunks?: number[]; accepted_chunks?: number[]; reason?: string }>(
    response,
    (b) => typeof b.status === 'string',
    'upload status'
  );
  return {
    status: body.status,
    missingChunks: body.missing_chunks ?? [],
    acceptedChunks: body.accepted_chunks ?? [],
    ...(body.reason ? { reason: body.reason } : {})
  };
}

async function request(opts: ClientOpts, path: string, init: RequestInit): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    headers: { ...TUNNEL_BYPASS_HEADERS, ...(init.headers as Record<string, string> | undefined) }
  };
  if (opts.signal) requestInit.signal = opts.signal;

  const response = await fetch(normalizeEndpoint(opts.endpointUrl, path), requestInit);
  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new UploadApiError(`upload API request failed: ${response.status}`, response.status, body);
  }
  return response;
}

function normalizeEndpoint(endpointUrl: string, path: string): string {
  return `${endpointUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

async function readErrorBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return await response.json().catch(() => null);
  }
  return await response.text().catch(() => '');
}
