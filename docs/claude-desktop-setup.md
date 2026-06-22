# Using distilled skills in Claude Desktop

A distilled `SKILL.md` is a **generic operating guide** ("how to do task X on
site Y"), written as durable UI landmarks rather than brittle selectors. It can
be **read** as guidance, or **executed** step-by-step when a browser-control MCP
is configured. Two things to set up.

## 1. Install the skill (manual upload — Desktop has no local skills folder)

Unlike Claude Code (which auto-reads `~/.claude/skills/<name>/SKILL.md`), the
Claude Desktop app does **not** watch a local folder. Skills must be uploaded:

1. In the control panel → **Trajectories**, click **Desktop .zip** to download
   `<name>.zip` (the skill packaged for upload).
2. Open **Claude Desktop → Settings → Skills** (a.k.a. Customize → Skills).
3. **Create skill / upload** and select the `.zip`.

> Claude Code users get this automatically: the installer also writes
> `~/.claude/skills/<name>/SKILL.md` (or your chosen project path), which Claude
> Code discovers with zero steps.

## 2. Give Claude Desktop a browser (Playwright MCP)

A skill grants **no tools** by itself — it is injected instructions. For Claude
Desktop to really click/type/navigate, add the Playwright MCP server. The
control panel → **Browser execution** → **Configure Playwright MCP
automatically** does this for you (it backs up your existing config first).

Manual equivalent — edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

**Restart Claude Desktop** after changing the config. Then a distilled skill's
steps are actually executed in a real browser. Without an MCP browser, the skill
is still useful — Claude reads it as guidance.
