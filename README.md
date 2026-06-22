# Journey-Forge Local

Record your own browser tasks → distill each into a reusable **"how to do task X
on site Y"** skill → use it in **Claude Desktop** (and Claude Code). A
single-user, local product. You bring your own LLM API key. Not related to any
benchmark.

```
extension (record free-form task)
   └─► localhost server  :8099   /v1/traces/init → chunks → finalize
          └─ assemble → data/traces/<id>/trace.json  (intent + events)
          └─ background: distiller → SKILL.md → installer
                 ├─ Claude Code:    ~/.claude/skills/<name>/SKILL.md   (auto)
                 └─ Claude Desktop: <name>.zip → upload via Settings → Skills
   /v1/traces/<id>/status  exposes distill_result
```

## Layout

| Path | What |
|---|---|
| `entry/main.py` | Desktop entry — starts the server + opens a pywebview window |
| `app/dist/index.html` | Control panel (zero-build, served by the server) |
| `extension/` | The recorder (product fork: points at localhost, free-form only) |
| `server/server.py` | Local ingestion + control API |
| `distiller/distill.mjs` | One trace → generic operating-guide `SKILL.md` |
| `installer/install-skill.mjs` | Frontmatter + double-track install (Code dir + Desktop `.zip`) |
| `scripts/start.sh` | Headless dev launcher |
| `docs/` | Trace schema + Claude Desktop setup |

## Quick start

1. **Configure & run the server**
   ```bash
   cp config.example.env .env.local      # then set SF_LLM_KEY=sk-ant-...
   ./scripts/start.sh                     # or: python entry/main.py  (native window)
   ```
   The panel is at <http://127.0.0.1:8099/>. The server seeds a default key
   (`jfl-local-dev-key`) the extension ships with, so it connects automatically.

2. **Build & load the extension**
   ```bash
   cd extension && pnpm install && pnpm build
   ```
   Chrome → `chrome://extensions` → enable Developer mode → **Load unpacked** →
   select `extension/dist/chrome-mv3`. It's pre-pointed at the local server.

3. **Record → finalize.** Record a short task with the extension, stop, label,
   upload. With auto-distill on, a skill appears within ~1–3 min:
   - **Claude Code**: already installed under your skills root.
   - **Claude Desktop**: download the `.zip` from the panel (Trajectories) and
     upload it in Settings → Skills. See [`docs/claude-desktop-setup.md`](docs/claude-desktop-setup.md).

4. **(Optional) real browser execution.** Panel → *Browser execution* →
   *Configure Playwright MCP* so Claude Desktop can actually click/type/navigate.
   Restart Claude Desktop after.

## Notes

- **Skills don't grant tools.** A `SKILL.md` is injected instructions. To
  *execute* its steps in a browser you must configure a browser MCP (Playwright)
  separately — the panel automates this for Claude Desktop.
- **LLM:** the distiller speaks the Anthropic Messages API natively (default
  `claude-opus-4-8`). Point `SF_LLM_BASE` at an OpenAI-compatible gateway to use
  that path instead.
- Data lives under `data/` (git-ignored). Nothing leaves your machine except
  the distillation calls to your configured LLM.
