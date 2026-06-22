import { englishTranslator, type Translator } from '@/i18n';
import type { CaptureSettings, RecordingRow, RecordingStatus } from '@/shared/types';

export type StatusTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

export type NoticeState = {
  tone: Exclude<StatusTone, 'neutral'>;
  title: string;
  detail: string;
};

export type UploadState = {
  tone: StatusTone;
  label: string;
  detail: string;
};

export type LocalCopyState = {
  label: string;
  detail: string;
};

export type CaptureState = {
  tone: 'neutral' | 'warning';
  label: string;
  detail: string;
};

const RESUMABLE_STATUSES: RecordingStatus[] = ['queued', 'failed', 'paused'];

export function recordingActivityNotice(
  state: { active: boolean; traceId: string | null; recovered?: boolean },
  tr: Translator = englishTranslator
): NoticeState | null {
  if (!state.active || !state.traceId) return null;
  if (state.recovered) {
    return {
      tone: 'warning',
      title: tr('status.recoveredTitle'),
      detail: tr('status.recoveredDetail', { traceId: state.traceId })
    };
  }
  return {
    tone: 'info',
    title: tr('status.activeTitle'),
    detail: tr('status.activeDetail', { traceId: state.traceId })
  };
}

export function captureModeNotice(
  capture: CaptureSettings,
  tr: Translator = englishTranslator
): NoticeState | null {
  if (capture.video) return null;
  return {
    tone: 'warning',
    title: tr('status.videoDisabledTitle'),
    detail: tr('status.videoDisabledDetail')
  };
}

export function historyRowState(
  recording: RecordingRow,
  tr: Translator = englishTranslator
): { upload: UploadState; localCopy: LocalCopyState; capture: CaptureState } {
  return {
    upload: uploadStateLabel(recording, tr),
    localCopy: {
      label: tr('status.localCopyAvailable'),
      detail: tr('status.localCopyDetail')
    },
    capture: captureStateLabel(recording, tr)
  };
}

export function uploadStateLabel(
  recording: RecordingRow,
  tr: Translator = englishTranslator
): UploadState {
  if (recording.last_error) {
    return {
      tone: 'danger',
      label: tr('status.uploadFailed'),
      detail: recording.last_error
    };
  }
  if (recording.status === 'paused') {
    return {
      tone: 'warning',
      label: tr('status.uploadPaused'),
      detail: tr('status.uploadPausedDetail')
    };
  }
  if (recording.status === 'failed') {
    return {
      tone: 'danger',
      label: tr('status.uploadFailed'),
      detail: tr('status.uploadFailedDetail')
    };
  }
  if (recording.status === 'queued') {
    return {
      tone: 'info',
      label: tr('status.readyToUpload'),
      detail: tr('status.readyToUploadDetail')
    };
  }
  if (recording.status === 'uploading') {
    return {
      tone: 'info',
      label: tr('status.uploading'),
      detail: recording.upload_id ? tr('status.uploadingWithId', { uploadId: recording.upload_id }) : tr('status.uploadingDetail')
    };
  }
  if (recording.upload_id) {
    return {
      tone: 'success',
      label: tr('status.remoteUploadCreated'),
      detail: recording.upload_id
    };
  }
  if (RESUMABLE_STATUSES.includes(recording.status)) {
    return {
      tone: 'info',
      label: tr('status.readyToResume'),
      detail: tr('status.readyToResumeDetail')
    };
  }
  return {
    tone: 'neutral',
    label: tr('status.localOnly'),
    detail: tr('status.localOnlyDetail')
  };
}

export function captureStateLabel(
  recording: RecordingRow,
  tr: Translator = englishTranslator
): CaptureState {
  if (recording.capture_paused) {
    return {
      tone: 'warning',
      label: tr('status.recordingPaused'),
      detail: tr('status.recordingPausedDetail')
    };
  }
  if (recording.envelope.capture_settings?.video === false) {
    return {
      tone: 'warning',
      label: tr('status.videoDisabledTitle'),
      detail: tr('status.traceVideoDisabledDetail')
    };
  }
  return {
    tone: 'neutral',
    label: tr('status.videoEnabled'),
    detail: tr('status.videoEnabledDetail')
  };
}

export function canResumeUpload(status: RecordingStatus): boolean {
  return RESUMABLE_STATUSES.includes(status);
}
