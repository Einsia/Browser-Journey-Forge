import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  UIEvent as ReactUIEvent,
} from 'react';
import {
  Archive,
  ClipboardList,
  MoreHorizontal,
  Settings,
} from 'lucide-react';
import { getBrowserAdapter } from '@/browser';
import {
  createTranslator,
  effectiveLocale,
  englishTranslator,
  type LocalePreference,
  type TranslationKey,
  type Translator,
} from '@/i18n';
import { recordingModeLabel } from '@/identity/display';
import { saveReviewMetadata, updateReviewMetadata } from '@/recording/recorder';
import {
  buildLiveTraceSummary,
  shouldUseLiveTraceSummary,
} from '@/recording/trace-summary';
import { captureModeNotice, historyRowState } from '@/reliability/status';
import {
  createPreviewUrl,
  mediaPreviewModel,
  sortMediaRows,
} from '@/review/media-preview';
import { buildReviewSummary, type ReviewSummary } from '@/review/summary';
import { buildTraceWarnings, type TraceWarning } from '@/review/trace-warnings';
import type {
  BlobRow,
  BrowserCapabilities,
  CapturedEvent,
  RecordingMode,
  RecordingRow,
  RecordingStatus,
  TraceSummary,
  UploadManifest,
} from '@/shared/types';
import { alertTone } from '@/shared/alert-tone';
import { errorMessage } from '@/shared/errors';
import { SHOW_TASKS_UI } from '@/shared/product';
import { TUNNEL_BYPASS_HEADERS } from '@/shared/http';
import { sendRuntimeMessage } from '@/shared/runtime';
import { db, getConfig, setConfig, type ConfigRow } from '@/storage/db';
import { buildRecordingHtmlReport } from '@/storage/export-html-report';
import { buildRecordingExport } from '@/storage/export-recording';
import { subscribeLocalStoreChanges } from '@/storage/live-refresh';
import { DeleteRecordingDialog } from '@/ui/delete-recording-dialog';
import { IdentityPanel } from '@/ui/identity-panel';
import { recordingLabel } from '@/ui/recording-label';
import {
  historyMenuActions,
  type HistoryMenuAction,
} from '@/ui/history-actions';
import {
  Alert,
  Badge,
  Button as UiButton,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldLabel,
  IconButton,
  Input,
  RadioCard,
  SwitchField,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/ui/primitives';
import { reviewPanelActions } from '@/ui/review-actions';

type DashboardView = 'history' | 'tasks' | 'settings' | 'review';
type HistorySortKey = 'created' | 'label' | 'status' | 'duration' | 'domains';
type HistorySortDirection = 'asc' | 'desc';
type HistoryStatusFilter = RecordingStatus | 'all';
type HistoryModeFilter = RecordingMode | 'all';
type HistoryQuickFilter = 'all' | 'needs_review' | 'upload_failed';

type TimelineItem = {
  id: string;
  timestamp: number;
  category: 'navigation' | 'form' | 'network' | 'media' | 'captcha' | 'download';
  title: string;
  detail: string;
};


const DEFAULT_CAPABILITIES = getBrowserAdapter().capabilities;
const DASHBOARD_RAIL_WIDTH_KEY = 'journey-forge-dashboard-rail-width';
const DASHBOARD_RAIL_DEFAULT_WIDTH = 248;
const DASHBOARD_RAIL_MIN_WIDTH = 220;
const DASHBOARD_RAIL_MAX_WIDTH = 360;
const REVIEW_SPLIT_WIDTH_KEY = 'journey-forge-review-left-width';
const REVIEW_SPLIT_DEFAULT_WIDTH = 380;
const REVIEW_SPLIT_MIN_WIDTH = 300;
const REVIEW_SPLIT_MAX_WIDTH = 620;
const HISTORY_ROW_HEIGHT = 88;
const HISTORY_OVERSCAN = 8;
const MEDIA_ROW_HEIGHT = 98;
const MEDIA_OVERSCAN = 5;
const TASK_DESC_PREVIEW_CHARS = 55;
const TIMELINE_MAX_ITEMS = 160;
const SAFE_FILENAME_MAX_CHARS = 80;
const DashboardI18nContext = createContext<Translator>(englishTranslator);

function useDashboardTranslator(): Translator {
  return useContext(DashboardI18nContext);
}

export function DashboardApp() {
  const [view, setView] = useState<DashboardView>(() => viewFromHash().view);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(
    () => viewFromHash().traceId
  );
  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [liveSummaries, setLiveSummaries] = useState<
    Record<string, TraceSummary>
  >({});
  const [config, setConfigState] = useState<ConfigRow | null>(null);
  const [capabilities] = useState<BrowserCapabilities>(DEFAULT_CAPABILITIES);
  const [busyTraceId, setBusyTraceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [railWidth, setRailWidth] = useState(readStoredDashboardRailWidth);
  const locale = effectiveLocale(config?.locale);
  const tr = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    void loadDashboard();
    const subscription = subscribeLocalStoreChanges(() => {
      void loadDashboard({ pollUploads: false });
    });
    const onHashChange = () => {
      const next = viewFromHash();
      setView(next.view);
      setSelectedTraceId(next.traceId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  async function loadDashboard(
    options: { pollUploads?: boolean } = {}
  ): Promise<void> {
    const pollUploads = options.pollUploads ?? true;
    const [nextConfig, rows] = await Promise.all([
      getConfig(),
      loadRecordings(),
    ]);
    const pollableRows = rows.filter(shouldPollUploadStatus);
    if (pollUploads && pollableRows.length > 0) {
      await Promise.allSettled(
        pollableRows.map((row) =>
          sendRuntimeMessage<{ ok: boolean; row: RecordingRow }>({
            type: 'poll-upload-status',
            traceId: row.trace_id,
          })
        )
      );
      const refreshedRows = await loadRecordings();
      setConfigState(nextConfig);
      setRecordings(refreshedRows);
      setLiveSummaries(await loadLiveSummaries(refreshedRows));
      return;
    }
    setConfigState(nextConfig);
    setRecordings(rows);
    setLiveSummaries(await loadLiveSummaries(rows));
  }

  function navigate(nextView: DashboardView, traceId?: string): void {
    const hash =
      nextView === 'review' && traceId
        ? `#review=${encodeURIComponent(traceId)}`
        : `#${nextView}`;
    window.location.hash = hash;
    setView(nextView);
    setSelectedTraceId(traceId ?? null);
  }

  async function resumeUpload(traceId: string): Promise<void> {
    await runTraceAction(traceId, async () => {
      await sendRuntimeMessage<{ ok: boolean }>({
        type: 'resume-upload',
        traceId,
      });
    });
  }

  async function deleteRecording(traceId: string): Promise<void> {
    await runTraceAction(traceId, async () => {
      await sendRuntimeMessage<{ ok: boolean }>({
        type: 'delete-recording',
        traceId,
      });
      if (selectedTraceId === traceId) navigate('history');
    });
  }

  async function exportRecording(traceId: string): Promise<void> {
    await runTraceAction(traceId, async () => {
      const exported = await buildRecordingExport(traceId);
      downloadJson(
        `${safeFilename(
          recordingLabel(
            recordings.find((candidate) => candidate.trace_id === traceId),
            tr
          )
        )}-${traceId}.json`,
        exported
      );
    });
  }

  async function exportHtmlReport(traceId: string): Promise<void> {
    await runTraceAction(traceId, async () => {
      const exported = await buildRecordingExport(traceId);
      const html = buildRecordingHtmlReport(exported, {
        requireSkillSignals: true,
      });
      downloadText(
        `${safeFilename(
          recordingLabel(
            recordings.find((candidate) => candidate.trace_id === traceId),
            tr
          )
        )}-${traceId}.html`,
        html,
        'text/html'
      );
    });
  }

  async function runTraceAction(
    traceId: string,
    action: () => Promise<void>
  ): Promise<void> {
    setBusyTraceId(traceId);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyTraceId(null);
      await loadDashboard();
    }
  }

  const reviewCount = recordings.filter(
    (recording) => recording.status === 'review_required'
  ).length;
  const activeCount = recordings.filter(
    (recording) => recording.status === 'draft'
  ).length;
  const queueCount = recordings.filter(isQueueRelevantRecording).length;

  function resizeDashboardRail(nextWidth: number): void {
    const next = clampDashboardRailWidth(nextWidth);
    setRailWidth(next);
    localStorage.setItem(DASHBOARD_RAIL_WIDTH_KEY, String(next));
  }

  function startDashboardRailResize(
    event: ReactPointerEvent<HTMLDivElement>
  ): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = railWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      resizeDashboardRail(startWidth + moveEvent.clientX - startX);
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function handleDashboardRailResizeKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>
  ): void {
    const smallStep = 8;
    const largeStep = 24;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        resizeDashboardRail(railWidth - (event.shiftKey ? largeStep : smallStep));
        break;
      case 'ArrowRight':
        event.preventDefault();
        resizeDashboardRail(railWidth + (event.shiftKey ? largeStep : smallStep));
        break;
      case 'Home':
        event.preventDefault();
        resizeDashboardRail(DASHBOARD_RAIL_MIN_WIDTH);
        break;
      case 'End':
        event.preventDefault();
        resizeDashboardRail(DASHBOARD_RAIL_MAX_WIDTH);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        resizeDashboardRail(DASHBOARD_RAIL_DEFAULT_WIDTH);
        break;
    }
  }

  return (
    <DashboardI18nContext.Provider value={tr}>
      <main
        className="dashboard-shell"
        style={
          {
            '--dashboard-rail-width': `${railWidth}px`,
          } as CSSProperties
        }
      >
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <h1>{tr('app.dashboardTitle')}</h1>
          <p>{tr('app.dashboardSubtitle')}</p>
        </div>
        <Tabs
          value={view}
          onValueChange={(next) => navigate(next as DashboardView)}
        >
          <TabsList className="dashboard-tabs" aria-label={tr('app.dashboardViews')}>
            <TabsTrigger value="history">
              <Archive aria-hidden="true" />
              {tr('nav.history')}
            </TabsTrigger>
            {SHOW_TASKS_UI ? (
              <TabsTrigger value="tasks">
                <ClipboardList aria-hidden="true" />
                {tr('nav.tasks')}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="settings">
              <Settings aria-hidden="true" />
              {tr('nav.settings')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="dashboard-rail-stats" aria-label={tr('app.recordingSummary')}>
          <div>
            <span>{tr('stats.localTraces')}</span>
            <strong>{recordings.length}</strong>
          </div>
          <div>
            <span>{tr('stats.needReview')}</span>
            <strong>{reviewCount}</strong>
          </div>
          <div>
            <span>{tr('stats.activeDrafts')}</span>
            <strong>{activeCount}</strong>
          </div>
          <div>
            <span>{tr('stats.uploadQueue')}</span>
            <strong>{queueCount}</strong>
          </div>
        </div>
      </header>
      <div
        className="dashboard-rail-resizer"
        role="separator"
        aria-label={tr('resize.dashboardSidebarLabel')}
        aria-orientation="vertical"
        aria-valuemin={DASHBOARD_RAIL_MIN_WIDTH}
        aria-valuemax={DASHBOARD_RAIL_MAX_WIDTH}
        aria-valuenow={railWidth}
        tabIndex={0}
        onPointerDown={startDashboardRailResize}
        onKeyDown={handleDashboardRailResizeKeyDown}
        title={tr('resize.dashboardSidebarTitle')}
      />

      {error ? (
        <Alert tone="danger" className="dashboard-error">
          {error}
        </Alert>
      ) : null}

      {view === 'settings' && config ? (
        <SettingsView
          config={config}
          capabilities={capabilities}
          onSaved={loadDashboard}
          onError={setError}
        />
      ) : null}

      {SHOW_TASKS_UI && view === 'tasks' && config ? (
        <TasksView config={config} />
      ) : null}

      {view === 'history' ? (
        <HistoryView
          recordings={recordings}
          liveSummaries={liveSummaries}
          busyTraceId={busyTraceId}
          onRefresh={loadDashboard}
          onReview={(traceId) => navigate('review', traceId)}
          onResume={resumeUpload}
          onExport={exportRecording}
          onExportHtml={exportHtmlReport}
          onDelete={deleteRecording}
        />
      ) : null}

      {view === 'review' ? (
        <ReviewView
          traceId={selectedTraceId}
          recordings={recordings}
          busy={busyTraceId === selectedTraceId}
          onSelect={(traceId) => navigate('review', traceId)}
          onQueued={async (traceId) => {
            await loadDashboard();
            await resumeUpload(traceId);
            navigate('history');
          }}
          onExport={exportRecording}
          onExportHtml={exportHtmlReport}
          onRefresh={loadDashboard}
          onError={setError}
        />
      ) : null}
      </main>
    </DashboardI18nContext.Provider>
  );
}

export function SettingsView(props: {
  config: ConfigRow;
  capabilities: BrowserCapabilities;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const { config, capabilities, onSaved, onError } = props;
  const tr = useDashboardTranslator();
  const [draft, setDraft] = useState(config);
  const [draftDirty, setDraftDirty] = useState(false);
  const [syncedConfigKey, setSyncedConfigKey] = useState(() =>
    settingsConfigKey(config)
  );
  const [saving, setSaving] = useState(false);
  const mediaNotice = captureModeNotice(draft.capture, tr);

  useEffect(() => {
    const nextConfigKey = settingsConfigKey(config);
    if (nextConfigKey === syncedConfigKey || draftDirty) return;
    setDraft(config);
    setSyncedConfigKey(nextConfigKey);
  }, [config, draftDirty, syncedConfigKey]);

  function updateDraft(updater: (current: ConfigRow) => ConfigRow): void {
    setDraftDirty(true);
    setDraft(updater);
  }

  async function applyImmediately(patch: Partial<ConfigRow>): Promise<void> {
    onError(null);
    try {
      await setConfig(patch);
      await onSaved();
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  async function saveConnectionSettings(): Promise<void> {
    setSaving(true);
    onError(null);
    try {
      await setConfig({
        endpoint_url: draft.endpoint_url.trim(),
        api_key: draft.api_key.trim(),
        locale: draft.locale,
      });
      setDraftDirty(false);
      setSyncedConfigKey(settingsConfigKey({ ...config, endpoint_url: draft.endpoint_url.trim(), api_key: draft.api_key.trim(), locale: draft.locale }));
      await onSaved();
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-split">
      <Card className="dashboard-section">
        <CardHeader>
          <h2>{tr('settings.recordingTitle')}</h2>
        </CardHeader>
        <CardContent>
          <div className="mode-grid">
            {(
              ['research_free_form', 'real_user_free_form'] as RecordingMode[]
            ).map((mode) => {
              const label = recordingModeLabel(mode, tr);
              return (
                <RadioCard selected={config.recording_mode === mode} key={mode}>
                  <input
                    type="radio"
                    name="recording-mode"
                    value={mode}
                    checked={config.recording_mode === mode}
                    onChange={() =>
                      void applyImmediately({ recording_mode: mode })
                    }
                  />
                  <strong>{label.label}</strong>
                  <span>{label.detail}</span>
                </RadioCard>
              );
            })}
          </div>

          {config.recording_mode === 'real_user_free_form' ? (
            <Alert tone="warning" className="consent-alert">
              <strong>{tr('settings.realUserConsentTitle')}</strong>
              <span>{tr('settings.realUserConsentCopy')}</span>
              <Toggle
                label={tr('settings.realUserConsentToggle')}
                checked={config.realUserConsentAccepted}
                onChange={(checked) =>
                  void applyImmediately({
                    realUserConsentAccepted: checked,
                    ...(checked
                      ? {
                          realUserConsentAcceptedAt:
                            config.realUserConsentAcceptedAt ??
                            new Date().toISOString(),
                        }
                      : {}),
                  })
                }
              />
            </Alert>
          ) : null}

          <div className="toggle-row">
            <Toggle
              label={tr('settings.video')}
              checked={capabilities.video && config.capture.video}
              disabled={!capabilities.video}
              {...(!capabilities.video
                ? { note: tr('settings.unavailableInBrowser') }
                : {})}
              onChange={(checked) =>
                void applyImmediately({
                  capture: { ...config.capture, video: checked },
                })
              }
            />
            <Toggle
              label={tr('settings.networkBodies')}
              checked={config.capture.networkBodies}
              onChange={(checked) =>
                void applyImmediately({
                  capture: { ...config.capture, networkBodies: checked },
                })
              }
            />
          </div>

          {mediaNotice ? (
            <Alert tone={alertTone(mediaNotice.tone)}>
              <strong>{mediaNotice.title}</strong>
              <span>{mediaNotice.detail}</span>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="dashboard-section">
        <CardHeader>
          <h2>{tr('settings.connectionTitle')}</h2>
          <UiButton variant="primary" onClick={saveConnectionSettings} disabled={saving}>
            {tr('settings.save')}
          </UiButton>
        </CardHeader>
        <CardContent>
          <div className="settings-grid">
            <Field>
              <FieldLabel>{tr('settings.language')}</FieldLabel>
              <select
                className="ui-input"
                value={draft.locale}
                onChange={(event) => {
                  const locale = event.currentTarget.value as LocalePreference;
                  updateDraft((current) => ({
                    ...current,
                    locale,
                  }));
                }}
              >
                <option value="auto">{tr('settings.languageAuto')}</option>
                <option value="en">{tr('settings.languageEnglish')}</option>
                <option value="zh-CN">{tr('settings.languageChinese')}</option>
              </select>
            </Field>

            <Field>
              <FieldLabel>{tr('settings.endpointUrl')}</FieldLabel>
              <Input
                type="url"
                value={draft.endpoint_url}
                onChange={(event) => {
                  const endpointUrl = event.currentTarget.value;
                  updateDraft((current) => ({
                    ...current,
                    endpoint_url: endpointUrl,
                  }));
                }}
                placeholder="https://api.example.test"
              />
            </Field>

            <Field>
              <FieldLabel>{tr('settings.apiKey')}</FieldLabel>
              <Input
                type="password"
                value={draft.api_key}
                onChange={(event) => {
                  const apiKey = event.currentTarget.value;
                  updateDraft((current) => ({
                    ...current,
                    api_key: apiKey,
                  }));
                }}
                placeholder={tr('settings.apiKeyPlaceholder')}
              />
            </Field>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type ServerTask = {
  case_id: string;
  site: string;
  description: string;
  instruction?: string;
  brief?: string;
  has_brief?: boolean;
  status: string;
  time_limit?: number;
  eval_schema?: { method?: string; url_pattern?: string };
  extra_info?: Record<string, unknown>;
};

const TASK_STATUS_KEYS: Record<string, TranslationKey> = {
  pending: 'tasks.pending',
  recording: 'tasks.recording',
  completed: 'tasks.completed',
};

const tasksCache: { data: ServerTask[]; ts: number } = { data: [], ts: 0 };
const TASKS_CACHE_TTL = 30_000;

function TasksView(props: { config: ConfigRow }) {
  const tr = useDashboardTranslator();
  const { config } = props;
  const [tasks, setTasks] = useState<ServerTask[]>(tasksCache.data);
  const [firstLoad, setFirstLoad] = useState(tasksCache.data.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ServerTask | null>(null);
  const [briefContent, setBriefContent] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [starting, setStarting] = useState(false);

  async function loadBrief(task: ServerTask): Promise<void> {
    setSelected(task);
    setBriefContent(null);
    if (!task.has_brief) return;
    const base = config.endpoint_url?.trim().replace(/\/+$/, '');
    if (!base) return;
    setBriefLoading(true);
    try {
      const resp = await fetch(`${base}/v1/tasks/${encodeURIComponent(task.case_id)}`, { headers: { ...TUNNEL_BYPASS_HEADERS } });
      if (resp.ok) {
        const detail = await resp.json() as ServerTask;
        setBriefContent(detail.brief ?? null);
      }
    } catch { /* ignore */ }
    finally { setBriefLoading(false); }
  }

  async function startTaskRecording(task: ServerTask): Promise<void> {
    const base = config.endpoint_url?.trim().replace(/\/+$/, '');
    if (!base) return;
    setStarting(true);
    setError(null);
    try {
      const claimResp = await fetch(`${base}/v1/tasks/${encodeURIComponent(task.case_id)}/claim`, {
        method: 'POST',
        headers: { ...TUNNEL_BYPASS_HEADERS, 'Content-Type': 'application/json', ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}) },
        body: JSON.stringify({ operator: 'extension' }),
      });
      if (!claimResp.ok && claimResp.status !== 409) {
        throw new Error(`claim failed: ${claimResp.status}`);
      }
      await sendRuntimeMessage<unknown>({
        type: 'start-task-recording',
        caseId: task.case_id,
        siteUrl: task.site,
      });
      tasksCache.ts = 0;
      setSelected(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load(silent: boolean) {
      const base = config.endpoint_url?.trim().replace(/\/+$/, '');
      if (!base) { setFirstLoad(false); return; }
      if (!silent) setError(null);
      try {
        const resp = await fetch(`${base}/v1/tasks`, { headers: { ...TUNNEL_BYPASS_HEADERS } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = (await resp.json()) as { tasks: ServerTask[] };
        if (!cancelled) {
          const list = data.tasks ?? [];
          setTasks(list);
          tasksCache.data = list;
          tasksCache.ts = Date.now();
        }
      } catch {
        if (!cancelled && !silent) setError(tr('tasks.loadError'));
      } finally {
        if (!cancelled) setFirstLoad(false);
      }
    }
    const fresh = Date.now() - tasksCache.ts < TASKS_CACHE_TTL;
    if (!fresh) void load(tasksCache.data.length > 0);
    else setFirstLoad(false);
    const interval = setInterval(() => load(true), 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [config.endpoint_url]);

  if (!config.endpoint_url?.trim()) {
    return (
      <section className="dashboard-section tasks-view">
        <EmptyState>{tr('tasks.noEndpoint')}</EmptyState>
      </section>
    );
  }

  if (firstLoad) {
    return (
      <section className="dashboard-section tasks-view">
        <EmptyState>{tr('tasks.loading')}</EmptyState>
      </section>
    );
  }

  if (error && tasks.length === 0) {
    return (
      <section className="dashboard-section tasks-view">
        <Alert tone="danger">{error}</Alert>
      </section>
    );
  }

  const pending = tasks.filter(t => t.status === 'pending').length;
  const recording = tasks.filter(t => t.status === 'recording').length;
  const completed = tasks.filter(t => t.status === 'completed').length;

  return (
    <section className="dashboard-section tasks-view">
      <div className="tasks-header">
        <h2>{tr('tasks.title')}</h2>
        <span className="tasks-stats">
          {tr('tasks.stats', { pending: String(pending), recording: String(recording), completed: String(completed) })}
        </span>
      </div>
      <div className="tasks-list">
        {tasks.map(task => (
          <div
            key={task.case_id}
            className={`tasks-item ${task.status}`}
            onClick={() => void loadBrief(task)}
          >
            <span className={`tasks-dot ${task.status}`} />
            <div className="tasks-item-main">
              <span className="tasks-item-id">{task.case_id}</span>
              <span className="tasks-item-site">{task.site}</span>
            </div>
            <span className="tasks-item-desc">{(task.description ?? '').slice(0, TASK_DESC_PREVIEW_CHARS)}</span>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="modal-bg" onClick={(e) => { if (e.target instanceof HTMLElement && e.target.className === 'modal-bg') setSelected(null); }}>
          <div className="tasks-modal">
            <div className="tasks-modal-header">
              <div className="tasks-modal-title">
                <span className={`tasks-dot ${selected.status}`} />
                <h2>{selected.case_id}</h2>
                <Badge tone={selected.status === 'completed' ? 'success' : selected.status === 'recording' ? 'warning' : 'neutral'}>
                  {TASK_STATUS_KEYS[selected.status] ? tr(TASK_STATUS_KEYS[selected.status]!) : selected.status}
                </Badge>
              </div>
              <button className="modal-close" onClick={() => setSelected(null)}>&times;</button>
            </div>
            <div className="tasks-modal-body">
              <TaskField label={tr('tasks.site')} value={selected.site} isLink />
              <TaskField label={tr('tasks.timeLimit')} value={tr('tasks.minutes', { n: String(selected.time_limit ?? 30) })} />
              {briefLoading ? (
                <p className="brief-loading">{tr('tasks.briefLoading')}</p>
              ) : briefContent ? (
                <div className="brief-content">
                  <h4>{tr('tasks.briefTitle')}</h4>
                  <pre>{briefContent}</pre>
                </div>
              ) : (
                <TaskField label={tr('tasks.instruction')} value={selected.instruction || selected.description} />
              )}
            </div>
            <div className="tasks-modal-footer">
              <UiButton
                variant="primary"
                onClick={() => void startTaskRecording(selected)}
                disabled={starting || selected.status === 'completed'}
              >
                {starting ? tr('tasks.starting') : selected.status === 'completed' ? tr('tasks.completed') : tr('tasks.startRecording')}
              </UiButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TaskField(props: { label: string; value: string; isLink?: boolean }) {
  return (
    <div className="task-field">
      <div className="task-field-label">{props.label}</div>
      <div className="task-field-value">
        {props.isLink ? (
          <a href={`https://${props.value}`} target="_blank" rel="noopener noreferrer">{props.value}</a>
        ) : (
          props.value
        )}
      </div>
    </div>
  );
}

function HistoryView(props: {
  recordings: RecordingRow[];
  liveSummaries: Record<string, TraceSummary>;
  busyTraceId: string | null;
  onRefresh: () => Promise<void>;
  onReview: (traceId: string) => void;
  onResume: (traceId: string) => Promise<void>;
  onExport: (traceId: string) => Promise<void>;
  onExportHtml: (traceId: string) => Promise<void>;
  onDelete: (traceId: string) => Promise<void>;
}) {
  const {
    recordings,
    liveSummaries,
    busyTraceId,
    onRefresh,
    onReview,
    onResume,
    onExport,
    onExportHtml,
    onDelete,
  } = props;
  const tr = useDashboardTranslator();
  const [identityRecording, setIdentityRecording] =
    useState<RecordingRow | null>(null);
  const [judgeReasonRecording, setJudgeReasonRecording] =
    useState<RecordingRow | null>(null);
  const [deleteRecording, setDeleteRecording] = useState<RecordingRow | null>(
    null
  );
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<HistoryStatusFilter>('all');
  const [modeFilter, setModeFilter] = useState<HistoryModeFilter>('all');
  const [domainFilter, setDomainFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState<HistoryQuickFilter>('all');
  const [sortKey, setSortKey] = useState<HistorySortKey>('created');
  const [sortDirection, setSortDirection] =
    useState<HistorySortDirection>('desc');

  const domainOptions = useMemo(() => {
    const domains = new Set<string>();
    for (const recording of recordings) {
      const summary = traceSummaryForRecording(recording, liveSummaries);
      for (const domain of summary.domains) domains.add(domain);
    }
    return [...domains].sort((left, right) => left.localeCompare(right));
  }, [recordings, liveSummaries]);

  const visibleRecordings = useMemo(
    () =>
      filterAndSortHistory(recordings, liveSummaries, {
        query,
        status: statusFilter,
        mode: modeFilter,
        domain: domainFilter,
        quick: quickFilter,
        sortKey,
        sortDirection,
      }),
    [
      recordings,
      liveSummaries,
      query,
      statusFilter,
      modeFilter,
      domainFilter,
      quickFilter,
      sortKey,
      sortDirection,
    ]
  );
  const virtualHistory = useVirtualRows({
    itemCount: visibleRecordings.length,
    rowHeight: HISTORY_ROW_HEIGHT,
    overscan: HISTORY_OVERSCAN,
  });

  function runMenuAction(
    action: HistoryMenuAction,
    recording: RecordingRow
  ): void {
    if (action.disabled) return;
    switch (action.id) {
      case 'review':
        onReview(recording.trace_id);
        break;
      case 'upload':
        void onResume(recording.trace_id);
        break;
      case 'export':
        void onExport(recording.trace_id);
        break;
      case 'export_html':
        void onExportHtml(recording.trace_id);
        break;
      case 'identity':
        setIdentityRecording(recording);
        break;
      case 'judge_reason':
        setJudgeReasonRecording(recording);
        break;
      case 'delete':
        setDeleteRecording(recording);
        break;
    }
  }

  return (
    <Card className="dashboard-section">
      <CardHeader>
        <div>
          <h2>{tr('history.title')}</h2>
          <span className="section-kicker">
            {tr('history.countSummary', {
              visible: visibleRecordings.length,
              total: recordings.length
            })}
          </span>
        </div>
        <UiButton onClick={() => void onRefresh()}>{tr('history.refresh')}</UiButton>
      </CardHeader>

      {recordings.length === 0 ? (
        <CardContent>
          <EmptyState>{tr('history.empty')}</EmptyState>
        </CardContent>
      ) : (
        <CardContent>
          <div className="history-toolbar">
            <Field>
              <FieldLabel>{tr('history.search')}</FieldLabel>
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={tr('history.searchPlaceholder')}
              />
            </Field>
            <Field>
              <FieldLabel>{tr('history.status')}</FieldLabel>
              <select
                className="ui-input"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.currentTarget.value as HistoryStatusFilter)
                }
              >
                <option value="all">{tr('history.allStatuses')}</option>
                {recordingStatuses().map((status) => (
                  <option value={status} key={status}>
                    {statusFilterLabel(status, tr)}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel>{tr('history.mode')}</FieldLabel>
              <select
                className="ui-input"
                value={modeFilter}
                onChange={(event) =>
                  setModeFilter(event.currentTarget.value as HistoryModeFilter)
                }
              >
                <option value="all">{tr('history.allModes')}</option>
                <option value="research_free_form">{tr('history.research')}</option>
                <option value="real_user_free_form">{tr('history.realUser')}</option>
              </select>
            </Field>
            <Field>
              <FieldLabel>{tr('history.domain')}</FieldLabel>
              <select
                className="ui-input"
                value={domainFilter}
                onChange={(event) => setDomainFilter(event.currentTarget.value)}
              >
                <option value="all">{tr('history.allDomains')}</option>
                {domainOptions.map((domain) => (
                  <option value={domain} key={domain}>
                    {domain}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel>{tr('history.needs')}</FieldLabel>
              <select
                className="ui-input"
                value={quickFilter}
                onChange={(event) =>
                  setQuickFilter(event.currentTarget.value as HistoryQuickFilter)
                }
              >
                <option value="all">{tr('history.allRecordings')}</option>
                <option value="needs_review">{tr('history.needsReview')}</option>
                <option value="upload_failed">{tr('history.uploadFailed')}</option>
              </select>
            </Field>
            <Field>
              <FieldLabel>{tr('history.sort')}</FieldLabel>
              <div className="history-sort-controls">
                <select
                  className="ui-input"
                  value={sortKey}
                  onChange={(event) =>
                    setSortKey(event.currentTarget.value as HistorySortKey)
                  }
                >
                  <option value="created">{tr('history.created')}</option>
                  <option value="label">{tr('history.label')}</option>
                  <option value="status">{tr('history.status')}</option>
                  <option value="duration">{tr('history.duration')}</option>
                  <option value="domains">{tr('history.domains')}</option>
                </select>
                <UiButton
                  size="sm"
                  onClick={() =>
                    setSortDirection((current) =>
                      current === 'asc' ? 'desc' : 'asc'
                    )
                  }
                >
                  {sortDirection === 'asc' ? tr('history.asc') : tr('history.desc')}
                </UiButton>
              </div>
            </Field>
          </div>

          {visibleRecordings.length === 0 ? (
            <EmptyState>{tr('history.noMatches')}</EmptyState>
          ) : (
            <div
              className="virtual-history"
              ref={virtualHistory.containerRef}
              onScroll={virtualHistory.onScroll}
            >
              <div className="virtual-history-head history-grid-row">
                <span>{tr('history.recording')}</span>
                <span>{tr('history.status')}</span>
                <span>{tr('history.created')}</span>
                <span>{tr('history.domains')}</span>
                <span>{tr('history.duration')}</span>
                <span>{tr('history.uploadState')}</span>
                <span>{tr('history.localState')}</span>
                <span>{tr('history.actions')}</span>
              </div>
              <div
                className="virtual-history-spacer"
                style={{ height: virtualHistory.totalHeight }}
              >
                {virtualHistory.items.map(({ index, start }) => {
                  const recording = visibleRecordings[index];
                  if (!recording) return null;
                  const busy = busyTraceId === recording.trace_id;
                  const state = historyRowState(recording, tr);
                  const summary = traceSummaryForRecording(
                    recording,
                    liveSummaries
                  );
                  const actions = historyMenuActions(
                    {
                      status: recording.status,
                      busy,
                      hasJudgeReason: Boolean(recording.last_error && (recording.status === 'rejected' || recording.status === 'accepted')),
                    },
                    tr
                  );
                  return (
                    <div
                      className="virtual-history-row history-grid-row"
                      key={recording.trace_id}
                      style={{ transform: `translateY(${start}px)` }}
                    >
                      <div>
                        <strong>{recordingLabel(recording, tr)}</strong>
                        <code>{recording.trace_id}</code>
                      </div>
                      <div>
                        <RecordingStatusBadge status={recording.status} />
                      </div>
                      <div>{formatDate(recording.created_at)}</div>
                      <div>{formatDomains(summary.domains, tr)}</div>
                      <div>{formatDuration(summary.duration_ms)}</div>
                      <div title={state.upload.detail}>
                        <Badge tone={state.upload.tone}>{state.upload.label}</Badge>
                      </div>
                      <div title={`${state.capture.detail}\n${state.localCopy.detail}`}>
                        <Badge tone={state.capture.tone}>{state.capture.label}</Badge>
                      </div>
                      <div>
                        <ActionMenu
                          actions={actions}
                          onSelect={(action) =>
                            runMenuAction(action, recording)
                          }
                          label={tr('history.actionsFor', {
                            label: recordingLabel(recording, tr)
                          })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      )}
      {identityRecording ? (
        <IdentityDialog
          recording={identityRecording}
          tr={tr}
          onClose={() => setIdentityRecording(null)}
        />
      ) : null}
      {judgeReasonRecording ? (
        <Dialog open onOpenChange={(open) => !open && setJudgeReasonRecording(null)}>
          <DialogContent aria-describedby={undefined}>
            <div className="dialog-heading">
              <div>
                <DialogTitle>{tr('actions.judgeReason')}</DialogTitle>
                <code>{judgeReasonRecording.trace_id}</code>
              </div>
              <DialogClose asChild>
                <UiButton variant="secondary">{tr('review.close')}</UiButton>
              </DialogClose>
            </div>
            <div className="judge-reason-body">
              <RecordingStatusBadge status={judgeReasonRecording.status} />
              <pre className="judge-reason-text">{judgeReasonRecording.last_error}</pre>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {deleteRecording ? (
        <DeleteRecordingDialog
          recording={deleteRecording}
          tr={tr}
          onCancel={() => setDeleteRecording(null)}
          onConfirm={async () => {
            const traceId = deleteRecording.trace_id;
            await onDelete(traceId);
            setDeleteRecording(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function ActionMenu(props: {
  actions: HistoryMenuAction[];
  onSelect: (action: HistoryMenuAction) => void;
  label: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={props.label}>
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            disabled={action.disabled}
            {...(action.destructive ? { 'data-variant': 'danger' } : {})}
            onSelect={() => {
              props.onSelect(action);
            }}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IdentityDialog(props: {
  recording: RecordingRow;
  tr: Translator;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="identity-modal" aria-describedby={undefined}>
        <div className="dialog-heading">
          <div>
            <DialogTitle>{props.tr('identity.generatedTitle')}</DialogTitle>
            <code>{props.recording.trace_id}</code>
          </div>
          <DialogClose asChild>
            <UiButton variant="secondary">{props.tr('review.close')}</UiButton>
          </DialogClose>
        </div>
        <IdentityPanel
          identity={props.recording.identity}
          mode={props.recording.envelope.recording_mode}
          tr={props.tr}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ReviewView(props: {
  traceId: string | null;
  recordings: RecordingRow[];
  busy: boolean;
  onSelect: (traceId: string) => void;
  onQueued: (traceId: string) => Promise<void>;
  onExport: (traceId: string) => Promise<void>;
  onExportHtml: (traceId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const {
    traceId,
    recordings,
    busy,
    onSelect,
    onQueued,
    onExport,
    onExportHtml,
    onRefresh,
    onError,
  } = props;
  const tr = useDashboardTranslator();
  const recording = recordings.find(
    (candidate) => candidate.trace_id === traceId
  );
  const reviewable = recordings.filter(
    (candidate) => candidate.status === 'review_required'
  );
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [mediaRows, setMediaRows] = useState<BlobRow[]>([]);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [uploadManifest, setUploadManifest] = useState<UploadManifest | null>(
    null
  );
  const [previewBlobKey, setPreviewBlobKey] = useState<string | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewSplitWidth, setReviewSplitWidth] = useState(
    readStoredReviewSplitWidth
  );
  const virtualMedia = useVirtualRows({
    itemCount: mediaRows.length,
    rowHeight: MEDIA_ROW_HEIGHT,
    overscan: MEDIA_OVERSCAN,
  });
  const previewIndex = previewBlobKey
    ? mediaRows.findIndex((blob) => blob.blob_key === previewBlobKey)
    : -1;
  const previewBlob = previewIndex >= 0 ? mediaRows[previewIndex] : null;

  useEffect(() => {
    setLabel(recording?.envelope.label ?? '');
    setDescription(recording?.envelope.description ?? '');
    setTags(recording?.envelope.tags.join(', ') ?? '');
    setPreviewBlobKey(null);
    setIdentityOpen(false);
  }, [recording?.trace_id]);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setMediaRows([]);
    setTimelineItems([]);
    setUploadManifest(null);

    if (!traceId) {
      setLoadingSummary(false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingSummary(true);
    Promise.all([
      buildReviewSummary(traceId),
      loadMediaRows(traceId),
      db.uploadManifests.get(traceId),
      loadTimelineItems(traceId, tr),
    ]).then(
      ([nextSummary, nextMediaRows, nextUploadManifest, nextTimelineItems]) => {
        if (!cancelled) {
          setSummary(nextSummary);
          setMediaRows(nextMediaRows);
          setUploadManifest(nextUploadManifest ?? null);
          setTimelineItems(nextTimelineItems);
        }
      }
    )
      .catch((caught) => {
        if (!cancelled) onError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false);
      });

    return () => {
      cancelled = true;
    };
  }, [traceId, onError, tr]);

  async function setMediaExcluded(
    blob: BlobRow,
    excluded: boolean
  ): Promise<void> {
    if (!recording) return;
    onError(null);
    try {
      await db.blobs.update(
        blob.blob_key,
        excluded
          ? { excluded_from_upload: true, excluded_at: Date.now() }
          : { excluded_from_upload: false }
      );
      await db.uploadManifests.delete(recording.trace_id);
      const [nextSummary, nextMediaRows, nextUploadManifest] =
        await Promise.all([
          buildReviewSummary(recording.trace_id),
          loadMediaRows(recording.trace_id),
          db.uploadManifests.get(recording.trace_id),
        ]);
      setSummary(nextSummary);
      setMediaRows(nextMediaRows);
      setUploadManifest(nextUploadManifest ?? null);
      if (previewBlobKey === blob.blob_key) {
        setPreviewBlobKey(blob.blob_key);
      }
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  function resizeReviewSplit(nextWidth: number): void {
    const next = clampReviewSplitWidth(nextWidth);
    setReviewSplitWidth(next);
    localStorage.setItem(REVIEW_SPLIT_WIDTH_KEY, String(next));
  }

  function startReviewSplitResize(
    event: ReactPointerEvent<HTMLDivElement>
  ): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = reviewSplitWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      resizeReviewSplit(startWidth + moveEvent.clientX - startX);
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function handleReviewSplitResizeKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>
  ): void {
    const smallStep = 8;
    const largeStep = 24;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        resizeReviewSplit(reviewSplitWidth - (event.shiftKey ? largeStep : smallStep));
        break;
      case 'ArrowRight':
        event.preventDefault();
        resizeReviewSplit(reviewSplitWidth + (event.shiftKey ? largeStep : smallStep));
        break;
      case 'Home':
        event.preventDefault();
        resizeReviewSplit(REVIEW_SPLIT_MIN_WIDTH);
        break;
      case 'End':
        event.preventDefault();
        resizeReviewSplit(REVIEW_SPLIT_MAX_WIDTH);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        resizeReviewSplit(REVIEW_SPLIT_DEFAULT_WIDTH);
        break;
    }
  }

  function openPreviousPreview(): void {
    if (previewIndex <= 0) return;
    setPreviewBlobKey(mediaRows[previewIndex - 1]?.blob_key ?? null);
  }

  function openNextPreview(): void {
    if (previewIndex < 0 || previewIndex >= mediaRows.length - 1) return;
    setPreviewBlobKey(mediaRows[previewIndex + 1]?.blob_key ?? null);
  }

  async function confirmUpload(): Promise<void> {
    if (!recording) return;
    const reviewDetails = readReviewDetails();
    if (!reviewDetails) {
      onError(tr('review.labelRequiredError'));
      return;
    }
    onError(null);
    setReviewBusy(true);
    try {
      await saveReviewMetadata({
        traceId: recording.trace_id,
        ...reviewDetails,
      });
      await onQueued(recording.trace_id);
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setReviewBusy(false);
    }
  }

  function readReviewDetails():
    | { label: string; description?: string; tags: string[] }
    | null {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return null;
    return {
      label: trimmedLabel,
      ...optionalDescription(description),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }

  async function saveReviewDetails(): Promise<boolean> {
    if (!recording) return false;
    const reviewDetails = readReviewDetails();
    if (!reviewDetails) {
      onError(tr('review.labelRequiredError'));
      return false;
    }
    onError(null);
    setReviewBusy(true);
    try {
      await updateReviewMetadata({
        traceId: recording.trace_id,
        ...reviewDetails,
      });
      await onRefresh();
      return true;
    } catch (caught) {
      onError(errorMessage(caught));
      return false;
    } finally {
      setReviewBusy(false);
    }
  }

  async function exportJsonWithReviewDetails(): Promise<void> {
    if (!recording) return;
    if (recording.status === 'review_required') {
      const saved = await saveReviewDetails();
      if (!saved) return;
    }
    await onExport(recording.trace_id);
  }

  async function exportHtmlWithReviewDetails(): Promise<void> {
    if (!recording) return;
    if (recording.status === 'review_required') {
      const saved = await saveReviewDetails();
      if (!saved) return;
    }
    await onExportHtml(recording.trace_id);
  }

  if (!traceId || !recording) {
    return (
      <Card className="dashboard-section">
        <CardHeader>
          <h2>{tr('review.title')}</h2>
        </CardHeader>
        {reviewable.length === 0 ? (
          <CardContent>
            <EmptyState>{tr('review.empty')}</EmptyState>
          </CardContent>
        ) : (
          <CardContent>
            <div className="review-pick-list">
              {reviewable.map((candidate) => (
                <UiButton
                  key={candidate.trace_id}
                  onClick={() => onSelect(candidate.trace_id)}
                >
                  <strong>{recordingLabel(candidate, tr)}</strong>
                  <span>{formatDate(candidate.created_at)}</span>
                </UiButton>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    );
  }

  const actionBusy = busy || reviewBusy;
  const hasTask = Boolean(recording.envelope.task_case_id);
  const actions = reviewPanelActions({ status: recording.status, busy: actionBusy, hasTask }, tr);
  const confirmAction = actions.find(
    (action) => action.id === 'confirm_upload'
  );
  const saveDetailsAction = actions.find(
    (action) => action.id === 'save_details'
  );
  const exportJsonAction = actions.find(
    (action) => action.id === 'export_json'
  );
  const exportHtmlAction = actions.find(
    (action) => action.id === 'export_html'
  );
  const identityAction = actions.find(
    (action) => action.id === 'view_identity'
  );

  return (
    <section
      className="review-layout"
      style={
        {
          '--review-left-width': `${reviewSplitWidth}px`,
        } as CSSProperties
      }
    >
      <Card className="review-editor-card">
        <CardHeader>
          <h2>{tr('review.title')}</h2>
          <RecordingStatusBadge status={recording.status} />
        </CardHeader>

        <CardContent>
          <Field>
            <FieldLabel>{tr('review.labelRequired')}</FieldLabel>
            <Input
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              maxLength={96}
            />
          </Field>

          <Field>
            <FieldLabel>{tr('review.descriptionOptional')}</FieldLabel>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              rows={5}
            />
          </Field>

          <Field>
            <FieldLabel>{tr('review.tagsCommaSeparated')}</FieldLabel>
            <Input
              value={tags}
              onChange={(event) => setTags(event.currentTarget.value)}
              placeholder={tr('review.tagsPlaceholder')}
            />
          </Field>

          <div className="review-controls">
            <UiButton
              variant="primary"
              onClick={() => void confirmUpload()}
              disabled={confirmAction?.disabled ?? true}
            >
              {confirmAction?.label ?? tr('actions.confirmAndUpload')}
            </UiButton>
            <UiButton
              onClick={() => void saveReviewDetails()}
              disabled={saveDetailsAction?.disabled ?? true}
            >
              {saveDetailsAction?.label ?? tr('actions.saveDetails')}
            </UiButton>
            <UiButton
              onClick={() => void exportJsonWithReviewDetails()}
              disabled={exportJsonAction?.disabled ?? true}
            >
              {exportJsonAction?.label ?? tr('actions.exportJson')}
            </UiButton>
            <UiButton
              onClick={() => void exportHtmlWithReviewDetails()}
              disabled={exportHtmlAction?.disabled ?? true}
            >
              {exportHtmlAction?.label ?? tr('actions.exportHtml')}
            </UiButton>
            <UiButton
              onClick={() => setIdentityOpen(true)}
              disabled={identityAction?.disabled ?? false}
            >
              {identityAction?.label ?? tr('actions.viewIdentity')}
            </UiButton>
          </div>
        </CardContent>
      </Card>

      <div
        className="review-split-resizer"
        role="separator"
        aria-label={tr('resize.reviewSplitLabel')}
        aria-orientation="vertical"
        aria-valuemin={REVIEW_SPLIT_MIN_WIDTH}
        aria-valuemax={REVIEW_SPLIT_MAX_WIDTH}
        aria-valuenow={reviewSplitWidth}
        tabIndex={0}
        onPointerDown={startReviewSplitResize}
        onKeyDown={handleReviewSplitResizeKeyDown}
        title={tr('resize.reviewSplitTitle')}
      />

      <Card className="summary-card">
        <CardHeader>
          <h2>{tr('review.summary')}</h2>
          <code>{recording.trace_id}</code>
        </CardHeader>
        {loadingSummary || !summary ? (
          <CardContent>
            <EmptyState>{tr('review.loadingSummary')}</EmptyState>
          </CardContent>
        ) : (
          <CardContent>
            <TraceWarnings
              warnings={buildTraceWarnings({
                recording,
                summary,
                mediaRows,
                uploadManifest,
                tr,
              })}
            />

            <dl className="summary-grid">
              <div>
                <dt>{tr('history.duration')}</dt>
                <dd>{formatDuration(summary.durationMs)}</dd>
              </div>
              <div>
                <dt>{tr('review.uploadEstimate')}</dt>
                <dd>{formatBytes(summary.uploadBytesEstimate)}</dd>
              </div>
              <div>
                <dt>{tr('review.videoChunks')}</dt>
                <dd>{summary.media.videoChunks}</dd>
              </div>
              <div>
                <dt>{tr('review.totalEvents')}</dt>
                <dd>{Object.values(summary.eventCounts).reduce((a, b) => a + b, 0)}</dd>
              </div>
              <div>
                <dt>{tr('review.eventTypes')}</dt>
                <dd>{Object.keys(summary.eventCounts).length}</dd>
              </div>
              <div>
                <dt>{tr('review.eventsPerMinute')}</dt>
                <dd>{formatRate(summary.volume.eventsPerMinute)}</dd>
              </div>
              <div>
                <dt>{tr('review.snapshotsPerMinute')}</dt>
                <dd>{formatRate(summary.volume.eventRates.dom_snapshot ?? 0)}</dd>
              </div>
            </dl>

            <div className="summary-block">
              <h3>{tr('review.mediaReview')}</h3>
              {mediaRows.length === 0 ? (
                <p>{tr('review.noMedia')}</p>
              ) : (
                <div
                  className="media-review-list virtual-media-list"
                  ref={virtualMedia.containerRef}
                  onScroll={virtualMedia.onScroll}
                >
                  <div
                    className="virtual-media-spacer"
                    style={{ height: virtualMedia.totalHeight }}
                  >
                  {virtualMedia.items.map(({ index, start }) => {
                    const blob = mediaRows[index];
                    if (!blob) return null;
                    const preview = mediaPreviewModel(blob, tr);
                    const excluded = Boolean(blob.excluded_from_upload);
                    return (
                      <div
                        className={
                          excluded
                            ? 'media-review-row excluded'
                            : 'media-review-row'
                        }
                        key={blob.blob_key}
                        style={{ transform: `translateY(${start}px)` }}
                      >
                        <MediaPreviewTile
                          blob={blob}
                          preview={preview}
                          tr={tr}
                          onOpen={() => setPreviewBlobKey(blob.blob_key)}
                        />
                        <div className="media-meta">
                          <strong>{preview.kindLabel}</strong>
                          <span>
                            {formatBytes(blob.data.size)} -{' '}
                            {formatDate(blob.created_at)}
                          </span>
                          <code>{blob.blob_key}</code>
                        </div>
                        <div className="inline-actions">
                          <Badge
                            tone={
                              preview.stateTone === 'accepted'
                                ? 'success'
                                : 'danger'
                            }
                          >
                            {preview.stateLabel}
                          </Badge>
                          <UiButton
                            size="sm"
                            onClick={() => setPreviewBlobKey(blob.blob_key)}
                            disabled={!preview.previewable}
                          >
                            {tr('review.preview')}
                          </UiButton>
                          <UiButton
                            size="sm"
                            onClick={() =>
                              void setMediaExcluded(blob, !excluded)
                            }
                            disabled={busy}
                          >
                            {excluded ? tr('review.include') : tr('review.exclude')}
                          </UiButton>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}
            </div>

            <CollapsibleTimeline
              items={timelineItems}
              startTimestamp={recording.created_at}
            />

            <div className="summary-block">
              <h3>{tr('history.domains')}</h3>
              <p>{formatDomains(summary.domains, tr)}</p>
            </div>

            <div className="summary-block">
              <h3>{tr('review.events')}</h3>
              <dl className="summary-stats-inline">
                {Object.entries(summary.eventCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([kind, count]) => (
                    <div key={kind}><dt>{kind}</dt><dd>{count}</dd></div>
                  ))}
              </dl>
            </div>

            {summary.volume.topActionTypes.length > 0 ? (
              <div className="summary-block">
                <h3>{tr('review.topActions')}</h3>
                <dl className="summary-stats-inline">
                  {summary.volume.topActionTypes.map((action) => (
                    <div key={action.actionType}><dt>{action.actionType}</dt><dd>{action.count}</dd></div>
                  ))}
                </dl>
              </div>
            ) : null}

            {summary.redactionWarnings.length > 0 ? (
              <div className="summary-block">
                <h3>{tr('review.redactionSummary')}</h3>
                <Alert tone="warning">
                  {summary.redactionWarnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </Alert>
              </div>
            ) : null}
          </CardContent>
        )}
      </Card>

      {previewBlob ? (
        <MediaPreviewDialog
          blob={previewBlob}
          tr={tr}
          hasPrevious={previewIndex > 0}
          hasNext={previewIndex >= 0 && previewIndex < mediaRows.length - 1}
          onPrevious={openPreviousPreview}
          onNext={openNextPreview}
          onToggleExcluded={() =>
            void setMediaExcluded(
              previewBlob,
              !Boolean(previewBlob.excluded_from_upload)
            )
          }
          onClose={() => setPreviewBlobKey(null)}
        />
      ) : null}
      {identityOpen ? (
        <IdentityDialog
          recording={recording}
          tr={tr}
          onClose={() => setIdentityOpen(false)}
        />
      ) : null}
    </section>
  );
}

function TraceWarnings(props: { warnings: TraceWarning[] }) {
  const tr = useDashboardTranslator();
  if (props.warnings.length === 0) return null;
  return (
    <div className="trace-warning-list" aria-label={tr('review.traceQaWarnings')}>
      {props.warnings.map((warning) => (
        <Alert
          tone={warning.severity === 'danger' ? 'danger' : 'warning'}
          key={warning.id}
        >
          <strong>{warning.title}</strong>
          <span>{warning.detail}</span>
        </Alert>
      ))}
    </div>
  );
}

function CollapsibleTimeline(props: {
  items: TimelineItem[];
  startTimestamp: number;
}) {
  const tr = useDashboardTranslator();
  const [expanded, setExpanded] = useState(false);
  const { items, startTimestamp } = props;

  if (items.length === 0) {
    return (
      <div className="summary-block">
        <h3>{tr('review.timeline')}</h3>
        <p>{tr('review.noTimeline')}</p>
      </div>
    );
  }

  return (
    <div className="summary-block">
      <div className="timeline-header">
        <h3>{tr('review.timeline')}</h3>
        <UiButton
          size="sm"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? tr('review.timelineCollapse')
            : tr('review.timelineExpand', { count: items.length })}
        </UiButton>
      </div>
      {expanded ? (
        <div className="timeline-scroll-container">
          <ol className="event-timeline">
            {items.map((item) => (
              <li className={`event-timeline-item ${item.category}`} key={item.id}>
                <time>{formatRelativeTime(item.timestamp, startTimestamp)}</time>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function MediaPreviewTile(props: {
  blob: BlobRow;
  preview: ReturnType<typeof mediaPreviewModel>;
  tr: Translator;
  onOpen: () => void;
}) {
  const src = useObjectUrl(props.blob.data, props.preview.previewable);

  if (!props.preview.previewable || !src) {
    return (
      <div
        className="media-thumb unavailable"
        aria-label={props.tr('media.previewUnavailableLabel', { kind: props.preview.kindLabel })}
      >
        <span>{props.preview.kindLabel}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="media-thumb"
      onClick={props.onOpen}
      aria-label={props.tr('media.previewButtonLabel', { blobKey: props.preview.blobKey })}
    >
      {props.blob.kind === 'video' ? (
        <video src={src} aria-label={props.preview.alt} muted preload="metadata" />
      ) : (
        <img src={src} alt={props.preview.alt} />
      )}
    </button>
  );
}

function MediaPreviewDialog(props: {
  blob: BlobRow;
  tr: Translator;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToggleExcluded: () => void;
  onClose: () => void;
}) {
  const preview = mediaPreviewModel(props.blob, props.tr);
  const src = useObjectUrl(props.blob.data, preview.previewable);
  const excluded = Boolean(props.blob.excluded_from_upload);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && props.hasPrevious) {
        event.preventDefault();
        props.onPrevious();
      } else if (event.key === 'ArrowRight' && props.hasNext) {
        event.preventDefault();
        props.onNext();
      } else if (event.key.toLowerCase() === 'e') {
        event.preventDefault();
        props.onToggleExcluded();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    props.hasNext,
    props.hasPrevious,
    props.onNext,
    props.onPrevious,
    props.onToggleExcluded,
  ]);

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent aria-describedby={undefined}>
        <div className="dialog-heading">
          <div>
            <DialogTitle>{preview.kindLabel}</DialogTitle>
            <code>{props.blob.blob_key}</code>
          </div>
          <div className="dialog-actions">
            <UiButton
              variant="secondary"
              onClick={props.onPrevious}
              disabled={!props.hasPrevious}
            >
              {props.tr('review.previous')}
            </UiButton>
            <UiButton
              variant="secondary"
              onClick={props.onNext}
              disabled={!props.hasNext}
            >
              {props.tr('review.next')}
            </UiButton>
            <UiButton onClick={props.onToggleExcluded}>
              {excluded ? props.tr('review.include') : props.tr('review.exclude')}
            </UiButton>
            <DialogClose asChild>
              <UiButton variant="secondary">{props.tr('review.close')}</UiButton>
            </DialogClose>
          </div>
        </div>
        {preview.previewable && src ? (
          props.blob.kind === 'video' ? (
            <video
              className="media-preview-image"
              src={src}
              controls
              preload="metadata"
              aria-label={preview.alt}
            />
          ) : (
            <img className="media-preview-image" src={src} alt={preview.alt} />
          )
        ) : (
          <EmptyState>{props.tr('review.previewUnavailable')}</EmptyState>
        )}
        <dl className="modal-meta">
          <div>
            <dt>{props.tr('review.captureTime')}</dt>
            <dd>{formatDate(props.blob.created_at)}</dd>
          </div>
          <div>
            <dt>{props.tr('review.size')}</dt>
            <dd>{formatBytes(props.blob.data.size)}</dd>
          </div>
          <div>
            <dt>{props.tr('history.uploadState')}</dt>
            <dd>{preview.stateLabel}</dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function useObjectUrl(data: Blob, enabled: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      return undefined;
    }
    const preview = createPreviewUrl(data);
    setSrc(preview.src);
    return () => preview.revoke();
  }, [data, enabled]);

  return src;
}

function RecordingStatusBadge(props: { status: RecordingRow['status'] }) {
  const tr = useDashboardTranslator();
  return <Badge tone={statusTone(props.status)}>{statusFilterLabel(props.status, tr)}</Badge>;
}

function statusTone(
  status: RecordingRow['status']
): 'neutral' | 'info' | 'warning' | 'danger' | 'success' {
  switch (status) {
    case 'draft':
    case 'uploading':
      return 'info';
    case 'review_required':
    case 'queued':
    case 'paused':
      return 'warning';
    case 'failed':
    case 'rejected':
      return 'danger';
    case 'uploaded':
    case 'processing':
    case 'accepted':
      return 'success';
    default:
      return 'neutral';
  }
}

function Toggle(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  note?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <SwitchField
      label={props.label}
      checked={props.checked}
      {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
      {...(props.note !== undefined ? { note: props.note } : {})}
      onCheckedChange={props.onChange}
    />
  );
}

async function loadRecordings(): Promise<RecordingRow[]> {
  const rows = await db.recordings.toArray();
  return rows.sort((left, right) => right.created_at - left.created_at);
}

async function loadLiveSummaries(
  recordings: RecordingRow[]
): Promise<Record<string, TraceSummary>> {
  const entries = await Promise.all(
    recordings
      .filter(shouldUseLiveTraceSummary)
      .map(
        async (recording) =>
          [recording.trace_id, await buildLiveTraceSummary(recording)] as const
      )
  );
  return Object.fromEntries(entries);
}

function shouldPollUploadStatus(recording: RecordingRow): boolean {
  return Boolean(
    recording.upload_id &&
      ['uploading', 'uploaded', 'processing', 'rejected'].includes(recording.status)
  );
}

async function loadMediaRows(traceId: string): Promise<BlobRow[]> {
  const rows = await db.blobs.where('trace_id').equals(traceId).toArray();
  return sortMediaRows(rows);
}

async function loadTimelineItems(
  traceId: string,
  tr: Translator = englishTranslator
): Promise<TimelineItem[]> {
  const events = await db.events.where('trace_id').equals(traceId).toArray();
  events.sort((left, right) => left.timestamp - right.timestamp);
  return buildTimelineItems(events, tr);
}

function useVirtualRows(options: {
  itemCount: number;
  rowHeight: number;
  overscan: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const readHeight = () => setViewportHeight(element.clientHeight);
    readHeight();
    const observer = new ResizeObserver(readHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const totalHeight = options.itemCount * options.rowHeight;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / options.rowHeight) - options.overscan
  );
  const visibleCount =
    Math.ceil(viewportHeight / options.rowHeight) + options.overscan * 2;
  const endIndex = Math.min(options.itemCount, startIndex + visibleCount);
  const items = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    items.push({ index, start: index * options.rowHeight });
  }

  return {
    containerRef,
    totalHeight,
    items,
    onScroll: (event: ReactUIEvent<HTMLDivElement>) =>
      setScrollTop(event.currentTarget.scrollTop),
  };
}

function filterAndSortHistory(
  recordings: RecordingRow[],
  liveSummaries: Record<string, TraceSummary>,
  filters: {
    query: string;
    status: HistoryStatusFilter;
    mode: HistoryModeFilter;
    domain: string;
    quick: HistoryQuickFilter;
    sortKey: HistorySortKey;
    sortDirection: HistorySortDirection;
  }
): RecordingRow[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const rows = recordings.filter((recording) => {
    const summary = traceSummaryForRecording(recording, liveSummaries);
    if (filters.status !== 'all' && recording.status !== filters.status) {
      return false;
    }
    if (
      filters.mode !== 'all' &&
      recording.envelope.recording_mode !== filters.mode
    ) {
      return false;
    }
    if (
      filters.domain !== 'all' &&
      !summary.domains.includes(filters.domain)
    ) {
      return false;
    }
    if (!matchesQuickFilter(recording, summary, filters.quick)) return false;
    if (!normalizedQuery) return true;
    const searchable = [
      recordingLabel(recording),
      recording.trace_id,
      recording.status,
      recording.envelope.recording_mode,
      ...summary.domains,
    ]
      .join(' ')
      .toLowerCase();
    return searchable.includes(normalizedQuery);
  });

  const direction = filters.sortDirection === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const comparison = compareHistoryRows(
      left,
      right,
      liveSummaries,
      filters.sortKey
    );
    return comparison * direction;
  });
}

function compareHistoryRows(
  left: RecordingRow,
  right: RecordingRow,
  liveSummaries: Record<string, TraceSummary>,
  sortKey: HistorySortKey
): number {
  const leftSummary = traceSummaryForRecording(left, liveSummaries);
  const rightSummary = traceSummaryForRecording(right, liveSummaries);
  switch (sortKey) {
    case 'label':
      return recordingLabel(left).localeCompare(recordingLabel(right));
    case 'status':
      return left.status.localeCompare(right.status);
    case 'duration':
      return leftSummary.duration_ms - rightSummary.duration_ms;
    case 'domains':
      return formatDomains(leftSummary.domains).localeCompare(
        formatDomains(rightSummary.domains)
      );
    case 'created':
    default:
      return left.created_at - right.created_at;
  }
}

function matchesQuickFilter(
  recording: RecordingRow,
  _summary: TraceSummary,
  filter: HistoryQuickFilter
): boolean {
  switch (filter) {
    case 'needs_review':
      return recording.status === 'review_required';
    case 'upload_failed':
      return Boolean(
        recording.last_error ||
          recording.status === 'failed' ||
          recording.status === 'rejected'
      );
    case 'all':
    default:
      return true;
  }
}

function traceSummaryForRecording(
  recording: RecordingRow,
  liveSummaries: Record<string, TraceSummary>
): TraceSummary {
  return liveSummaries[recording.trace_id] ?? recording.envelope.summary;
}

function recordingStatuses(): RecordingStatus[] {
  return [
    'draft',
    'review_required',
    'queued',
    'uploading',
    'paused',
    'failed',
    'uploaded',
    'processing',
    'accepted',
    'rejected',
  ];
}

function statusFilterLabel(
  status: RecordingStatus,
  tr: Translator = englishTranslator
): string {
  const labels: Record<RecordingStatus, TranslationKey> = {
    draft: 'statusFilter.draft',
    review_required: 'statusFilter.review_required',
    queued: 'statusFilter.queued',
    uploading: 'statusFilter.uploading',
    paused: 'statusFilter.paused',
    failed: 'statusFilter.failed',
    uploaded: 'statusFilter.uploaded',
    processing: 'statusFilter.processing',
    accepted: 'statusFilter.accepted',
    rejected: 'statusFilter.rejected',
  };
  return tr(labels[status]);
}

function isQueueRelevantRecording(recording: RecordingRow): boolean {
  return (
    Boolean(recording.upload_id || recording.last_error) ||
    ['queued', 'uploading', 'paused', 'failed', 'uploaded', 'processing', 'rejected'].includes(
      recording.status
    )
  );
}

function buildTimelineItems(
  events: CapturedEvent[],
  tr: Translator = englishTranslator
): TimelineItem[] {
  return events
    .filter(isTimelineEvent)
    .slice(0, TIMELINE_MAX_ITEMS)
    .map((event) => timelineItemForEvent(event, tr));
}

function isTimelineEvent(event: CapturedEvent): boolean {
  if (
    event.kind === 'navigation' ||
    event.kind === 'form_summary' ||
    event.kind === 'network_stream' ||
    event.kind === 'download' ||
    event.kind === 'video_chunk'
  ) {
    return true;
  }
  if (event.kind === 'network_request') {
    return event.fetch_kind === 'navigation' || isLikelyUserVisibleRequest(event);
  }
  if (event.kind === 'network_response') {
    return Boolean(event.status && event.status >= 400);
  }
  if (event.kind === 'annotation') {
    return (
      event.annotation_type.startsWith('captcha_') ||
      event.annotation_type.startsWith('video_')
    );
  }
  return false;
}

function timelineItemForEvent(
  event: CapturedEvent,
  tr: Translator = englishTranslator
): TimelineItem {
  switch (event.kind) {
    case 'navigation':
      return {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'navigation',
        title: navigationTitle(event.nav_type, tr),
        detail: event.to_url ?? event.url,
      };
    case 'form_summary':
      return {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'form',
        title: tr('timeline.form', { phase: event.phase }),
        detail: tr('timeline.formDetail', {
          count: event.fields.length,
          selector: event.form_selector
        }),
      };
    case 'network_request':
      return {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'network',
        title: `${event.method} ${event.fetch_kind}`,
        detail: event.full_url,
      };
    case 'network_response':
      return {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'network',
        title: tr('timeline.networkResponse', {
          status: event.status ?? 'response'
        }),
        detail: event.content_type ?? event.request_id,
      };
    case 'network_stream':
      return {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'network',
        title: `${event.stream_type} ${event.phase}`,
        detail: event.full_url,
      };
    case 'download':
      return {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'download',
        title: tr('timeline.download', { phase: event.phase }),
        detail: event.filename_ext
          ? tr('timeline.downloadFile', { extension: event.filename_ext })
          : event.source_url ?? tr('timeline.downloadEvent'),
      };
    case 'video_chunk':
      return {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'media',
        title: tr('timeline.mediaCaptured'),
        detail: tr('timeline.mediaChunk', {
          duration: formatDuration(event.end_timestamp - event.start_timestamp)
        }),
      };
    case 'annotation':
      return {
        id: event.event_id,
        timestamp: event.timestamp,
        category: event.annotation_type.startsWith('video_')
          ? 'media'
          : 'captcha',
        title: annotationTimelineTitle(event.annotation_type, tr),
        detail: event.text ?? event.url,
      };
    default:
      return {
        id: event.event_id,
        timestamp: event.timestamp,
        category: 'navigation',
        title: event.kind,
        detail: event.url,
      };
  }
}

function isLikelyUserVisibleRequest(event: Extract<CapturedEvent, { kind: 'network_request' }>): boolean {
  try {
    const url = new URL(event.full_url);
    return url.pathname.includes('submit') || url.pathname.includes('upload');
  } catch {
    return false;
  }
}

function navigationTitle(
  navType: Extract<CapturedEvent, { kind: 'navigation' }>['nav_type'],
  tr: Translator = englishTranslator
): string {
  switch (navType) {
    case 'pushState':
    case 'replaceState':
    case 'popState':
    case 'hashChange':
      return tr('timeline.route', { navType });
    case 'tabOpened':
      return tr('timeline.tabOpened');
    case 'tabClosed':
      return tr('timeline.tabClosed');
    case 'beforeUnload':
      return tr('timeline.leavingPage');
    case 'load':
    default:
      return tr('timeline.pageLoaded');
  }
}

function annotationTimelineTitle(
  annotationType: Extract<CapturedEvent, { kind: 'annotation' }>['annotation_type'],
  tr: Translator = englishTranslator
): string {
  switch (annotationType) {
    case 'captcha_detected':
      return tr('timeline.captchaDetected');
    case 'captcha_solved':
      return tr('timeline.captchaSolved');
    case 'captcha_blocked':
      return tr('timeline.captchaBlocked');
    case 'video_started':
      return tr('timeline.videoStarted');
    case 'video_stopped':
      return tr('timeline.videoStopped');
    case 'video_failed':
      return tr('timeline.videoFailed');
    case 'video_degraded':
      return tr('timeline.videoDegraded');
    default:
      return annotationType;
  }
}

function viewFromHash(): { view: DashboardView; traceId: string | null } {
  const raw = window.location.hash.replace(/^#/, '');
  if (raw === 'settings') return { view: 'settings', traceId: null };
  if (raw === 'tasks') return { view: 'tasks', traceId: null };
  if (raw.startsWith('review='))
    return {
      view: 'review',
      traceId: decodeURIComponent(raw.slice('review='.length)),
    };
  if (raw === 'review') return { view: 'review', traceId: null };
  return { view: 'history', traceId: null };
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function formatRelativeTime(timestamp: number, startTimestamp: number): string {
  return `+${formatDuration(Math.max(0, timestamp - startTimestamp))}`;
}

function formatDomains(
  domains: string[],
  tr: Translator = englishTranslator
): string {
  return domains.length > 0 ? domains.join(', ') : tr('format.noDomains');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function safeFilename(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SAFE_FILENAME_MAX_CHARS);
}

function downloadJson(filename: string, value: unknown): void {
  downloadText(filename, JSON.stringify(value, null, 2), 'application/json');
}

function downloadText(
  filename: string,
  value: string,
  contentType: string
): void {
  const blob = new Blob([value], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function optionalDescription(
  description: string
): { description: string } | Record<string, never> {
  const trimmed = description.trim();
  return trimmed ? { description: trimmed } : {};
}

function settingsConfigKey(config: ConfigRow): string {
  return JSON.stringify({
    endpoint_url: config.endpoint_url,
    api_key: config.api_key,
    locale: config.locale,
    recording_mode: config.recording_mode,
    realUserConsentAccepted: config.realUserConsentAccepted,
    realUserConsentAcceptedAt: config.realUserConsentAcceptedAt,
    capture: config.capture,
  });
}

function readStoredDashboardRailWidth(): number {
  const stored = Number(localStorage.getItem(DASHBOARD_RAIL_WIDTH_KEY));
  return clampDashboardRailWidth(
    Number.isFinite(stored) && stored > 0
      ? stored
      : DASHBOARD_RAIL_DEFAULT_WIDTH
  );
}

function clampDashboardRailWidth(width: number): number {
  return Math.min(
    DASHBOARD_RAIL_MAX_WIDTH,
    Math.max(DASHBOARD_RAIL_MIN_WIDTH, Math.round(width))
  );
}

function readStoredReviewSplitWidth(): number {
  const stored = Number(localStorage.getItem(REVIEW_SPLIT_WIDTH_KEY));
  return clampReviewSplitWidth(
    Number.isFinite(stored) && stored > 0
      ? stored
      : REVIEW_SPLIT_DEFAULT_WIDTH
  );
}

function clampReviewSplitWidth(width: number): number {
  return Math.min(
    REVIEW_SPLIT_MAX_WIDTH,
    Math.max(REVIEW_SPLIT_MIN_WIDTH, Math.round(width))
  );
}
