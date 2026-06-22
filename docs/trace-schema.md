# Trace Schema Draft

Schema version: `journey_trace_v1`

## Envelope

```json
{
  "schema_version": "journey_trace_v1",
  "trace_id": "tr_...",
  "recording_mode": "research_free_form",
  "started_at": "...",
  "ended_at": "...",
  "label": "...",
  "description": "...",
  "tags": [],
  "identity_bundle_id": "idb_...",
  "browser": {},
  "summary": {},
  "events": []
}
```

## Event Base

All events include:

```json
{
  "event_id": "ev_...",
  "trace_id": "tr_...",
  "tab_id": 1,
  "timestamp": 0,
  "url": "https://example.com",
  "kind": "action"
}
```

## Event Kinds

- `navigation`
- `action`
- `dom_snapshot`
- `dom_mutation_summary`
- `network_request`
- `network_response`
- `network_stream`
- `download`
- `screenshot`
- `video_chunk`
- `form_summary`
- `annotation`

## High-Signal Interaction Events

`action` events include user-facing browser task markers:

- direct actions: `click`, `dblclick`, `input`, `change`, `submit`, `keydown`,
  `scroll`, `drag`, `drop`
- interaction markers: `focus`, `blur`, `contextmenu`, `wheel`, `copy`, `cut`
- skill-distillation metadata: `selection` with selected length only, and
  `file_select` with file count, total bytes, accepted types, and MIME types

Raw clipboard contents, raw selected text, file bytes, and raw filenames are not
captured by default.

## DOM Mutation Summaries

`dom_mutation_summary` events batch important UI state changes without storing a
full mutation log:

```json
{
  "kind": "dom_mutation_summary",
  "added_nodes": 2,
  "removed_nodes": 0,
  "attribute_changes": 1,
  "signals": ["modal_added", "status_added", "form_control_enabled"],
  "selectors": ["[role=\"dialog\"]"],
  "text_samples": {
    "value": null,
    "redaction": { "strategy": "raw_removed", "classes": ["classified_token"] }
  }
}
```

## Realtime Network Metadata

`network_stream` events describe WebSocket and EventSource lifecycle metadata
without payloads:

```json
{
  "kind": "network_stream",
  "stream_type": "websocket",
  "phase": "message",
  "stream_id": "ws_...",
  "full_url": "wss://example.com/socket",
  "direction": "incoming",
  "byte_count": 128
}
```

## Download Metadata

`download` events capture browser download lifecycle metadata only:

```json
{
  "kind": "download",
  "download_id": 42,
  "phase": "created",
  "source_url": "https://example.com/report.pdf",
  "mime": "application/pdf",
  "total_bytes": 12345,
  "filename_ext": "pdf"
}
```

Local download paths and raw filenames are not stored.

## Redaction Metadata

Any field that is removed or transformed before upload should carry metadata:

```json
{
  "value": null,
  "redaction": {
    "strategy": "raw_removed",
    "classes": ["classified_password"],
    "digest": "sha256:..."
  }
}
```

Redaction strategies:

- `raw_removed`
- `hashed`
- `classified`
- `truncated`
- `media_excluded`
- `body_excluded`
