#!/usr/bin/env node
// distiller/distill.mjs
//
// Journey-Forge Local distiller. Forked from the research harness'
// one-to-one/distill.mjs, with ALL ClawBench scoring concepts removed
// (no eval_schema, no intercept/terminal-request shape, no benchmark task
// corpus, no judge hints). The product distiller turns ONE recorded browser
// trajectory into a generic, reusable "how to do task X on site Y" operating
// guide that Claude Code can read — and, when a browser MCP (e.g. Playwright)
// is configured, actually execute.
//
// Interface (fixed by server/server.py):
//   node distill.mjs --track <track.json> --out <dir> \
//        --model <id> --llm-base <url> --llm-key <key>
//   → writes <dir>/SKILL.md  (raw markdown, no frontmatter — the installer
//     wraps it with frontmatter before installing into the skills root)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── arg parsing ──────────────────────────────────────────────────────────────
const args = (() => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
})();

const TRACK = args.track ? resolve(args.track) : null;
const OUT_DIR = args.out ? resolve(args.out) : null;
const MODEL = args.model || process.env.SF_DISTILL_MODEL || 'claude-opus-4-8';
const LLM_BASE = (args['llm-base'] || process.env.SF_LLM_BASE || 'https://api.anthropic.com').replace(/\/+$/, '');
const LLM_KEY = args['llm-key'] || process.env.SF_LLM_KEY || '';
const MAX_TOKENS = Number(args['max-tokens'] || 16000);
const LLM_TIMEOUT_MS = Number(args['llm-timeout-ms'] || 240000);
const EVENT_LINES = Number(args['event-lines'] || 220);

if (!TRACK || !OUT_DIR) {
  console.error('[distill] need --track <file> and --out <dir>');
  process.exit(2);
}
if (!existsSync(TRACK)) {
  console.error(`[distill] track not found: ${TRACK}`);
  process.exit(2);
}
if (!LLM_KEY) {
  console.error('[distill] need --llm-key or SF_LLM_KEY');
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });

// ── helpers (ported & cleaned from the research distiller) ────────────────────
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Generic PII scrub. No ClawBench-specific (@clawbench.cc) patterns: this is a
// consumer product, so we redact the user's own secrets out of the guide and
// tell the model to treat them as runtime inputs instead of literals.
function redact(text) {
  return String(text ?? '')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '<your-email>')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '<your-payment-card>')
    .replace(/\b\d{3,4}\b(?=\s*(?:cvv|cvc|security))/gi, '<your-cvc>')
    .replace(/\b\d{6}\b/g, '<verification-code>')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostPath(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 100) path = `${path.slice(0, 96)}...`;
    return `${u.host.replace(/^www\./, '')}${path}`;
  } catch {
    return String(url || '').slice(0, 120);
  }
}

function labelOf(e) {
  const t = e?.target || {};
  return redact(
    t.textContent || t.ariaLabel || t['aria-label'] || t.placeholder ||
      t.name || t.id || t.tagName || e.type || '',
  ).slice(0, 180);
}

function valueOf(e) {
  const label = labelOf(e).toLowerCase();
  let v = e?.value == null ? '' : String(e.value);
  if (/password|passwd|passcode/.test(label)) v = '<your-password>';
  if (/email|mail/.test(label)) v = '<your-email>';
  return redact(v).slice(0, 220);
}

