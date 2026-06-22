import { createId } from '@/shared/id';

export type DownloadEvent = {
  event_id: string;
  trace_id: string;
  tab_id: number;
  timestamp: number;
  url: string;
  kind: 'download';
  download_id: number;
  phase: 'created' | 'completed' | 'interrupted';
  source_url?: string;
  mime?: string;
  total_bytes?: number;
  danger?: string;
  filename_ext?: string;
};

export function downloadEventFromItem(options: {
  traceId: string;
  timestamp: number;
  item: chrome.downloads.DownloadItem;
}): DownloadEvent {
  return {
    event_id: createId('ev_'),
    trace_id: options.traceId,
    tab_id: -1,
    timestamp: options.timestamp,
    url: options.item.url,
    kind: 'download',
    download_id: options.item.id,
    phase: 'created',
    source_url: options.item.url,
    ...(options.item.mime ? { mime: options.item.mime } : {}),
    ...(Number.isFinite(options.item.totalBytes) && options.item.totalBytes >= 0 ? { total_bytes: options.item.totalBytes } : {}),
    ...(options.item.danger ? { danger: options.item.danger } : {}),
    ...filenameExtension(options.item.filename)
  };
}

export function downloadEventFromDelta(options: {
  traceId: string;
  timestamp: number;
  delta: chrome.downloads.DownloadDelta;
}): DownloadEvent | null {
  const state = options.delta.state?.current;
  if (state !== 'complete' && state !== 'interrupted') return null;

  return {
    event_id: createId('ev_'),
    trace_id: options.traceId,
    tab_id: -1,
    timestamp: options.timestamp,
    url: '',
    kind: 'download',
    download_id: options.delta.id,
    phase: state === 'complete' ? 'completed' : 'interrupted'
  };
}

function filenameExtension(filename: string | undefined): { filename_ext: string } | Record<string, never> {
  const lastSegment = filename?.split(/[\\/]/).pop();
  const ext = lastSegment?.includes('.') ? lastSegment.split('.').pop()?.toLowerCase() : undefined;
  const boundedExt = ext?.replace(/[^a-z0-9_-]/g, '').slice(0, 15).replace(/[-_]+$/g, '');
  return boundedExt ? { filename_ext: boundedExt } : {};
}
