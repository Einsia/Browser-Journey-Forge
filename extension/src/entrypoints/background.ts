import { browser } from 'wxt/browser';
import { downloadEventFromDelta, downloadEventFromItem } from '@/capture/download-events';
import { createCaptchaProviderDedupe } from '@/capture/session-side-effects';
import { shouldRecordBrowserNavigationUrl, tabNavigationEvent } from '@/capture/tab-navigation';
import { getBrowserAdapter } from '@/browser';
import { appendEvent, pauseCapture, resumeCapture, startRecording, stopRecording } from '@/recording/recorder';
import { errorMessage } from '@/shared/errors';
import { createId } from '@/shared/id';
import type { BlobRow, CaptchaProvider, CapturedEvent, CaptureSettings, RecordingRow, VideoChunkEvent } from '@/shared/types';
import { db, getConfig } from '@/storage/db';
import { pollUploadStatus, uploadRecording } from '@/upload/runner';
import { evaluateVideoStorageBudget } from '@/video/storage-policy';

type VideoAnnotationType = 'video_started' | 'video_stopped' | 'video_failed' | 'video_degraded';

type RuntimeMessage =
  | { type: 'get-active-recording' }
  | { type: 'start-recording' }
  | { type: 'start-task-recording'; caseId: string; siteUrl: string }
  | { type: 'pause-capture'; traceId?: string }
  | { type: 'resume-capture'; traceId?: string }
  | { type: 'stop-recording'; traceId?: string }
  | { type: 'event'; event: CapturedEvent }
  | { type: 'captcha-detected'; traceId?: string; triggerEventId: string; providers: CaptchaProvider[] }
  | { type: 'append-annotation'; traceId?: string; annotationType: 'captcha_solved' | 'captcha_blocked'; text?: string }
  | { type: 'video-chunk'; traceId: string; tabId: number; url: string; blobKey: string; startTimestamp: number; endTimestamp: number; mimeType: string; data: ArrayBuffer }
  | { type: 'open-dashboard'; hash?: string }
  | { type: 'resume-upload'; traceId: string }
  | { type: 'poll-upload-status'; traceId: string }
  | { type: 'delete-recording'; traceId: string };

type SenderLike = {
  tab?: {
    id?: number;
    windowId?: number;
    url?: string;
    active?: boolean;
  };
};

let activeTraceId: string | null = null;
let activeTraceRecovered = false;
let recovery: Promise<void> | null = null;
const captchaDedupe = createCaptchaProviderDedupe();
const CONTENT_FLUSH_TIMEOUT_MS = 1500;
const tabUrlCache = new Map<number, string>();
const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  screenshots: false,
  video: true,
  networkBodies: true
};
const VIDEO_RECORDER_URL = 'video-recorder.html';
const VIDEO_CHUNK_TIMESLICE_MS = 5_000;
const FIREFOX_VIDEO_FRAME_INTERVAL_MS = 1_000;
const START_RECORDING_CONTEXT_MENU_ID = 'journey-forge-start-recording';
const VIDEO_RECORDER_PORT_NAME = 'journey-forge-video-recorder';
let activeVideoTraceId: string | null = null;
let firefoxVideoRecorderTabId: number | null = null;
let firefoxVideoRecorderPort: chrome.runtime.Port | null = null;
let firefoxVideoRequestId = 0;
const videoLimitReachedTraceIds = new Set<string>();
const firefoxVideoReadyWaiters = new Set<() => void>();
const firefoxVideoResponseWaiters = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

export default defineBackground(() => {
  recovery = recoverActiveTraceId();
  void registerContextMenu();

  const listener = (message: unknown, sender: SenderLike) => handleMessage(message, sender);
  browser.runtime.onMessage.addListener(listener as Parameters<typeof browser.runtime.onMessage.addListener>[0]);
  browser.runtime.onConnect.addListener((port) => {
    handleVideoRecorderConnect(port as chrome.runtime.Port);
  });
  chrome.runtime.onInstalled?.addListener(() => {
    void registerContextMenu();
  });
  chrome.runtime.onStartup?.addListener(() => {
    void registerContextMenu();
  });
  chrome.contextMenus?.onClicked?.addListener((info, tab) => {
    void handleContextMenuClicked(info, tab);
  });
  browser.tabs.onCreated.addListener((tab) => {
    void handleTabCreated(tab);
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void handleTabUpdated(tabId, changeInfo, tab);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void handleTabRemoved(tabId);
  });
  browser.webNavigation.onCommitted.addListener((details) => {
    void handleNavigationCommitted(details);
  });

  const downloads = browser.downloads as unknown as typeof chrome.downloads | undefined;
  downloads?.onCreated?.addListener((item) => {
    void appendDownloadCreated(item);
  });
  downloads?.onChanged?.addListener((delta) => {
    void appendDownloadChanged(delta);
  });
});

