import type { BrowserCapabilities, RecordingMode } from '@/shared/types';

export type SidePanelAvailability = {
  available: boolean;
  fallback: 'popup';
};

export function sidePanelAvailability(capabilities: Pick<BrowserCapabilities, 'browser'>): SidePanelAvailability {
  return {
    available: capabilities.browser === 'chrome',
    fallback: 'popup'
  };
}

export type StartRecordingGate =
  | { allowed: true }
  | { allowed: false; reason: 'real_user_consent_required' };

export function canStartRecording(options: {
  recordingMode: RecordingMode;
  realUserConsentAccepted: boolean;
}): StartRecordingGate {
  if (options.recordingMode === 'real_user_free_form' && !options.realUserConsentAccepted) {
    return { allowed: false, reason: 'real_user_consent_required' };
  }
  return { allowed: true };
}