// Collapse the raw event stream into a compact, human-readable transcript of
// the navigation + interactions, de-duplicating runs of identical actions.
function summarizeEvents(events, { maxLines = 220 } = {}) {
  const keep = [];
  let lastKey = '';
  let repeat = 0;
  const flushRepeat = () => {
    if (repeat > 1 && keep.length) keep[keep.length - 1] += ` x${repeat}`;
    repeat = 0;
  };
  for (const e of events || []) {
    if (!['pageLoad', 'navigation', 'click', 'input', 'change', 'submit', 'keydown', 'scroll'].includes(e.type)) continue;
    const path = hostPath(e.url);
    const label = labelOf(e);
    const val = valueOf(e);
    let text = '';
    if (e.type === 'pageLoad' || e.type === 'navigation') text = `${e.type.padEnd(10)} ${path}`;
    else if (e.type === 'input' || e.type === 'change') text = `${e.type.padEnd(10)} ${path} :: ${label}${val ? ` = "${val}"` : ''}`;
    else if (e.type === 'click') text = `${e.type.padEnd(10)} ${path} :: ${label}`;
    else if (e.type === 'keydown') text = `${e.type.padEnd(10)} ${path} :: ${label} key=${e.key || ''}`;
    else if (e.type === 'submit') text = `${e.type.padEnd(10)} ${path} :: ${label}`;
    else text = `${e.type.padEnd(10)} ${path}`;
    const key = text.replace(/ = ".+?"$/, '');
    if (key === lastKey) { repeat++; continue; }
    flushRepeat();
    keep.push(text);
    lastKey = key;
    repeat = 1;
  }
  flushRepeat();
  if (keep.length <= maxLines) return keep.join('\n');
  const headCount = Math.floor(maxLines * 0.4);
  return [
    ...keep.slice(0, headCount),
    `... omitted ${keep.length - maxLines} middle events ...`,
    ...keep.slice(-(maxLines - headCount)),
  ].join('\n');
}

// ── LLM call (Anthropic Messages API native, OpenAI-compatible fallback) ──────
const IS_ANTHROPIC = /(^|\.)anthropic\.com/i.test((() => {
  try { return new URL(LLM_BASE).host; } catch { return LLM_BASE; }
})());

async function callLLM(prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`LLM timeout after ${LLM_TIMEOUT_MS}ms`)), LLM_TIMEOUT_MS);
  try {
    return IS_ANTHROPIC ? await callAnthropic(prompt, ctrl.signal) : await callOpenAI(prompt, ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Anthropic Messages API: POST /v1/messages, x-api-key + anthropic-version
// headers, streamed SSE. Differs from OpenAI: path is /v1/messages (not
// /v1/chat/completions), auth is x-api-key (not Authorization: Bearer), and the
// stream emits typed events (content_block_delta → delta.text_delta.text)
// rather than choices[].delta.content. Opus 4.x uses adaptive thinking and
// rejects temperature/top_p/budget_tokens.
async function callAnthropic(prompt, signal) {
  const isOpus4x = /claude-(opus|sonnet|fable)-4|claude-fable-5|claude-opus-4-8/i.test(MODEL);
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  };
  if (isOpus4x) body.thinking = { type: 'adaptive' };
  const res = await fetch(`${LLM_BASE}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': LLM_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  return await readSSE(res, (evt) => {
    if (evt.type === 'error') throw new Error(`LLM stream error: ${JSON.stringify(evt.error)}`);
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') return evt.delta.text || '';
    return '';
  });
}

// OpenAI-compatible gateway fallback (for users who point --llm-base at a proxy).
async function callOpenAI(prompt, signal) {
  const res = await fetch(`${LLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  return await readSSE(res, (evt) => {
    if (evt.error) throw new Error(`LLM stream error: ${JSON.stringify(evt.error)}`);
    return (evt.choices || []).map((c) => c.delta?.content || '').join('');
  });
}

// Shared SSE reader: `extract` maps one parsed data-line object → text chunk.
async function readSSE(res, extract) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let out = '';
  let chars = 0;
  process.stderr.write('[distill] stream: connected\n');
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(data); } catch { continue; }
      const chunk = extract(evt) || '';
      if (chunk) {
        out += chunk;
        chars += chunk.length;
        if (chars % 800 < chunk.length) process.stderr.write('.');
      }
    }
  }
  process.stderr.write(`\n[distill] stream: finished (${chars} chars)\n`);
  return out.trim();
}

