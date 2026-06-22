import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { getBrowserAdapter } from '@/browser';
import { createTranslator, effectiveLocale, type Translator } from '@/i18n';
import {
  captureModeNotice,
  captureStateLabel,
  recordingActivityNotice,
} from '@/reliability/status';
import { alertTone } from '@/shared/alert-tone';
import { errorMessage } from '@/shared/errors';
import { TUNNEL_BYPASS_HEADERS } from '@/shared/http';
import { sendRuntimeMessage } from '@/shared/runtime';
import { IdentityPanel } from '@/ui/identity-panel';
import { canStartRecording, sidePanelAvailability } from '@/ui/state';
import { getConfig, type ConfigRow } from '@/storage/db';
import { subscribeLocalStoreChanges } from '@/storage/live-refresh';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  StatusDetail,
} from '@/ui/primitives';
import type {
  BrowserCapabilities,
  RecordingRow,
} from '@/shared/types';

type ActiveRecordingResponse = {
  active: boolean;
  traceId: string | null;
  recovered?: boolean;
  capturePaused?: boolean;
  row?: RecordingRow | null;
};

type RecordingActionResponse = {
  active: boolean;
  traceId: string | null;
  recovered?: boolean;
  capturePaused?: boolean;
  row?: RecordingRow;
};

type RuntimeMessage =
  | { type: 'get-active-recording' }
  | { type: 'start-recording' }
  | { type: 'pause-capture'; traceId?: string }
  | { type: 'resume-capture'; traceId?: string }
  | { type: 'stop-recording'; traceId?: string }
  | {
      type: 'append-annotation';
      traceId?: string;
      annotationType: 'captcha_solved' | 'captcha_blocked';
      text?: string;
    }
  | { type: 'open-dashboard'; hash?: string }
  | { type: 'delete-recording'; traceId: string };

type RecorderPanelSurface = 'popup' | 'sidepanel';

const DEFAULT_CAPABILITIES = getBrowserAdapter().capabilities;

export function PopupApp() {
  return <RecorderPanel surface="popup" />;
}

