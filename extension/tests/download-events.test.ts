import { describe, expect, it } from 'vitest';
import { downloadEventFromDelta, downloadEventFromItem } from '@/capture/download-events';

describe('download event helpers', () => {
  it('summarizes download creation without raw local paths', () => {
    const event = downloadEventFromItem({
      traceId: 'tr_download',
      timestamp: 1,
      item: {
        id: 42,
        url: 'https://example.test/report.pdf',
        filename: '/Users/private/Downloads/report.pdf',
        mime: 'application/pdf',
        totalBytes: 12345,
        state: 'in_progress'
      } as chrome.downloads.DownloadItem
    });

    expect(event).toEqual(expect.objectContaining({
      kind: 'download',
      download_id: 42,
      phase: 'created',
      source_url: 'https://example.test/report.pdf',
      mime: 'application/pdf',
      total_bytes: 12345,
      filename_ext: 'pdf'
    }));
    expect(JSON.stringify(event)).not.toContain('/Users/private');
    expect(JSON.stringify(event)).not.toContain('Downloads/report.pdf');
  });

  it('summarizes download completion state changes', () => {
    expect(downloadEventFromDelta({
      traceId: 'tr_download',
      timestamp: 2,
      delta: {
        id: 42,
        state: { current: 'complete', previous: 'in_progress' }
      } as chrome.downloads.DownloadDelta
    })).toEqual(expect.objectContaining({
      kind: 'download',
      download_id: 42,
      phase: 'completed'
    }));
  });

  it('summarizes download interruptions', () => {
    expect(downloadEventFromDelta({
      traceId: 'tr_download',
      timestamp: 3,
      delta: {
        id: 42,
        state: { current: 'interrupted', previous: 'in_progress' }
      } as chrome.downloads.DownloadDelta
    })).toEqual(expect.objectContaining({
      kind: 'download',
      download_id: 42,
      phase: 'interrupted'
    }));
  });

  it('ignores in-progress state changes', () => {
    expect(downloadEventFromDelta({
      traceId: 'tr_download',
      timestamp: 4,
      delta: {
        id: 42,
        state: { current: 'in_progress', previous: 'interrupted' }
      } as chrome.downloads.DownloadDelta
    })).toBeNull();
  });

  it('bounds filename metadata to an extension only', () => {
    const event = downloadEventFromItem({
      traceId: 'tr_download',
      timestamp: 5,
      item: {
        id: 7,
        url: 'https://example.test/download',
        filename: 'C:\\Users\\private\\Downloads\\notes.private-name.with-extra-long-extension',
        state: 'in_progress'
      } as chrome.downloads.DownloadItem
    });

    expect(event).toEqual(expect.objectContaining({
      kind: 'download',
      download_id: 7,
      phase: 'created',
      filename_ext: 'with-extra-long'
    }));
    expect(JSON.stringify(event)).not.toContain('private');
    expect(JSON.stringify(event)).not.toContain('notes');
    expect(JSON.stringify(event)).not.toContain('Downloads');
  });
});