// ── prompt (product: generic browser operating guide, no benchmark voice) ─────
function buildPrompt(track, transcript) {
  const intent = (track.task_instruction || track.label || '').trim();
  const domain = track.domain || '';
  const navChain = Array.isArray(track.navigation_chain) ? track.navigation_chain : [];

  return `You are writing a reusable, agent-facing "how-to" skill from ONE recorded
browser session. The recording is a person completing a real task on a website.
Your job: distill WHY/HOW they did it into a concise operating guide that another
agent (Claude Code) can follow on a live site later.

This guide may be read as advice, OR executed step-by-step by a browser-control
tool (e.g. Playwright MCP: browser_navigate / browser_click / browser_type).
So write steps as durable UI landmarks ("click the button labeled 'Sign in'",
"type into the field labeled 'Email'"), NEVER as brittle CSS/XPath selectors,
pixel coordinates, or replayed DOM ids — those change between runs.

Hard rules:
- Output ONLY GitHub-flavored Markdown for the skill body. No JSON, no code
  fences around the whole thing, no preamble like "Here is the skill".
- The guide is GENERAL: it teaches how to accomplish this KIND of task on this
  site, not how to replay this one recording. Abstract the specific example
  item/person/value the user happened to pick into "the item you want" unless
  the value is intrinsic to the task.
- Treat any concrete email, password, card number, code, name, or address from
  the recording as a RUNTIME INPUT the user must supply — list them under
  "Inputs you must provide", never hardcode them.
- Be operational and concise. Prefer stable visible labels and page-state cues
  over trivia. Describe recovery when a step can fail.
- Do NOT mention network interception, request bodies, eval schemas, terminal
  requests, benchmarks, or "firing an endpoint". Completion is judged by what a
  human sees: a confirmation page, a created/visible object, a submitted form, a
  sent message, a checkout/payment attempt, etc.

Use EXACTLY this structure (start with the H1):

# <Short imperative title of the task>

## Goal
<One or two sentences: what this skill accomplishes, on which site.>

## Entry point
<The starting URL or how to get there.>

## Step-by-step
1. <UI-landmark step>
2. ...
<Keep steps in order; note any decision points ("if X appears, do Y").>

## Inputs you must provide
- <each runtime value the agent/user must supply, e.g. login, the target item, dates>

## How to tell it's done
- <observable success signals on the page>

## Common dead-ends & recovery
- <a near-miss state that looks done but isn't, or a likely failure + how to recover>

---

## Recorded task intent
${intent || '(no explicit intent was recorded; infer it from the trajectory)'}

## Primary site
${domain || '(infer from the trajectory)'}

## Navigation path (registrable domains, in order)
${navChain.length ? navChain.join(' → ') : '(single site)'}

## Recorded session transcript (navigation + interactions)
\`\`\`
${transcript}
\`\`\`
`;
}

// ── normalize: strip any stray interception/benchmark phrasing the model emits ─
function normalizeSkillMd(md) {
  let out = String(md || '').trim();
  // drop accidental wrapping fences
  out = out.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // remove any leaked benchmark/intercept lines (belt-and-suspenders)
  out = out
    .split('\n')
    .filter((line) => !/interceptor|eval[_ ]?schema|terminal request|clawbench|fires? (the )?endpoint/i.test(line))
    .join('\n')
    .trim();
  return `${out}\n`;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const track = readJson(TRACK);
  const transcript = summarizeEvents(track.events || [], { maxLines: EVENT_LINES });
  const prompt = buildPrompt(track, transcript);
  writeFileSync(resolve(OUT_DIR, 'prompt.txt'), prompt);

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await callLLM(prompt);
      writeFileSync(resolve(OUT_DIR, 'raw-model-output.md'), raw);
      const md = normalizeSkillMd(raw);
      if (!/^#\s/m.test(md) || md.length < 80) {
        throw new Error('model output does not look like a SKILL.md (no H1 / too short)');
      }
      writeFileSync(resolve(OUT_DIR, 'SKILL.md'), md);
      writeFileSync(resolve(OUT_DIR, 'meta.json'), `${JSON.stringify({
        upload_id: track.upload_id,
        trace_id: track.trace_id,
        label: track.label || '',
        domain: track.domain || '',
        generated_by: MODEL,
        llm_base: LLM_BASE,
        generator: 'journey-forge-local/distill.mjs',
      }, null, 2)}\n`);
      console.error(`[distill] wrote ${resolve(OUT_DIR, 'SKILL.md')}`);
      return;
    } catch (err) {
      lastErr = err;
      console.error(`[distill] attempt ${attempt} failed: ${err.message}`);
    }
  }
  console.error(`[distill] giving up: ${lastErr?.message}`);
  process.exit(1);
}

main();
