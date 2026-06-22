import { englishTranslator, type Translator } from '@/i18n';
import type { ReviewSummary } from '@/review/summary';
import type { BlobRow, RecordingRow, UploadManifest } from '@/shared/types';

export type TraceWarning = {
  id:
    | 'missing_action_events'
    | 'missing_navigation_events'
    | 'missing_dom_snapshots'
    | 'missing_form_summaries'
    | 'media_partially_excluded'
    | 'all_media_excluded'
    | 'upload_manifest_empty'
    | 'upload_manifest_incomplete'
    | 'excessive_dom_snapshots'
    | 'excessive_wheel_events'
    | 'video_capture_failed'
    | 'video_capture_degraded';
  severity: 'warning' | 'danger';
  title: string;
  detail: string;
};

export function buildTraceWarnings(options: {
  recording: RecordingRow;
  summary: ReviewSummary;
  mediaRows: BlobRow[];
  uploadManifest: UploadManifest | null | undefined;
  tr?: Translator;
}): TraceWarning[] {
  const warnings: TraceWarning[] = [];
  const tr = options.tr ?? englishTranslator;
  const counts = options.summary.eventCounts;
  const annotations = options.summary.annotationCounts;
  const volume = options.summary.volume;

  if (!counts.action) {
    warnings.push({
      id: 'missing_action_events',
      severity: 'danger',
      title: tr('warning.noUserActionsTitle'),
      detail: tr('warning.noUserActionsDetail')
    });
  }
  if (!counts.navigation) {
    warnings.push({
      id: 'missing_navigation_events',
      severity: 'warning',
      title: tr('warning.noNavigationTitle'),
      detail: tr('warning.noNavigationDetail')
    });
  }
  if (!counts.dom_snapshot) {
    warnings.push({
      id: 'missing_dom_snapshots',
      severity: 'warning',
      title: tr('warning.noDomTitle'),
      detail: tr('warning.noDomDetail')
    });
  }
  if (!counts.form_summary) {
    warnings.push({
      id: 'missing_form_summaries',
      severity: 'warning',
      title: tr('warning.noFormTitle'),
      detail: tr('warning.noFormDetail')
    });
  }
  if (
    options.recording.envelope.capture_settings?.video !== false &&
    (annotations.video_failed ?? 0) > 0 &&
    options.summary.media.videoChunks === 0
  ) {
    warnings.push({
      id: 'video_capture_failed',
      severity: 'warning',
      title: tr('warning.videoFailedTitle'),
      detail: tr('warning.videoFailedDetail')
    });
  }
  if ((annotations.video_degraded ?? 0) > 0) {
    warnings.push({
      id: 'video_capture_degraded',
      severity: 'warning',
      title: tr('warning.videoDegradedTitle'),
      detail: tr('warning.videoDegradedDetail')
    });
  }
  const domSnapshotRate = volume?.eventRates.dom_snapshot ?? 0;
  if (domSnapshotRate > 30) {
    warnings.push({
      id: 'excessive_dom_snapshots',
      severity: 'warning',
      title: tr('warning.highDomRateTitle'),
      detail: tr('warning.highDomRateDetail', { rate: domSnapshotRate })
    });
  }
  const wheelRate = volume ? rateForCount(volume.actionCounts.wheel ?? 0, volume.durationMinutes) : 0;
  if (wheelRate > 60) {
    warnings.push({
      id: 'excessive_wheel_events',
      severity: 'warning',
      title: tr('warning.highWheelRateTitle'),
      detail: tr('warning.highWheelRateDetail', { rate: wheelRate })
    });
  }
  const mediaRows = options.mediaRows;
  const excludedMedia = mediaRows.filter((row) => row.excluded_from_upload);
  if (mediaRows.length > 0 && excludedMedia.length === mediaRows.length) {
    warnings.push({
      id: 'all_media_excluded',
      severity: 'danger',
      title: tr('warning.allMediaExcludedTitle'),
      detail: tr('warning.allMediaExcludedDetail')
    });
  } else if (excludedMedia.length > 0) {
    warnings.push({
      id: 'media_partially_excluded',
      severity: 'warning',
      title: tr('warning.someMediaExcludedTitle'),
      detail: tr('warning.someMediaExcludedDetail', {
        excluded: excludedMedia.length,
        total: mediaRows.length
      })
    });
  }

  const manifest = options.uploadManifest;
  if (manifest) {
    if (manifest.chunks.length === 0) {
      warnings.push({
        id: 'upload_manifest_empty',
        severity: 'danger',
        title: tr('warning.manifestEmptyTitle'),
        detail: tr('warning.manifestEmptyDetail')
      });
    } else if (!manifest.finalized) {
      const pending = manifest.chunks.filter((chunk) => !chunk.uploaded).length;
      if (pending > 0) {
        warnings.push({
          id: 'upload_manifest_incomplete',
          severity: 'warning',
          title: tr('warning.manifestIncompleteTitle'),
          detail: tr('warning.manifestIncompleteDetail', {
            pending,
            total: manifest.chunks.length,
            chunkWord: pending === 1 ? tr('warning.chunkSingular') : tr('warning.chunkPlural')
          })
        });
      }
    }
  }

  return warnings;
}

function rateForCount(count: number, durationMinutes: number): number {
  const denominator = Math.max(durationMinutes, 1 / 60);
  return Math.round((count / denominator) * 100) / 100;
}
