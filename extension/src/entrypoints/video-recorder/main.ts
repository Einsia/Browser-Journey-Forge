import { errorMessage } from '@/shared/errors';
import { createId } from '@/shared/id';
import { browser } from 'wxt/browser';

type VideoRecorderMessage =
  | { type: 'video-ping' }
  | {
      type: 'video-start';
      traceId: string;
      streamId: string;
      tabId: number;
      url: string;
      timesliceMs?: number;
    }
  | {
      type: 'video-start-firefox';
      traceId: string;
      tabId: number;
      url: string;
      timesliceMs?: number;
      frameIntervalMs?: number;
    }
  | { type: 'video-stop'; traceId?: string };

type VideoRecorderPortEnvelope = {
  requestId: string;
  message: unknown;
};

type ActiveRecorder = {
  traceId: string;
  tabId: number;
  url: string;
  stream: MediaStream;
  recorder: MediaRecorder;
  startedAt: number;
  chunkStartedAt: number;
  pendingChunks: Set<Promise<unknown>>;
  stopped: Promise<void>;
  resolveStopped: () => void;
  frameTimer?: ReturnType<typeof setInterval>;
};

const DEFAULT_TIMESLICE_MS = 5_000;
const FIREFOX_FRAME_INTERVAL_MS = 1_000;
const VIDEO_RECORDER_PORT_NAME = 'journey-forge-video-recorder';
let activeRecorder: ActiveRecorder | null = null;

browser.runtime.onMessage.addListener(
  (message: unknown): Promise<unknown> | { ok: true } | undefined => {
    if (!isVideoRecorderMessage(message)) return undefined;
    return handleVideoRecorderMessage(message);
  }
);

connectVideoRecorderPort();

function connectVideoRecorderPort(): void {
  try {
    const port = browser.runtime.connect({ name: VIDEO_RECORDER_PORT_NAME });
    port.onMessage.addListener((envelope: unknown) => {
      if (!isVideoRecorderPortEnvelope(envelope)) return;
      void handleVideoRecorderPortMessage(port, envelope);
    });
  } catch {
    // Chrome offscreen recording still uses runtime messages. A missing port must
    // not prevent tabCapture from starting.
  }
}

async function handleVideoRecorderPortMessage(
  port: ReturnType<typeof browser.runtime.connect>,
  envelope: VideoRecorderPortEnvelope
): Promise<void> {
  if (!isVideoRecorderMessage(envelope.message)) {
    port.postMessage({
      requestId: envelope.requestId,
      response: { ok: false, error: 'invalid video recorder message' },
    });
    return;
  }
  const response = await handleVideoRecorderMessage(envelope.message);
  port.postMessage({ requestId: envelope.requestId, response });
}

function handleVideoRecorderMessage(
  message: VideoRecorderMessage
): Promise<unknown> | { ok: true } {
  if (message.type === 'video-ping') {
    return { ok: true };
  }

  if (message.type === 'video-start') {
    return startChromeRecording(message).catch((error) => ({
      ok: false,
      error: errorMessage(error),
    }));
  }

  if (message.type === 'video-start-firefox') {
    return startFirefoxRecording(message).catch((error) => ({
      ok: false,
      error: errorMessage(error),
    }));
  }

  return stopRecording(message.traceId).catch((error) => ({
    ok: false,
    error: errorMessage(error),
  }));
}

async function startChromeRecording(
  message: Extract<VideoRecorderMessage, { type: 'video-start' }>
): Promise<{ ok: true }> {
  await stopRecording();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: message.streamId,
      },
    },
  } as MediaStreamConstraints);
  const recorder = createMediaRecorder(stream);
  activateRecorder({
    traceId: message.traceId,
    tabId: message.tabId,
    url: message.url,
    stream,
    recorder,
    ...(message.timesliceMs !== undefined ? { timesliceMs: message.timesliceMs } : {}),
  });
  return { ok: true };
}

async function startFirefoxRecording(
  message: Extract<VideoRecorderMessage, { type: 'video-start-firefox' }>
): Promise<{ ok: true }> {
  await stopRecording();
  const firstFrame = await captureFirefoxFrame(message.tabId);
  const canvas = document.createElement('canvas');
  canvas.width = firstFrame.width;
  canvas.height = firstFrame.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  context.drawImage(firstFrame, 0, 0, canvas.width, canvas.height);

  const stream = canvas.captureStream(
    Math.max(1, Math.round(1000 / (message.frameIntervalMs ?? FIREFOX_FRAME_INTERVAL_MS)))
  );
  const recorder = createMediaRecorder(stream);
  const active = activateRecorder({
    traceId: message.traceId,
    tabId: message.tabId,
    url: message.url,
    stream,
    recorder,
    ...(message.timesliceMs !== undefined ? { timesliceMs: message.timesliceMs } : {}),
  });

  active.frameTimer = setInterval(() => {
    void captureFirefoxFrame(message.tabId)
      .then((frame) => {
        if (canvas.width !== frame.width || canvas.height !== frame.height) {
          canvas.width = frame.width;
          canvas.height = frame.height;
        }
        context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      })
      .catch(() => {
        // Keep the existing frame; the background trace keeps recording events.
      });
  }, message.frameIntervalMs ?? FIREFOX_FRAME_INTERVAL_MS);
  return { ok: true };
}

function createMediaRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = preferredMimeType();
  return new MediaRecorder(stream, mimeType ? { mimeType } : {});
}

function activateRecorder(options: {
  traceId: string;
  tabId: number;
  url: string;
  stream: MediaStream;
  recorder: MediaRecorder;
  timesliceMs?: number;
}): ActiveRecorder {
  let resolveStopped: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const now = Date.now();
  const active: ActiveRecorder = {
    traceId: options.traceId,
    tabId: options.tabId,
    url: options.url,
    stream: options.stream,
    recorder: options.recorder,
    startedAt: now,
    chunkStartedAt: now,
    pendingChunks: new Set(),
    stopped,
    resolveStopped,
  };

  options.recorder.ondataavailable = (event) => {
    if (event.data.size <= 0) return;
    const chunkStartedAt = active.chunkStartedAt;
    const chunkEndedAt = Date.now();
    active.chunkStartedAt = chunkEndedAt;
    const pending = sendChunk(active, event.data, chunkStartedAt, chunkEndedAt);
    active.pendingChunks.add(pending);
    pending.finally(() => active.pendingChunks.delete(pending));
  };
  options.recorder.onstop = () => {
    if (active.frameTimer) clearInterval(active.frameTimer);
    active.stream.getTracks().forEach((track) => track.stop());
    active.resolveStopped();
  };
  options.recorder.start(options.timesliceMs ?? DEFAULT_TIMESLICE_MS);
  activeRecorder = active;
  return active;
}

async function stopRecording(
  traceId?: string
): Promise<{ ok: true; stopped: boolean }> {
  const active = activeRecorder;
  if (!active || (traceId && active.traceId !== traceId)) {
    return { ok: true, stopped: false };
  }
  activeRecorder = null;
  if (active.frameTimer) clearInterval(active.frameTimer);
  if (active.recorder.state === 'recording') active.recorder.requestData();
  if (active.recorder.state !== 'inactive') active.recorder.stop();
  await active.stopped;
  await Promise.allSettled(active.pendingChunks);
  return { ok: true, stopped: true };
}

async function captureFirefoxFrame(tabId: number): Promise<HTMLImageElement> {
  const tabs = browser.tabs as unknown as {
    captureTab?: (
      tabId?: number,
      options?: { format?: 'jpeg' | 'png'; quality?: number }
    ) => Promise<string>;
  };
  if (!tabs.captureTab) throw new Error('Firefox tabs.captureTab is unavailable');
  return await loadImage(
    await tabs.captureTab(tabId, { format: 'jpeg', quality: 60 })
  );
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  await image.decode();
  return image;
}

async function sendChunk(
  active: ActiveRecorder,
  data: Blob,
  startTimestamp: number,
  endTimestamp: number
): Promise<unknown> {
  return browser.runtime.sendMessage({
    type: 'video-chunk',
    traceId: active.traceId,
    tabId: active.tabId,
    url: active.url,
    blobKey: createId('video_'),
    startTimestamp,
    endTimestamp,
    mimeType: data.type || active.recorder.mimeType || 'video/webm',
    data: await data.arrayBuffer(),
  });
}

function preferredMimeType(): string | null {
  for (const mimeType of [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  return null;
}

function isVideoRecorderMessage(
  message: unknown
): message is VideoRecorderMessage {
  if (!message || typeof message !== 'object') return false;
  const type = (message as { type?: unknown }).type;
  if (type === 'video-ping') return true;
  if (type === 'video-stop') {
    const value = message as { traceId?: unknown };
    return value.traceId === undefined || typeof value.traceId === 'string';
  }
  if (type === 'video-start-firefox') {
    const value = message as {
      traceId?: unknown;
      tabId?: unknown;
      url?: unknown;
      timesliceMs?: unknown;
      frameIntervalMs?: unknown;
    };
    return (
      typeof value.traceId === 'string' &&
      typeof value.tabId === 'number' &&
      typeof value.url === 'string' &&
      (value.timesliceMs === undefined || typeof value.timesliceMs === 'number') &&
      (value.frameIntervalMs === undefined || typeof value.frameIntervalMs === 'number')
    );
  }
  if (type !== 'video-start') return false;
  const value = message as {
    traceId?: unknown;
    streamId?: unknown;
    tabId?: unknown;
    url?: unknown;
    timesliceMs?: unknown;
  };
  return (
    typeof value.traceId === 'string' &&
    typeof value.streamId === 'string' &&
    typeof value.tabId === 'number' &&
    typeof value.url === 'string' &&
    (value.timesliceMs === undefined || typeof value.timesliceMs === 'number')
  );
}

function isVideoRecorderPortEnvelope(
  value: unknown
): value is VideoRecorderPortEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as { requestId?: unknown; message?: unknown };
  return typeof envelope.requestId === 'string' && 'message' in envelope;
}
