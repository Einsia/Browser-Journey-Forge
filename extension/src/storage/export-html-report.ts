import type { CapturedEvent } from '@/shared/types';
import type { ExportedMediaBlob, RecordingExport } from '@/storage/export-recording';

const REQUIRED_SKILL_SIGNAL_KINDS = ['navigation', 'action', 'dom_snapshot', 'form_summary'] as const;
const MAX_TIMELINE_ROWS = 500;
const MAX_DOM_NODES = 80;
const MAX_MEDIA_ITEMS = 60;

export type HtmlReportOptions = {
  requireSkillSignals?: boolean;
};

export function buildRecordingHtmlReport(exported: RecordingExport, options: HtmlReportOptions = {}): string {
  const events = [...exported.events].sort(compareTimestamp);
  const eventCounts = countBy(events, (event) => event.kind);
  const actionCounts = countBy(
    events.filter((event) => event.kind === 'action'),
    (event) => (event.kind === 'action' ? event.action_type : 'unknown')
  );
  const warnings = options.requireSkillSignals ? missingSkillSignalWarnings(eventCounts) : [];
  const recording = exported.recording;
  const envelope = recording.envelope;
  const title = `Journey Forge Trace Report - ${recording.trace_id}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #17202a; background: #f6f7f9; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f6f7f9; }
    header { padding: 24px 28px 16px; border-bottom: 1px solid #dde3eb; background: #fff; }
    main { padding: 20px 28px 32px; }
    h1, h2, h3, p, dl { margin: 0; }
    h1 { font-size: 24px; line-height: 1.2; }
    h2 { margin-bottom: 12px; font-size: 17px; }
    h3 { margin-bottom: 8px; font-size: 14px; }
    section { margin: 0 0 16px; border: 1px solid #dde3eb; border-radius: 8px; padding: 14px; background: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-top: 1px solid #edf0f4; padding: 8px; text-align: left; vertical-align: top; }
    th { color: #627083; font-size: 12px; }
    code, pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 12px; }
    pre { overflow: auto; border-radius: 6px; padding: 10px; background: #101828; color: #eef2f7; }
    .subtle { color: #627083; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
    .metric { border: 1px solid #edf0f4; border-radius: 6px; padding: 10px; background: #fbfcfe; }
    .metric b { display: block; margin-top: 3px; font-size: 17px; }
    .badge { display: inline-block; margin: 2px 4px 2px 0; border-radius: 999px; padding: 2px 8px; background: #eef2f6; color: #405064; font-size: 12px; font-weight: 700; }
    .badge.ok { background: #e9f7ee; color: #1a7f37; }
    .badge.warn { background: #fff4d6; color: #75540d; }
    .badge.info { background: #e9f3ff; color: #155eef; }
    .kv { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 6px 12px; }
    .kv div:nth-child(odd) { color: #627083; }
    .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .media-item { border: 1px solid #edf0f4; border-radius: 6px; padding: 10px; background: #fbfcfe; }
    .media-item img, .media-item video { display: block; width: 100%; max-height: 260px; object-fit: contain; border-radius: 4px; background: #101828; }
    .empty { color: #627083; }
  </style>
</head>
<body>
  <header>
    <h1>Journey Forge Trace Report</h1>
    <p class="subtle">${escapeHtml(recording.trace_id)} - ${escapeHtml(envelope.label ?? 'unlabeled journey')}</p>
    ${warnings.length === 0 ? '<span class="badge ok">skill signals present</span>' : warnings.map((warning) => `<span class="badge warn">${escapeHtml(warning)}</span>`).join('')}
  </header>
  <main>
    <section>
      <h2>Trace Summary</h2>
      <div class="grid">
        ${metric('Status', recording.status)}
        ${metric('Mode', envelope.recording_mode)}
        ${metric('Events', String(events.length))}
        ${metric('Duration', formatDuration(envelope.summary.duration_ms))}
        ${metric('Domains', String(envelope.summary.domains.length))}
        ${metric('Video media', String(exported.media.filter((item) => item.kind === 'video').length))}
        ${metric('Exported', exported.exported_at)}
      </div>
      <div class="kv" style="margin-top:14px">
        <div>Description</div><div>${escapeHtml(envelope.description ?? 'none')}</div>
        <div>Domains</div><div>${renderBadges(envelope.summary.domains)}</div>
        <div>Tags</div><div>${renderBadges(envelope.tags)}</div>
      </div>
    </section>

    <section>
      <h2>Event Counts</h2>
      <div class="grid">
        <div>${renderCountTable('Event Kinds', eventCounts)}</div>
        <div>${renderCountTable('Action Types', actionCounts)}</div>
      </div>
    </section>

    <section>
      <h2>Timeline</h2>
      ${renderTimeline(events)}
    </section>

    <section>
      <h2>Forms</h2>
      ${renderForms(events.filter((event) => event.kind === 'form_summary'))}
    </section>

    <section>
      <h2>DOM Snapshots</h2>
      ${renderSnapshots(events.filter((event) => event.kind === 'dom_snapshot'))}
    </section>

    <section>
      <h2>Media</h2>
      ${renderMedia(exported.media, events)}
    </section>
  </main>
</body>
</html>`;
}