async function handleMessage(message: unknown, sender: SenderLike): Promise<unknown> {
  if (!isRuntimeMessage(message)) return undefined;
  await ensureRecovered();

  switch (message.type) {
    case 'get-active-recording': {
      const activeRow = activeTraceId ? ((await db.recordings.get(activeTraceId)) ?? null) : null;
      return {
        active: activeTraceId !== null,
        traceId: activeTraceId,
        recovered: activeTraceRecovered,
        captureSettings: await captureSettingsForActiveRecording(activeTraceId, activeRow),
        capturePaused: Boolean(activeRow?.capture_paused),
        row: activeRow
      };
    }

    case 'start-recording': {
      const row = await beginRecording(recordingTargetFromSender(sender));
      const captureSettings = await captureSettingsForActiveRecording(row.trace_id, row);
      return { active: true, traceId: activeTraceId, recovered: false, captureSettings, capturePaused: false, row };
    }

    case 'start-task-recording': {
      const tab = await chrome.tabs.create({ url: `https://${message.siteUrl}` });
      const target: SenderLike['tab'] = {
        ...(tab.id !== undefined ? { id: tab.id } : {}),
        ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
        ...(tab.url !== undefined ? { url: tab.url } : {}),
        ...(tab.active !== undefined ? { active: tab.active } : {}),
      };
      const row = await beginRecording(target, { taskCaseId: message.caseId });
      const captureSettings = await captureSettingsForActiveRecording(row.trace_id, row);
      return { active: true, traceId: activeTraceId, recovered: false, captureSettings, capturePaused: false, row };
    }

    case 'pause-capture': {
      const traceId = message.traceId ?? activeTraceId;
      if (!traceId) return { active: false, traceId: null, capturePaused: false };
      await stopVideoCapture(traceId);
      const row = await pauseCapture(traceId);
      const captureSettings = await captureSettingsForActiveRecording(traceId, row);
      await broadcastRecordingState(true, traceId, captureSettings, true);
      return { active: true, traceId, recovered: activeTraceRecovered, captureSettings, capturePaused: true, row };
    }

    case 'resume-capture': {
      const traceId = message.traceId ?? activeTraceId;
      if (!traceId) return { active: false, traceId: null, capturePaused: false };
      const row = await resumeCapture(traceId);
      const captureSettings = await captureSettingsForActiveRecording(traceId, row);
      await startVideoCapture(traceId, captureSettings);
      await broadcastRecordingState(true, traceId, captureSettings, false);
      return { active: true, traceId, recovered: activeTraceRecovered, captureSettings, capturePaused: false, row };
    }

    case 'stop-recording': {
      const traceId = message.traceId ?? activeTraceId;
      if (!traceId) return { active: false, traceId: null };
      await stopVideoCapture(traceId);
      await flushRecordingTabs(traceId);
      const row = await stopRecording(traceId);
      captchaDedupe.clear(traceId);
      if (activeTraceId === traceId) activeTraceId = null;
      activeTraceRecovered = false;
      await broadcastRecordingState(false, null, null, false);
      return { active: false, traceId: null, recovered: false, captureSettings: null, capturePaused: false, row };
    }

    case 'event': {
      if (!activeTraceId && !message.event.trace_id) return { ok: false };
      const event = normalizeEvent(message.event, sender, activeTraceId ?? message.event.trace_id);
      await appendEvent(event);
      return { ok: true };
    }

    case 'captcha-detected':
      return await appendCaptchaDetected(message.traceId ?? activeTraceId, message.providers, message.triggerEventId, sender);

    case 'append-annotation':
      return await appendAnnotation(message.traceId ?? activeTraceId, message.annotationType, message.text, sender);

    case 'video-chunk':
      return await persistVideoChunk(message);

    case 'open-dashboard':
      await getBrowserAdapter().openDashboard(message.hash ?? '');
      return { ok: true };

    case 'resume-upload': {
      const row = await uploadRecording(message.traceId);
      return { ok: true, row };
    }

    case 'poll-upload-status': {
      const row = await pollUploadStatus(message.traceId);
      return { ok: true, row };
    }

    case 'delete-recording': {
      await deleteRecordingLocal(message.traceId);
      captchaDedupe.clear(message.traceId);
      videoLimitReachedTraceIds.delete(message.traceId);
      if (activeTraceId === message.traceId) {
        await stopVideoCapture(message.traceId);
        activeTraceId = null;
        activeTraceRecovered = false;
        await broadcastRecordingState(false, null, null, false);
      }
      return { ok: true };
    }
  }
}

