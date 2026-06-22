import { describe, expect, it } from 'vitest';
import { canStartRecording, sidePanelAvailability } from '@/ui/state';

describe('ui state helpers', () => {
  it('enables the side panel only for Chrome and falls back to popup elsewhere', () => {
    expect(sidePanelAvailability({ browser: 'chrome' })).toEqual({ available: true, fallback: 'popup' });
    expect(sidePanelAvailability({ browser: 'firefox' })).toEqual({ available: false, fallback: 'popup' });
    expect(sidePanelAvailability({ browser: 'unknown' })).toEqual({ available: false, fallback: 'popup' });
  });

  it('requires explicit consent before real-user recording starts', () => {
    expect(canStartRecording({ recordingMode: 'real_user_free_form', realUserConsentAccepted: false })).toEqual({
      allowed: false,
      reason: 'real_user_consent_required'
    });
    expect(canStartRecording({ recordingMode: 'real_user_free_form', realUserConsentAccepted: true })).toEqual({ allowed: true });
    expect(canStartRecording({ recordingMode: 'research_free_form', realUserConsentAccepted: false })).toEqual({ allowed: true });
  });
});