export function RecorderPanel(props: { surface: RecorderPanelSurface }) {
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  const [activeRecovered, setActiveRecovered] = useState(false);
  const [activeCapturePaused, setActiveCapturePaused] = useState(false);
  const [activeRecording, setActiveRecording] = useState<RecordingRow | null>(
    null
  );
  const [config, setConfigState] = useState<ConfigRow | null>(null);
  const [capabilities] = useState<BrowserCapabilities>(DEFAULT_CAPABILITIES);
  const [taskBrief, setTaskBrief] = useState<string | null>(null);
  const [taskBriefLoading, setTaskBriefLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaFlash, setCaptchaFlash] = useState<string | null>(null);
  const sidePanel = sidePanelAvailability(capabilities);
  const isSidePanel = props.surface === 'sidepanel';
  const locale = effectiveLocale(config?.locale);
  const tr = useMemo(() => createTranslator(locale), [locale]);

  const endpointReady = useMemo(
    () => Boolean(config?.endpoint_url.trim() && config.api_key.trim()),
    [config]
  );

  useEffect(() => {
    void refreshPopup();
    if (!isSidePanel) return undefined;
    const subscription = subscribeLocalStoreChanges(() => {
      void refreshPopup();
    });
    return () => subscription.unsubscribe();
  }, [isSidePanel]);

  useEffect(() => {
    if (!isSidePanel) return;
    const caseId = activeRecording?.envelope.task_case_id;
    if (!caseId || !config?.endpoint_url) {
      setTaskBrief(null);
      return;
    }
    let cancelled = false;
    setTaskBriefLoading(true);
    fetch(`${config.endpoint_url.replace(/\/$/, '')}/v1/tasks/${encodeURIComponent(caseId)}`, {
      headers: { ...TUNNEL_BYPASS_HEADERS, ...(config.api_key ? { 'Authorization': `Bearer ${config.api_key}` } : {}) },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled) setTaskBrief(data?.brief ?? null);
      })
      .catch(() => {
        if (!cancelled) setTaskBrief(null);
      })
      .finally(() => {
        if (!cancelled) setTaskBriefLoading(false);
      });
    return () => { cancelled = true; };
  }, [isSidePanel, activeRecording?.envelope.task_case_id, config?.endpoint_url]);

  async function refreshPopup(): Promise<void> {
    const [nextConfig, active] = await Promise.all([
      getConfig(),
      sendRuntimeMessage<ActiveRecordingResponse>({
        type: 'get-active-recording',
      }),
    ]);
    setConfigState(nextConfig);
    setActiveTraceId(active.traceId);
    setActiveRecovered(Boolean(active.recovered));
    setActiveCapturePaused(Boolean(active.capturePaused));
    setActiveRecording(active.row ?? null);
  }

  async function startRecording(): Promise<void> {
    await runAction(async () => {
      const response = await sendRuntimeMessage<RecordingActionResponse>({
        type: 'start-recording',
      });
      setActiveTraceId(response.traceId);
      setActiveRecovered(Boolean(response.recovered));
      setActiveCapturePaused(Boolean(response.capturePaused));
      setActiveRecording(response.row ?? null);
    });
  }

  async function pauseOrResumeCapture(): Promise<void> {
    await runAction(async () => {
      const message: RuntimeMessage = activeCapturePaused
        ? activeTraceId
          ? { type: 'resume-capture', traceId: activeTraceId }
          : { type: 'resume-capture' }
        : activeTraceId
        ? { type: 'pause-capture', traceId: activeTraceId }
        : { type: 'pause-capture' };
      const response = await sendRuntimeMessage<RecordingActionResponse>(
        message
      );
      setActiveTraceId(response.traceId);
      setActiveRecovered(Boolean(response.recovered));
      setActiveCapturePaused(Boolean(response.capturePaused));
      setActiveRecording(response.row ?? null);
    });
  }

  async function stopRecording(): Promise<void> {
    const stoppedTraceId = activeTraceId;
    await runAction(async () => {
      const message: RuntimeMessage = stoppedTraceId
        ? { type: 'stop-recording', traceId: stoppedTraceId }
        : { type: 'stop-recording' };
      const response = await sendRuntimeMessage<RecordingActionResponse>(message);
      setActiveTraceId(null);
      setActiveRecovered(false);
      setActiveCapturePaused(false);
      setActiveRecording(null);
      const reviewTraceId = stoppedTraceId ?? response.row?.trace_id;
      if (reviewTraceId) {
        await sendRuntimeMessage<{ ok: boolean }>({
          type: 'open-dashboard',
          hash: `review=${encodeURIComponent(reviewTraceId)}`,
        });
      }
    });
  }

  const activityNotice = recordingActivityNotice({
    active: activeTraceId !== null,
    traceId: activeTraceId,
    recovered: activeRecovered,
  }, tr);
  const captureState = activeRecording
    ? captureStateLabel(
        {
          ...activeRecording,
          capture_paused: activeCapturePaused,
        },
        tr
      )
    : null;
  const mediaNotice = config ? captureModeNotice(config.capture, tr) : null;
  const startGate = config
    ? canStartRecording({
        recordingMode: config.recording_mode,
        realUserConsentAccepted: config.realUserConsentAccepted,
      })
    : { allowed: true as const };
  async function openDashboard(hash = ''): Promise<void> {
    await runAction(async () => {
      await sendRuntimeMessage<{ ok: boolean }>({
        type: 'open-dashboard',
        ...(hash ? { hash } : {}),
      });
    });
  }

  async function openSidePanel(): Promise<void> {
    await runAction(async () => {
      await openChromeSidePanel(tr);
    });
  }

  async function markCaptcha(
    annotationType: 'captcha_solved' | 'captcha_blocked'
  ): Promise<void> {
    await runAction(async () => {
      await sendRuntimeMessage<{ ok: boolean }>({
        type: 'append-annotation',
        ...(activeTraceId ? { traceId: activeTraceId } : {}),
        annotationType,
      });
      setCaptchaFlash(tr('popup.captchaMarked'));
      setTimeout(() => setCaptchaFlash(null), 2000);
    });
  }

  async function runAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshPopup();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={isSidePanel ? 'sidepanel-shell' : 'popup-shell'}>
      <header className="popup-header">
        <div>
          <h1>{tr('app.popupTitle')}</h1>
        </div>
        <span
          className={activeTraceId ? 'status-dot active' : 'status-dot'}
          aria-label={tr('popup.recordingStatusAria')}
        />
      </header>

      {!isSidePanel && activeTraceId ? (
        <Card className="recorder-state-card" aria-live="polite">
          <CardContent>
            <div className="recorder-state-top">
              <span>{tr('popup.recording')}</span>
              <Badge tone={activeCapturePaused ? 'warning' : 'success'}>
                {activeCapturePaused ? tr('popup.paused') : tr('popup.active')}
              </Badge>
            </div>
            {activeCapturePaused ? (
              <p>{tr('popup.pausedDraftSaved')}</p>
            ) : null}
            <code>{activeTraceId}</code>
          </CardContent>
        </Card>
      ) : null}

      {!activeTraceId && config ? (
        <Alert tone={config.recording_mode === 'real_user_free_form' ? 'info' : 'warning'}>
          <span>{tr(config.recording_mode === 'real_user_free_form' ? 'popup.identityWarningRealUser' : 'popup.identityWarningResearch')}</span>
        </Alert>
      ) : null}

      {!isSidePanel && activityNotice ? (
        <Alert tone={alertTone(activityNotice.tone)}>
          <strong>{activityNotice.title}</strong>
          <span>{activityNotice.detail}</span>
        </Alert>
      ) : null}

      {!isSidePanel && mediaNotice ? (
        <Alert tone={alertTone(mediaNotice.tone)}>
          <strong>{mediaNotice.title}</strong>
          <span>{mediaNotice.detail}</span>
        </Alert>
      ) : null}

      {!isSidePanel && captureState && captureState.tone === 'warning' ? (
        <Alert tone="warning">
          <StatusDetail
            tone={captureState.tone}
            label={captureState.label}
            detail={captureState.detail}
          />
        </Alert>
      ) : null}

      {!endpointReady ? (
        <Alert tone="warning">
          {tr('popup.endpointRequired')}
        </Alert>
      ) : null}

      {!isSidePanel && !capabilities.video ? (
        <Alert>
          {tr('popup.videoUnavailable')}
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="recorder-actions">
        <Button
          variant="primary"
          onClick={startRecording}
          disabled={
            busy ||
            activeTraceId !== null ||
            !endpointReady ||
            !startGate.allowed
          }
        >
          {tr('popup.start')}
        </Button>
        <Button
          onClick={stopRecording}
          disabled={busy || activeTraceId === null}
        >
          {tr('popup.stop')}
        </Button>
        <Button
          onClick={pauseOrResumeCapture}
          disabled={busy || activeTraceId === null}
        >
          {activeCapturePaused ? tr('popup.resumeRecording') : tr('popup.pauseRecording')}
        </Button>
      </div>

      {activeTraceId && !activeCapturePaused ? (
        <div className="captcha-section">
          <p className="captcha-hint">{tr('popup.captchaHint')}</p>
          <div className="recorder-actions compact">
            <Button onClick={() => markCaptcha('captcha_solved')} disabled={busy} title={tr('popup.captchaSolvedTip')}>
              {tr('popup.captchaSolved')}
            </Button>
            <Button onClick={() => markCaptcha('captcha_blocked')} disabled={busy} title={tr('popup.captchaBlockedTip')}>
              {tr('popup.captchaBlocked')}
            </Button>
          </div>
          {captchaFlash ? <p className="captcha-flash">{captchaFlash}</p> : null}
        </div>
      ) : null}

      {isSidePanel && activeTraceId && (taskBrief || taskBriefLoading) ? (
        <Card className="sidepanel-brief-card">
          <CardHeader>
            <strong>{tr('tasks.briefTitle')}</strong>
          </CardHeader>
          <CardContent>
            {taskBriefLoading ? (
              <p className="brief-loading">{tr('tasks.briefLoading')}</p>
            ) : (
              <div className="sidepanel-brief-content">{taskBrief}</div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeTraceId ? (
        <IdentityPanel
          identity={activeRecording?.identity}
          mode={
            activeRecording?.envelope.recording_mode ?? config?.recording_mode
          }
          tr={tr}
          compact
        />
      ) : null}

      {!(isSidePanel && activeTraceId) ? (
        <Button
          className="recorder-wide-action"
          onClick={() => void openDashboard()}
          disabled={busy}
        >
          {tr('popup.openDashboard')}
        </Button>
      ) : null}

      {!isSidePanel && sidePanel.available ? (
        <Button
          className="recorder-wide-action"
          onClick={openSidePanel}
          disabled={busy}
        >
          {tr('popup.openSidePanel')}
        </Button>
      ) : null}
    </main>
  );
}

type ChromeSidePanelRuntime = {
  sidePanel?: {
    open(options: { windowId?: number }): Promise<void> | void;
  };
};

async function openChromeSidePanel(tr: Translator): Promise<void> {
  const sidePanel = (globalThis.chrome as ChromeSidePanelRuntime | undefined)
    ?.sidePanel;
  if (!sidePanel?.open)
    throw new Error(tr('popup.sidePanelUnavailable'));
  const currentWindow = await browser.windows.getCurrent();
  await sidePanel.open(currentWindow.id ? { windowId: currentWindow.id } : {});
}