function recordingTargetFromSender(sender: SenderLike): SenderLike['tab'] {
  return shouldRecordBrowserNavigationUrl(sender.tab?.url) ? sender.tab : undefined;
}

async function beginRecording(targetTab?: SenderLike['tab'], opts?: { taskCaseId?: string }): Promise<RecordingRow> {
  const row = await startRecording(undefined, opts);
  activeTraceId = row.trace_id;
  activeTraceRecovered = false;
  const captureSettings = await captureSettingsForActiveRecording(activeTraceId, row);
  await startVideoCapture(activeTraceId, captureSettings, targetTab);
  await broadcastRecordingState(true, activeTraceId, captureSettings, false);
  return row;
}

async function registerContextMenu(): Promise<void> {
  const contextMenus = chrome.contextMenus;
  if (!contextMenus?.create) return;
  await new Promise<void>((resolve) => {
    contextMenus.remove(START_RECORDING_CONTEXT_MENU_ID, () => {
      contextMenus.create(
        {
          id: START_RECORDING_CONTEXT_MENU_ID,
          title: 'Start Journey Forge recording',
          contexts: ['page', 'frame', 'selection', 'editable', 'link'],
        },
        () => resolve()
      );
    });
  });
}

async function handleContextMenuClicked(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<void> {
  if (info.menuItemId !== START_RECORDING_CONTEXT_MENU_ID) return;
  await ensureRecovered();
  if (activeTraceId) {
    await getBrowserAdapter().openDashboard(`#review=${encodeURIComponent(activeTraceId)}`);
    return;
  }
  const config = await getConfig();
  if (!config.endpoint_url.trim() || !config.api_key.trim()) {
    await getBrowserAdapter().openDashboard('#settings');
    return;
  }
  if (config.recording_mode === 'real_user_free_form' && !config.realUserConsentAccepted) {
    await getBrowserAdapter().openDashboard('#settings');
    return;
  }
  try {
    await beginRecording(tabLike(tab));
  } catch {
    await getBrowserAdapter().openDashboard('#settings');
  }
}

function tabLike(tab: chrome.tabs.Tab | undefined): SenderLike['tab'] {
  if (!tab) return undefined;
  return {
    ...(tab.id !== undefined ? { id: tab.id } : {}),
    ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
    ...(tab.url !== undefined ? { url: tab.url } : {}),
    ...(tab.active !== undefined ? { active: tab.active } : {}),
  };
}

async function appendCaptchaDetected(
  traceId: string | null,
  providers: CaptchaProvider[],
  _triggerEventId: string,
  sender: SenderLike
): Promise<{ ok: boolean; providers?: CaptchaProvider[]; error?: string }> {
  if (!traceId) return { ok: false, error: 'no active recording' };
  const newProviders = captchaDedupe.newProviders(traceId, providers);
  if (!newProviders.length) return { ok: true, providers: [] };
  await appendEvent({
    event_id: createId('ev_'),
    trace_id: traceId,
    tab_id: sender.tab?.id ?? -1,
    timestamp: Date.now(),
    url: sender.tab?.url ?? '',
    kind: 'annotation',
    annotation_type: 'captcha_detected',
    text: newProviders.join(',')
  });
  return { ok: true, providers: newProviders };
}

async function recoverActiveTraceId(): Promise<void> {
  const drafts = await db.recordings.where('status').equals('draft').toArray();
  drafts.sort((left, right) => right.updated_at - left.updated_at);
  const recoveredRow = drafts[0] ?? null;
  activeTraceId = recoveredRow?.trace_id ?? null;
  activeTraceRecovered = activeTraceId !== null;
}

async function ensureRecovered(): Promise<void> {
  if (recovery) {
    await recovery;
    recovery = null;
  }
}

function normalizeEvent(event: CapturedEvent, sender: SenderLike, traceId: string): CapturedEvent {
  return {
    ...event,
    trace_id: traceId,
    tab_id: sender.tab?.id ?? event.tab_id ?? -1,
    url: event.url || sender.tab?.url || ''
  } as CapturedEvent;
}

async function appendAnnotation(
  traceId: string | null,
  annotationType: 'captcha_solved' | 'captcha_blocked',
  text: string | undefined,
  sender: SenderLike
): Promise<{ ok: boolean; error?: string }> {
  if (!traceId) return { ok: false, error: 'no active recording' };
  await appendEvent({
    event_id: createId('ev_'),
    trace_id: traceId,
    tab_id: sender.tab?.id ?? -1,
    timestamp: Date.now(),
    url: sender.tab?.url ?? '',
    kind: 'annotation',
    annotation_type: annotationType,
    ...(text ? { text } : {})
  });
  return { ok: true };
}

async function startVideoCapture(
  traceId: string,
  captureSettings: CaptureSettings | null | undefined,
  targetTab?: SenderLike['tab']
): Promise<void> {
  const adapter = getBrowserAdapter();
  if (!captureSettings?.video || !adapter.capabilities.video) return;
  if (videoLimitReachedTraceIds.has(traceId)) return;
  const tab = targetTab?.id !== undefined ? targetTab : await videoCaptureTargetTab();
  if (tab?.id === undefined || !shouldRecordBrowserNavigationUrl(tab.url)) {
    await appendVideoAnnotation(traceId, 'video_failed', 'No recordable browser tab was available.');
    return;
  }

  if (adapter.capabilities.browser === 'firefox') {
    await startFirefoxVideoCapture(traceId, tab);
    return;
  }
  if (!supportsChromeVideoCapture()) return;

  try {
    await ensureVideoOffscreenDocument();
    const streamId = await getTabCaptureStreamId(tab.id);
    const response = await sendVideoRecorderMessage<{ ok?: boolean; error?: string }>({
      type: 'video-start',
      traceId,
      streamId,
      tabId: tab.id,
      url: tab.url ?? '',
      timesliceMs: VIDEO_CHUNK_TIMESLICE_MS,
    });
    if (response?.ok) {
      activeVideoTraceId = traceId;
      await appendVideoAnnotation(traceId, 'video_started', 'tab_capture_started', tab.id, tab.url);
      return;
    }
    await appendVideoAnnotation(
      traceId,
      'video_failed',
      response?.error ?? 'Video recorder did not start.',
      tab.id,
      tab.url
    );
  } catch (error) {
    await appendVideoAnnotation(traceId, 'video_failed', errorMessage(error), tab.id, tab.url);
    activeVideoTraceId = null;
  }
}

async function startFirefoxVideoCapture(
  traceId: string,
  tab: NonNullable<SenderLike['tab']>
): Promise<void> {
  if (tab.id === undefined) {
    await appendVideoAnnotation(traceId, 'video_failed', 'No recordable Firefox tab was available.');
    return;
  }

  try {
    await ensureFirefoxVideoRecorderTab();
    const response = await sendVideoRecorderMessage<{ ok?: boolean; error?: string }>({
      type: 'video-start-firefox',
      traceId,
      tabId: tab.id,
      url: tab.url ?? '',
      timesliceMs: VIDEO_CHUNK_TIMESLICE_MS,
      frameIntervalMs: FIREFOX_VIDEO_FRAME_INTERVAL_MS,
    });
    if (response?.ok) {
      activeVideoTraceId = traceId;
      await appendVideoAnnotation(traceId, 'video_started', 'firefox_capture_tab_started', tab.id, tab.url);
      return;
    }
    await appendVideoAnnotation(
      traceId,
      'video_failed',
      response?.error ?? 'Firefox video recorder did not start.',
      tab.id,
      tab.url
    );
  } catch (error) {
    await appendVideoAnnotation(traceId, 'video_failed', errorMessage(error), tab.id, tab.url);
    activeVideoTraceId = null;
  }
}

async function stopVideoCapture(traceId?: string): Promise<void> {
  if (!activeVideoTraceId) return;
  if (traceId && activeVideoTraceId !== traceId) return;
  try {
    await sendVideoRecorderMessage({
      type: 'video-stop',
      ...(traceId ? { traceId } : {}),
    });
    if (traceId) await appendVideoAnnotation(traceId, 'video_stopped');
  } catch {
    // Video capture is best-effort; event capture must still stop cleanly.
  } finally {
    if (!traceId || activeVideoTraceId === traceId) activeVideoTraceId = null;
  }
}

async function ensureFirefoxVideoRecorderTab(): Promise<void> {
  if (firefoxVideoRecorderTabId !== null) {
    try {
      await browser.tabs.get(firefoxVideoRecorderTabId);
      await waitForVideoRecorderReady();
      return;
    } catch {
      firefoxVideoRecorderTabId = null;
    }
  }
  const tab = await browser.tabs.create({
    url: browser.runtime.getURL('/video-recorder.html'),
    active: false,
  });
  firefoxVideoRecorderTabId = tab.id ?? null;
  await waitForVideoRecorderReady();
}

function handleVideoRecorderConnect(port: chrome.runtime.Port): void {
  if (port.name !== VIDEO_RECORDER_PORT_NAME) return;
  firefoxVideoRecorderPort = port;
  port.onDisconnect.addListener(() => {
    if (firefoxVideoRecorderPort === port) firefoxVideoRecorderPort = null;
    for (const [requestId, waiter] of firefoxVideoResponseWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Firefox video recorder disconnected'));
      firefoxVideoResponseWaiters.delete(requestId);
    }
  });
  port.onMessage.addListener((message) => {
    handleFirefoxVideoPortMessage(message);
  });
  for (const resolve of firefoxVideoReadyWaiters) resolve();
  firefoxVideoReadyWaiters.clear();
}

async function persistVideoChunk(
  message: Extract<RuntimeMessage, { type: 'video-chunk' }>
): Promise<{ ok: boolean }> {
  const blob = new Blob([message.data], { type: message.mimeType });
  const decision = await evaluateVideoChunkStorage(message, blob.size);
  if (!decision.accept) {
    await handleVideoStorageLimitReached(message, decision.detail);
    return { ok: true };
  }

  const blobRow: BlobRow = {
    blob_key: message.blobKey,
    trace_id: message.traceId,
    kind: 'video',
    data: blob,
    created_at: message.endTimestamp,
  };
  const event: VideoChunkEvent = {
    event_id: createId('ev_'),
    trace_id: message.traceId,
    tab_id: message.tabId,
    timestamp: message.endTimestamp,
    url: message.url,
    kind: 'video_chunk',
    blob_key: message.blobKey,
    start_timestamp: message.startTimestamp,
    end_timestamp: message.endTimestamp,
  };

  await db.transaction('rw', db.recordings, db.events, db.blobs, async () => {
    const row = await db.recordings.get(message.traceId);
    if (!row || row.status !== 'draft' || row.capture_paused) return;
    await db.blobs.put(blobRow);
    await db.events.put(event);
  });
  return { ok: true };
}

async function evaluateVideoChunkStorage(
  message: Extract<RuntimeMessage, { type: 'video-chunk' }>,
  chunkBytes: number
): Promise<ReturnType<typeof evaluateVideoStorageBudget>> {
  const [row, traceBlobs, allVideoBlobs] = await Promise.all([
    db.recordings.get(message.traceId),
    db.blobs.where('trace_id').equals(message.traceId).toArray(),
    db.blobs.where('kind').equals('video').toArray(),
  ]);
  return evaluateVideoStorageBudget({
    chunkBytes,
    chunkEndTimestamp: message.endTimestamp,
    recordingStartedAt: row?.created_at ?? message.startTimestamp,
    existingRecordingBytes: totalBlobBytes(traceBlobs.filter((blob) => blob.kind === 'video')),
    existingLocalBytes: totalBlobBytes(allVideoBlobs),
  });
}

async function handleVideoStorageLimitReached(
  message: Extract<RuntimeMessage, { type: 'video-chunk' }>,
  detail: string
): Promise<void> {
  if (!videoLimitReachedTraceIds.has(message.traceId)) {
    videoLimitReachedTraceIds.add(message.traceId);
    await appendVideoAnnotation(
      message.traceId,
      'video_degraded',
      `${detail} Video capture was stopped; browser events continue recording.`,
      message.tabId,
      message.url
    );
  }
  if (activeVideoTraceId === message.traceId) {
    await stopVideoCapture(message.traceId);
  }
}

function totalBlobBytes(blobs: BlobRow[]): number {
  return blobs.reduce((total, blob) => total + safeBlobSize(blob.data), 0);
}

function safeBlobSize(blob: Blob): number {
  return Number.isFinite(blob.size) ? blob.size : 0;
}

async function appendVideoAnnotation(
  traceId: string,
  annotationType: VideoAnnotationType,
  text = '',
  tabId = -1,
  url = ''
): Promise<void> {
  await appendEvent({
    event_id: createId('ev_'),
    trace_id: traceId,
    tab_id: tabId,
    timestamp: Date.now(),
    url,
    kind: 'annotation',
    annotation_type: annotationType,
    ...(text ? { text } : {}),
  });
}

async function ensureVideoOffscreenDocument(): Promise<void> {
  const offscreen = chrome.offscreen;
  const documentUrl = chrome.runtime.getURL(VIDEO_RECORDER_URL);
  if (await offscreen.hasDocument()) {
    await waitForVideoRecorderReady();
    return;
  }
  await offscreen.createDocument({
    url: documentUrl,
    reasons: ['USER_MEDIA'] as chrome.offscreen.Reason[],
    justification: 'Record browser task videos for journey review and upload.',
  });
  await waitForVideoRecorderReady();
}

async function waitForVideoRecorderReady(): Promise<void> {
  if (getBrowserAdapter().capabilities.browser === 'firefox') {
    await waitForFirefoxVideoRecorderPort();
    return;
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const response = await sendVideoRecorderMessage<{ ok?: boolean }>({
        type: 'video-ping',
      });
      if (response?.ok) return;
    } catch {
      // The offscreen document may still be loading.
    }
    await delay(50);
  }
  throw new Error('video recorder did not become ready');
}