function missingSkillSignalWarnings(eventCounts: Record<string, number>): string[] {
  return REQUIRED_SKILL_SIGNAL_KINDS.filter((kind) => !eventCounts[kind]).map((kind) => `Missing ${kind} events`);
}

function renderTimeline(events: CapturedEvent[]): string {
  if (events.length === 0) return '<p class="empty">No events.</p>';
  const visibleEvents = events.slice(0, MAX_TIMELINE_ROWS);
  return `<table><thead><tr><th>Time</th><th>Kind</th><th>Detail</th><th>URL</th><th>Event ID</th></tr></thead><tbody>${visibleEvents
    .map(
      (event) => `<tr>
        <td><code>${escapeHtml(String(event.timestamp))}</code></td>
        <td><span class="badge">${escapeHtml(event.kind)}</span></td>
        <td>${escapeHtml(describeEvent(event))}</td>
        <td><code>${escapeHtml(shortenUrl(event.url))}</code></td>
        <td><code>${escapeHtml(event.event_id)}</code></td>
      </tr>`
    )
    .join('')}</tbody></table>${events.length > visibleEvents.length ? `<p class="subtle">Showing first ${visibleEvents.length} of ${events.length} events.</p>` : ''}`;
}

function renderForms(forms: CapturedEvent[]): string {
  if (forms.length === 0) return '<p class="empty">No form_summary events found.</p>';
  return forms
    .map((event) => {
      if (event.kind !== 'form_summary') return '';
      return `<div class="metric" style="margin-bottom:10px">
        <h3>${escapeHtml(event.phase)} - <code>${escapeHtml(event.form_selector)}</code></h3>
        <table><thead><tr><th>Name</th><th>Type</th><th>Classes</th><th>Digest</th></tr></thead><tbody>${event.fields
          .map(
            (field) => `<tr>
              <td><code>${escapeHtml(field.name)}</code></td>
              <td>${escapeHtml(field.type)}</td>
              <td>${renderBadges(field.redactionClasses)}</td>
              <td><code>${escapeHtml(field.digest ?? '')}</code></td>
            </tr>`
          )
          .join('')}</tbody></table>
      </div>`;
    })
    .join('');
}

function renderSnapshots(snapshots: CapturedEvent[]): string {
  if (snapshots.length === 0) return '<p class="empty">No dom_snapshot events found.</p>';
  return snapshots
    .map((event) => {
      if (event.kind !== 'dom_snapshot') return '';
      const nodes = event.nodes.slice(0, MAX_DOM_NODES);
      return `<div class="metric" style="margin-bottom:10px">
        <h3>${escapeHtml(event.event_id)} - ${event.nodes.length} nodes</h3>
        <p class="subtle">hash <code>${escapeHtml(event.hash)}</code></p>
        <table><thead><tr><th>Ref</th><th>Element</th><th>Selector</th><th>Text / Value</th></tr></thead><tbody>${nodes
          .map(
            (node) => `<tr>
              <td><code>${escapeHtml(String(node.ref))}</code></td>
              <td>${escapeHtml([node.tag, node.inputType ? `type=${node.inputType}` : '', node.role ? `role=${node.role}` : ''].filter(Boolean).join(' '))}</td>
              <td><code>${escapeHtml(node.selector)}</code></td>
              <td>${renderNodeValue(node)}</td>
            </tr>`
          )
          .join('')}</tbody></table>
      </div>`;
    })
    .join('');
}

