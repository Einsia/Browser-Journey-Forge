#!/usr/bin/env node
// installer/install-skill.mjs
//
// Wrap a distilled SKILL.md with the YAML frontmatter Claude requires, then
// install it for BOTH targets (double-track):
//
//   1. Claude Code (CLI) — write <skills-root>/<name>/SKILL.md. Claude Code
//      auto-discovers this on the filesystem: zero-friction, fully automatic.
//   2. Claude Desktop (app) — Desktop has NO local skills folder; skills must
//      be uploaded as a .zip via Settings > Skills. So we also emit
//      <library-dir>/<name>.zip (SKILL.md at the archive root) for the user to
//      upload. The panel surfaces this file + opens the Skills settings page.
//
// Frontmatter required by Claude (Code + Desktop share the same schema):
//   ---
//   name: <kebab, [a-z0-9-], <=64 chars, no "anthropic"/"claude">
//   description: <one line, <=1024 chars — what it does / when to use it>
//   ---
//
// Interface (called from server/server.py):
//   node install-skill.mjs --skill <SKILL.md> --skills-root <dir> [--name <n>]
//   stdout:
//     ZIP <abs path to the Desktop upload .zip>
//     <abs path to the installed Code SKILL.md>   <- LAST line (server reads it)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { basename, dirname, join, resolve } from 'node:path';

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

const SKILL = args.skill ? resolve(args.skill) : null;
const SKILLS_ROOT = args['skills-root'] ? resolve(args['skills-root']) : null;
const NAME_OVERRIDE = typeof args.name === 'string' ? args.name : null;

if (!SKILL || !SKILLS_ROOT) {
  console.error('[install] need --skill <SKILL.md> and --skills-root <dir>');
  process.exit(2);
}
if (!existsSync(SKILL)) {
  console.error(`[install] skill file not found: ${SKILL}`);
  process.exit(2);
}

const body = readFileSync(SKILL, 'utf8');
const hasFrontmatter = /^\s*---\s*\n/.test(body);

// ── name / description derivation ─────────────────────────────────────────────
function kebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(anthropic|claude)\b/g, '')   // reserved words not allowed in name
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

function deriveTitle(md) {
  const h1 = md.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  const metaPath = join(dirname(SKILL), 'meta.json');
  if (existsSync(metaPath)) {
    try {
      const label = JSON.parse(readFileSync(metaPath, 'utf8')).label;
      if (label) return String(label).trim();
    } catch { /* ignore */ }
  }
  return basename(dirname(SKILL));
}

function deriveDescription(md, title) {
  const m = md.match(/^##\s+Goal\s*\n+([^\n]+)/im);
  let desc = m ? m[1].trim() : title;
  desc = desc.replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
  if (desc.length > 1024) desc = `${desc.slice(0, 1021)}...`;
  return desc || title;
}

function yamlEscape(s) {
  if (/^[\w][\w .,/()'-]*$/.test(s)) return s;
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

let name;
let wrapped;
if (hasFrontmatter) {
  const fm = body.match(/^\s*---\s*\n([\s\S]*?)\n---/);
  const nameLine = fm && fm[1].match(/^name:\s*(.+)$/m);
  name = kebab(NAME_OVERRIDE || (nameLine ? nameLine[1].replace(/['"]/g, '') : deriveTitle(body)));
  wrapped = body;
} else {
  const title = deriveTitle(body);
  name = kebab(NAME_OVERRIDE || title) || 'browser-task';
  const description = deriveDescription(body, title);
  wrapped = `---\nname: ${yamlEscape(name)}\ndescription: ${yamlEscape(description)}\n---\n\n${body.trim()}\n`;
}
if (!name) {
  console.error('[install] could not derive a skill name');
  process.exit(1);
}

// ── 1. Claude Code install: <skills-root>/<name>/SKILL.md ──────────────────────
const destDir = join(SKILLS_ROOT, name);
mkdirSync(destDir, { recursive: true });
const dest = join(destDir, 'SKILL.md');
writeFileSync(dest, wrapped, 'utf8');
console.error(`[install] Claude Code: installed "${name}" → ${dest}`);

// ── 2. Claude Desktop upload bundle: <library-dir>/<name>.zip ──────────────────
// Desktop has no watched folder; the user uploads this zip via Settings>Skills.
const zipPath = join(dirname(SKILL), `${name}.zip`);
try {
  writeFileSync(zipPath, buildZip([{ name: 'SKILL.md', data: Buffer.from(wrapped, 'utf8') }]));
  console.error(`[install] Claude Desktop: upload bundle → ${zipPath}`);
  console.log(`ZIP ${zipPath}`);
} catch (e) {
  console.error(`[install] WARN: could not build Desktop zip: ${e.message}`);
}

// LAST line = the Claude Code installed path (server reads stdout.splitlines()[-1]).
console.log(dest);

// ── minimal dependency-free ZIP writer (deflate) ──────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name: fname, data } of entries) {
    const nameBuf = Buffer.from(fname, 'utf8');
    const crc = crc32(data);
    const comp = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // method: deflate
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0x21, 12);        // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra len
    chunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);      // central dir signature
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0, 8);              // flags
    cd.writeUInt16LE(8, 10);             // method
    cd.writeUInt16LE(0, 12);             // mod time
    cd.writeUInt16LE(0x21, 14);          // mod date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);             // extra
    cd.writeUInt16LE(0, 32);             // comment
    cd.writeUInt16LE(0, 34);             // disk
    cd.writeUInt16LE(0, 36);             // internal attrs
    cd.writeUInt32LE(0, 38);             // external attrs
    cd.writeUInt32LE(offset, 42);        // local header offset
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const localBuf = Buffer.concat(chunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central dir signature
  end.writeUInt16LE(0, 4);                // disk
  end.writeUInt16LE(0, 6);                // disk with cd
  end.writeUInt16LE(entries.length, 8);   // entries on disk
  end.writeUInt16LE(entries.length, 10);  // total entries
  end.writeUInt32LE(cdBuf.length, 12);    // cd size
  end.writeUInt32LE(localBuf.length, 16); // cd offset
  end.writeUInt16LE(0, 20);               // comment len
  return Buffer.concat([localBuf, cdBuf, end]);
}