async function waitForFirefoxVideoRecorderPort(): Promise<void> {
  if (firefoxVideoRecorderPort) return;
  await new Promise<void>((resolve, reject) => {
    const waiter = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      firefoxVideoReadyWaiters.delete(waiter);
      reject(new Error('video recorder did not become ready'));
    }, 5_000);
    firefoxVideoReadyWaiters.add(waiter);
  });
}

async function getTabCaptureStreamId(tabId: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!streamId) {
        reject(new Error('tab capture did not return a stream id'));
        return;
      }
      resolve(streamId);
    });
  });
}

async function sendVideoRecorderMessage<T = unknown>(
  message: Record<string, unknown>
): Promise<T> {
  if (getBrowserAdapter().capabilities.browser === 'firefox') {
    return (await sendFirefoxVideoRecorderPortMessage(message)) as T;
  }
  return (await browser.runtime.sendMessage(message)) as T;
}

async function sendFirefoxVideoRecorderPortMessage(
  message: Record<string, unknown>
): Promise<unknown> {
  await waitForFirefoxVideoRecorderPort();
  const port = firefoxVideoRecorderPort;
  if (!port) throw new Error('Firefox video recorder port is unavailable');
  const requestId = `video_req_${++firefoxVideoRequestId}`;
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      firefoxVideoResponseWaiters.delete(requestId);
      reject(new Error('Firefox video recorder response timed out'));
    }, 10_000);
    firefoxVideoResponseWaiters.set(requestId, { resolve, reject, timeout });
    try {
      port.postMessage({ requestId, message });
    } catch (error) {
      clearTimeout(timeout);
      firefoxVideoResponseWaiters.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function handleFirefoxVideoPortMessage(message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const value = message as { requestId?: unknown; response?: unknown; error?: unknown };
  if (typeof value.requestId !== 'string') return;
  const waiter = firefoxVideoResponseWaiters.get(value.requestId);
  if (!waiter) return;
  clearTimeout(waiter.timeout);
  firefoxVideoResponseWaiters.delete(value.requestId);
  if (typeof value.error === 'string') {
    waiter.reject(new Error(value.error));
    return;
  }
  waiter.resolve(value.response);
}

async function videoCaptureTargetTab(): Promise<SenderLike['tab']> {
  const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeRecordableTab = activeTabs.find((tab) =>
    shouldRecordBrowserNavigationUrl(tab.url)
  );
  if (activeRecordableTab) return activeRecordableTab;

  const currentWindowTabs = await browser.tabs.query({ currentWindow: true });
  const currentWindowRecordableTab = [...currentWindowTabs]
    .reverse()
    .find((tab) => shouldRecordBrowserNavigationUrl(tab.url));
  if (currentWindowRecordableTab) return currentWindowRecordableTab;

  const allTabs = await browser.tabs.query({});
  return [...allTabs]
    .reverse()
    .find((tab) => shouldRecordBrowserNavigationUrl(tab.url));
}

function supportsChromeVideoCapture(): boolean {
  return Boolean(chrome.offscreen && chrome.tabCapture?.getMediaStreamId);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleTabCreated(tab: { id?: number; url?: string; pendingUrl?: string; openerTabId?: number }): Promise<void> {
  if (tab.id === undefined) return;
  const url = tab.url ?? tab.pendingUrl ?? 'about:blank';
  if (shouldRecordBrowserNavigationUrl(url)) tabUrlCache.set(tab.id, url);
  await ensureRecovered();
  if (!activeTraceId || !shouldRecordBrowserNavigationUrl(url)) return;
  await appendNavigationEvent(
    tabNavigationEvent({
      traceId: activeTraceId,
      tabId: tab.id,
      timestamp: Date.now(),
      url,
      navType: 'tabOpened',
      ...(tab.openerTabId !== undefined ? { openerTabId: tab.openerTabId } : {})
    })
  );
}

async function handleTabUpdated(
  tabId: number,
  changeInfo: { url?: string },
  tab: { url?: string; pendingUrl?: string }
): Promise<void> {
  const url = changeInfo.url ?? tab.url ?? tab.pendingUrl;
  if (shouldRecordBrowserNavigationUrl(url)) tabUrlCache.set(tabId, url);
}

async function handleTabRemoved(tabId: number): Promise<void> {
  const url = tabUrlCache.get(tabId) ?? 'about:blank';
  tabUrlCache.delete(tabId);
  await ensureRecovered();
  if (!activeTraceId || !shouldRecordBrowserNavigationUrl(url)) return;
  await appendNavigationEvent(
    tabNavigationEvent({
      traceId: activeTraceId,
      tabId,
      timestamp: Date.now(),
      url,
      navType: 'tabClosed'
    })
  );
}

async function handleNavigationCommitted(details: { tabId: number; frameId: number; url: string }): Promise<void> {
  if (details.frameId !== 0 || !shouldRecordBrowserNavigationUrl(details.url)) return;
  const fromUrl = tabUrlCache.get(details.tabId);
  tabUrlCache.set(details.tabId, details.url);
  await ensureRecovered();
  if (!activeTraceId) return;
  await appendNavigationEvent(
    tabNavigationEvent({
      traceId: activeTraceId,
      tabId: details.tabId,
      timestamp: Date.now(),
      url: details.url,
      navType: 'load',
      ...(fromUrl && fromUrl !== details.url ? { fromUrl } : {})
    })
  );
}

function warnDroppedEvent(kind: string): (error: unknown) => void {
  return (error) =>
    console.warn(`[journey-forge] dropped ${kind} event: ${errorMessage(error)}`);
}

async function appendDownloadCreated(item: chrome.downloads.DownloadItem): Promise<void> {
  await ensureRecovered();
  if (!activeTraceId) return;
  await appendEvent(downloadEventFromItem({ traceId: activeTraceId, timestamp: Date.now(), item }) as unknown as CapturedEvent).catch(warnDroppedEvent('download'));
}

async function appendDownloadChanged(delta: chrome.downloads.DownloadDelta): Promise<void> {
  await ensureRecovered();
  if (!activeTraceId) return;
  const event = downloadEventFromDelta({ traceId: activeTraceId, timestamp: Date.now(), delta });
  if (event) await appendEvent(event as unknown as CapturedEvent).catch(warnDroppedEvent('download'));
}

async function appendNavigationEvent(event: CapturedEvent): Promise<void> {
  await appendEvent(event).catch(warnDroppedEvent('navigation'));
}

async function captureSettingsForActiveRecording(traceId: string | null, row: RecordingRow | null): Promise<CaptureSettings | null> {
  if (row?.envelope.capture_settings) return row.envelope.capture_settings;
  if (traceId) return DEFAULT_CAPTURE_SETTINGS;
  return null;
}

async function broadcastRecordingState(
  active: boolean,
  traceId: string | null,
  captureSettings?: CaptureSettings | null,
  capturePaused = false
): Promise<void> {
  const resolvedCaptureSettings = captureSettings === undefined ? await captureSettingsForActiveRecording(traceId, null) : captureSettings;
  const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) =>
        browser.tabs.sendMessage(tab.id!, {
          type: 'recording-state',
          active,
          traceId,
          captureSettings: resolvedCaptureSettings,
          capturePaused
        })
      )
  );
}