function renderMedia(media: ExportedMediaBlob[], events: CapturedEvent[]): string {
  if (media.length === 0) return '<p class="empty">No exported media.</p>';
  const eventByBlob = new Map(events.filter(hasBlobKey).map((event) => [event.blob_key, event]));
  const visibleMedia = media.slice(0, MAX_MEDIA_ITEMS);
  return `<div class="media-grid">${visibleMedia
    .map((blob) => {
      const event = eventByBlob.get(blob.blob_key);
      const preview =
        blob.kind === 'video' && blob.content_type.startsWith('video/') && blob.data_base64
            ? `<video controls src="data:${escapeAttr(blob.content_type)};base64,${escapeAttr(blob.data_base64)}"></video>`
          : blob.kind === 'screenshot' && blob.content_type.startsWith('image/') && blob.data_base64
            ? `<img alt="Legacy screenshot ${escapeAttr(blob.blob_key)}" src="data:${escapeAttr(blob.content_type)};base64,${escapeAttr(blob.data_base64)}">`
            : '<p class="empty">No inline preview available.</p>';
      return `<div class="media-item">${preview}<div class="kv" style="margin-top:8px">
        <div>Blob</div><div><code>${escapeHtml(blob.blob_key)}</code></div>
        <div>Kind</div><div>${escapeHtml(blob.kind)}</div>
        <div>Bytes</div><div>${formatBytes(blob.bytes)}</div>
        <div>Event</div><div><code>${escapeHtml(event?.event_id ?? 'unlinked')}</code></div>
      </div></div>`;
    })
    .join('')}</div>${media.length > visibleMedia.length ? `<p class="subtle">Showing first ${visibleMedia.length} of ${media.length} media blobs.</p>` : ''}`;
}

function renderNodeValue(node: Extract<CapturedEvent, { kind: 'dom_snapshot' }>['nodes'][number]): string {
  const parts: string[] = [];
  if (node.text) parts.push(`text ${renderRedactedValue(node.text)}`);
  if (node.value) parts.push(`value ${renderRedactedValue(node.value)}`);
  if (node.href) parts.push(`<code>${escapeHtml(shortenUrl(node.href))}</code>`);
  return parts.length > 0 ? parts.join('<br>') : '<span class="empty">empty</span>';
}

function renderRedactedValue(value: { value?: unknown; redaction?: { strategy?: string; classes?: string[] } }): string {
  if (value.redaction) {
    return `<span class="badge ok">${escapeHtml(value.redaction.strategy ?? 'redacted')}</span>${renderBadges(value.redaction.classes ?? [])}`;
  }
  if (value.value === null || value.value === undefined) return '<span class="empty">empty</span>';
  return escapeHtml(String(value.value));
}

function describeEvent(event: CapturedEvent): string {
  switch (event.kind) {
    case 'navigation':
      return `${event.nav_type}${event.to_url ? ` ${shortenUrl(event.to_url)}` : ''}`;
    case 'action':
      return `${event.action_type}${event.target?.selector ? ` on ${event.target.selector}` : ''}`;
    case 'dom_snapshot':
      return `${event.nodes.length} nodes`;
    case 'dom_mutation_summary':
      return `${event.signals.join(', ') || 'mutation'} (+${event.added_nodes}/-${event.removed_nodes})`;
    case 'network_request':
      return `${event.method} ${shortenUrl(event.full_url)}`;
    case 'network_response':
      return `response ${event.status ?? 'unknown'} ${event.content_type ?? ''}`;
    case 'network_stream':
      return `${event.stream_type} ${event.phase} ${event.direction ?? ''} ${event.byte_count ?? 0} bytes`;
    case 'download':
      return `download ${event.phase} ${event.filename_ext ?? ''}`;
    case 'screenshot':
      return `legacy screenshot ${event.width ?? '?'}x${event.height ?? '?'} ${event.blob_key}`;
    case 'video_chunk':
      return `video ${event.start_timestamp}-${event.end_timestamp} ${event.blob_key}`;
    case 'form_summary':
      return `${event.phase} ${event.form_selector} (${event.fields.length} fields)`;
    case 'annotation':
      return `${event.annotation_type} ${event.text ?? ''}`;
  }
}

function hasBlobKey(event: CapturedEvent): event is Extract<CapturedEvent, { blob_key: string }> {
  return 'blob_key' in event;
}

function renderCountTable(title: string, counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return `<h3>${escapeHtml(title)}</h3><p class="empty">No events.</p>`;
  return `<h3>${escapeHtml(title)}</h3><table><thead><tr><th>Name</th><th>Count</th></tr></thead><tbody>${entries
    .map(([name, count]) => `<tr><td><code>${escapeHtml(name)}</code></td><td>${count}</td></tr>`)
    .join('')}</tbody></table>`;
}

function renderBadges(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `<span class="badge info">${escapeHtml(value)}</span>`).join('') : '<span class="empty">none</span>';
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span class="subtle">${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function countBy<T>(values: T[], getKey: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = getKey(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function compareTimestamp(left: CapturedEvent, right: CapturedEvent): number {
  return left.timestamp - right.timestamp || left.event_id.localeCompare(right.event_id);
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value)) return 'unknown';
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = Math.round(value / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return 'unknown';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function shortenUrl(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 84)}...${value.slice(-28)}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: unknown): string {
  return String(value ?? '').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '').replaceAll('>', '');
}
