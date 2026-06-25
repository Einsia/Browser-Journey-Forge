"""Minimal stdio MCP server that exposes distilled skills to Claude Desktop.

Why this exists: Claude Desktop has no external API to inject content into a
running chat, and its "Skills" upload is a manual zip. But Desktop *does* speak
MCP (that's how it gets Playwright). So we expose the distilled skills as an MCP
tool. The tool reads the registry + SKILL.md FRESH on every call, so after the
user records → auto-distill writes a new skill, the very next `get_skill` call
returns it — no Claude Desktop restart needed. The only one-time cost is adding
this server to claude_desktop_config.json (folded into Playwright setup).

Protocol: JSON-RPC 2.0 over stdio, newline-delimited (MCP stdio transport).
Pure stdlib so it runs inside the PyInstaller-frozen sidecar.

Tools:
  list_skills()        -> every distilled skill (domain::capability + scope)
  get_skill(query)     -> full SKILL.md best-matching a site domain / url / capability
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "journey-forge-skills", "version": "1.0.0"}


def _state_dir() -> Path:
    # Mirror harness.config: state lives under <JFL_DATA_DIR>/harness. The MCP
    # entry passes JFL_DATA_DIR so we read the same registry the pipeline writes.
    data_dir = os.environ.get("JFL_DATA_DIR")
    if data_dir:
        return Path(data_dir) / "harness"
    return Path(__file__).resolve().parents[1] / "data" / "harness"


def _load_registry() -> list[dict]:
    reg = _state_dir() / "registry.json"
    if not reg.is_file():
        return []
    try:
        return json.loads(reg.read_text()).get("skills", [])
    except (json.JSONDecodeError, OSError):
        return []


def _read_skill_md(entry: dict) -> str:
    p = _state_dir() / entry.get("skill_path", "")
    try:
        return p.read_text()
    except OSError:
        return ""


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _query_domain(query: str) -> str:
    """Pull a registrable-ish host out of a url or bare domain query."""
    q = _norm(query)
    if "://" in q:
        q = urlparse(q).netloc or q
    q = q.split("/")[0]
    if q.startswith("www."):
        q = q[4:]
    return q


def _score(entry: dict, query: str) -> int:
    """How well a registry entry matches a free-text query (higher = better)."""
    q = _norm(query)
    if not q:
        return 0
    qd = _query_domain(query)
    domains = [_norm(d) for d in entry.get("domains", [])]
    cap = _norm(entry.get("capacity_id", ""))
    scope = _norm(entry.get("scope", ""))
    name = _norm(entry.get("skill_name", ""))
    score = 0
    for d in domains:
        if not d:
            continue
        if qd and (qd == d or qd in d or d in qd):
            score += 100
        if q in d or d in q:
            score += 40
    for hay in (cap, scope, name):
        if q and q in hay:
            score += 20
    # token overlap against capability/scope (e.g. "flights" matches "flight search")
    qtokens = {t for t in re.split(r"[^a-z0-9]+", q) if len(t) > 2}
    haytokens = set(re.split(r"[^a-z0-9]+", f"{cap} {scope} {name} {' '.join(domains)}"))
    score += 8 * len(qtokens & haytokens)
    return score


def _skill_summary(entry: dict) -> dict:
    return {
        "capability": entry.get("capacity_id", ""),
        "domains": entry.get("domains", []),
        "scope": entry.get("scope", ""),
        "examples": entry.get("example_count", entry.get("segment_count")),
    }


# ── tools ────────────────────────────────────────────────────────────────────
TOOLS = [
    {
        "name": "get_skill",
        "description": (
            "ALWAYS call this FIRST, before doing any browser/web-automation task, "
            "to load a distilled, site-specific operating procedure for the target "
            "website. Pass the site domain or URL (e.g. 'google.com/travel/flights' "
            "or 'flights') or the capability you need. Returns a SKILL.md the agent "
            "should follow step-by-step. If it returns a skill, follow it; if not, "
            "proceed normally."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Target site domain, full URL, or capability description.",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "list_skills",
        "description": "List every distilled skill currently available (domain + capability + scope).",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def _tool_list_skills() -> str:
    skills = _load_registry()
    if not skills:
        return "No distilled skills available yet. Record a task and let it distill first."
    return json.dumps([_skill_summary(s) for s in skills], ensure_ascii=False, indent=2)


def _tool_get_skill(args: dict) -> str:
    query = args.get("query", "")
    skills = _load_registry()
    if not skills:
        return "No distilled skills available yet."
    ranked = sorted(skills, key=lambda e: _score(e, query), reverse=True)
    best = ranked[0]
    if _score(best, query) <= 0:
        avail = ", ".join(sorted({d for s in skills for d in s.get("domains", [])})) or "(none)"
        return f"No skill matched '{query}'. Available site skills: {avail}."
    md = _read_skill_md(best)
    if not md:
        return f"Matched skill '{best.get('capacity_id')}' but its SKILL.md is missing on disk."
    header = (
        f"# Loaded skill: {best.get('capacity_id')}\n"
        f"# domains: {', '.join(best.get('domains', []))}\n"
        f"# Follow this procedure for the task.\n\n"
    )
    return header + md


def _dispatch_tool(name: str, args: dict) -> str:
    if name == "list_skills":
        return _tool_list_skills()
    if name == "get_skill":
        return _tool_get_skill(args or {})
    raise ValueError(f"unknown tool: {name}")


# ── JSON-RPC plumbing ─────────────────────────────────────────────────────────
def _send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _result(req_id, result: dict) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "result": result})


def _error(req_id, code: int, message: str) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def _handle(req: dict) -> None:
    method = req.get("method")
    req_id = req.get("id")
    # notifications (no id) get no response
    if method == "initialize":
        client_proto = (req.get("params") or {}).get("protocolVersion") or PROTOCOL_VERSION
        _result(req_id, {
            "protocolVersion": client_proto,
            "capabilities": {"tools": {}},
            "serverInfo": SERVER_INFO,
        })
    elif method in ("notifications/initialized", "initialized"):
        return
    elif method == "ping":
        _result(req_id, {})
    elif method == "tools/list":
        _result(req_id, {"tools": TOOLS})
    elif method == "tools/call":
        params = req.get("params") or {}
        try:
            text = _dispatch_tool(params.get("name", ""), params.get("arguments") or {})
            _result(req_id, {"content": [{"type": "text", "text": text}], "isError": False})
        except Exception as e:  # noqa: BLE001 — surface as a tool error, not a crash
            _result(req_id, {"content": [{"type": "text", "text": f"error: {e}"}], "isError": True})
    elif req_id is not None:
        _error(req_id, -32601, f"method not found: {method}")


def serve() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            _handle(req)
        except Exception:  # never die on a single bad message
            pass


if __name__ == "__main__":
    serve()