async function flushRecordingTabs(traceId: string): Promise<void> {
  const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) =>
        withTimeout(
          browser.tabs.sendMessage(tab.id!, {
            type: 'flush-recording-events',
            traceId,
            timeoutMs: CONTENT_FLUSH_TIMEOUT_MS
          }),
          CONTENT_FLUSH_TIMEOUT_MS + 250
        )
      )
  );
}

async function deleteRecordingLocal(traceId: string): Promise<void> {
  await db.transaction('rw', db.recordings, db.events, db.blobs, db.uploadManifests, async () => {
    await Promise.all([
      db.recordings.delete(traceId),
      db.events.where('trace_id').equals(traceId).delete(),
      db.blobs.where('trace_id').equals(traceId).delete(),
      db.uploadManifests.delete(traceId)
    ]);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return await Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ]);
}

function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  if (!message || typeof message !== 'object') return false;
  const type = (message as { type?: unknown }).type;
  return (
    type === 'get-active-recording' ||
    type === 'start-recording' ||
    (type === 'start-task-recording' && typeof (message as { caseId?: unknown }).caseId === 'string') ||
    type === 'pause-capture' ||
    type === 'resume-capture' ||
    type === 'stop-recording' ||
    type === 'event' ||
    isCaptchaDetectedMessage(message) ||
    isAppendAnnotationMessage(message) ||
    isVideoChunkMessage(message) ||
    type === 'open-dashboard' ||
    (type === 'resume-upload' && typeof (message as { traceId?: unknown }).traceId === 'string') ||
    (type === 'poll-upload-status' && typeof (message as { traceId?: unknown }).traceId === 'string') ||
    (type === 'delete-recording' && typeof (message as { traceId?: unknown }).traceId === 'string')
  );
}

function isVideoChunkMessage(message: object): boolean {
  const value = message as {
    type?: unknown;
    traceId?: unknown;
    tabId?: unknown;
    url?: unknown;
    blobKey?: unknown;
    startTimestamp?: unknown;
    endTimestamp?: unknown;
    mimeType?: unknown;
    data?: unknown;
  };
  return (
    value.type === 'video-chunk' &&
    typeof value.traceId === 'string' &&
    typeof value.tabId === 'number' &&
    typeof value.url === 'string' &&
    typeof value.blobKey === 'string' &&
    typeof value.startTimestamp === 'number' &&
    typeof value.endTimestamp === 'number' &&
    typeof value.mimeType === 'string' &&
    isArrayBufferLike(value.data)
  );
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return (
    value instanceof ArrayBuffer ||
    Object.prototype.toString.call(value) === '[object ArrayBuffer]'
  );
}

function isCaptchaDetectedMessage(message: object): boolean {
  const value = message as { type?: unknown; traceId?: unknown; triggerEventId?: unknown; providers?: unknown };
  return (
    value.type === 'captcha-detected' &&
    (value.traceId === undefined || typeof value.traceId === 'string') &&
    typeof value.triggerEventId === 'string' &&
    Array.isArray(value.providers) &&
    value.providers.every(isCaptchaProvider)
  );
}

function isCaptchaProvider(value: unknown): value is CaptchaProvider {
  return (
    value === 'google_recaptcha' ||
    value === 'hcaptcha' ||
    value === 'cloudflare_turnstile' ||
    value === 'arkose' ||
    value === 'geetest' ||
    value === 'generic_captcha'
  );
}

function isAppendAnnotationMessage(message: object): boolean {
  const value = message as { type?: unknown; traceId?: unknown; annotationType?: unknown; text?: unknown };
  return (
    value.type === 'append-annotation' &&
    (value.traceId === undefined || typeof value.traceId === 'string') &&
    (value.text === undefined || typeof value.text === 'string') &&
    (value.annotationType === 'captcha_solved' || value.annotationType === 'captcha_blocked')
  );
}
