# Claude Code → OTel → Elasticsearch — Admin Rollout Guide

Pragmatic guide for rolling Claude Code telemetry out to a team plan. Written
after building this demo end-to-end. The 7 concepts at the top are a recap; the
checklist at the bottom is what to actually do.

---

## The 7 concepts in one screen

```
1. OTLP            — the wire format Claude Code speaks to localhost:4317
2. Collector       — receivers → processors → exporters; the middleman
3. ES exporter     — mapping.mode: otel keeps OTel field paths intact
4. Data streams    — Document → Index → Data stream → backing .ds-…-NNN
5. Mapping         — text vs keyword, .keyword multi-field, dynamic mapping
6. Index templates — composed_of component templates; routing's last gate
7. Kibana / KQL    — data view + time picker + field paths
```

Each one corresponds to a real bug we hit and fixed during the demo.

---

## What lives where (so you can predict routing)

```
App layer        — service.name, data_stream.dataset
                   (Claude Code: service.name="claude-code" hardcoded;
                    data_stream.* stripped from OTEL_RESOURCE_ATTRIBUTES)

Collector layer  — resource processor enrichment
                   (where you set data_stream.namespace per environment,
                    or transform-tag based on service.name)

ES exporter      — assembles  <type>-<dataset>.otel-<namespace>
                   from resource attributes; falls back to "generic"/"default"

ES               — index template matches the name, creates the data stream
                   and the .ds-…-000001 backing index using the matched
                   mapping/setting.

Kibana           — data view wildcard matches across all backing indices.
```

---

## Hard rules (the ones we discovered the hard way)

1. **Two attribute layers, NEVER conflate**
   - `resource.attributes.*` = per-process facts (service.name, host.name)
   - `attributes.*` = per-record facts (user.email, session.id, tool_name)
   - 90% of "KQL returns 0" is this.

2. **Claude Code strips `data_stream.*` from `OTEL_RESOURCE_ATTRIBUTES`**
   - You cannot rebrand routing from the app side.
   - Other attrs (`team.id`, `app.id`, anything not in `data_stream.*`) pass through fine.

3. **`service.name` is hardcoded to `"claude-code"`**
   - Trustworthy for conditional transforms in the collector.

4. **OTel ES exporter version matters a lot**
   - v0.119 only routes metrics via `data_stream.dataset`; logs/traces stay `generic`.
   - v0.135+ routes all three consistently. **Upgrade is the fix.**

5. **Vanilla ES has no `traces-*-*` catch-all template**
   - Built-in `traces-otel@template` only matches `traces-*.otel-*`.
   - Either route to `*.otel-*` (the right way) or add a custom template (last resort).

6. **Mapping changes affect FUTURE backing indices only**
   - To apply now: `POST <data_stream>/_rollover`.

---

## Admin rollout checklist

### Phase 1 — receive signals (required)

- [ ] Identify the collector endpoint to ship to (edge or gateway).
- [ ] Push these env vars to every user:
      ```
      CLAUDE_CODE_ENABLE_TELEMETRY=1
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
      OTEL_METRICS_EXPORTER=otlp
      OTEL_LOGS_EXPORTER=otlp
      OTEL_TRACES_EXPORTER=otlp
      OTEL_EXPORTER_OTLP_PROTOCOL=grpc
      OTEL_EXPORTER_OTLP_ENDPOINT=<your collector>
      OTEL_RESOURCE_ATTRIBUTES=service.namespace=<org>,deployment.environment=<env>
      ```
- [ ] Privacy decision (legal/compliance review before turning on):
      `OTEL_LOG_USER_PROMPTS=1`, `OTEL_LOG_TOOL_DETAILS=1`.
- [ ] Verify a test user's signals appear in ES:
      `curl localhost:9200/_cat/indices/logs-*,metrics-*,traces-*?v`

### Phase 2 — make signals useful

- [ ] **(Optional)** Edge `transform` processor to brand `data_stream.dataset`
      (only when `service.name == "claude-code"`) — keeps Claude Code data in
      its own data stream instead of shared `*-generic.otel-default`.
- [ ] Kibana **saved searches**:
      - "Token usage by user"
      - "Recent api_request failures"
      - "Slow interactions (>30s)"
- [ ] Kibana **dashboard**: cost / token / sessions / lines_of_code
      (the demo's `es-stack/kibana/claude-code-dashboard.ndjson` is a starting point).
- [ ] Confirm built-in OTel templates are present:
      `GET _index_template/metrics-otel@template` etc. → 200.

### Phase 3 — advanced

- [ ] Add **Jaeger** for the single-trace waterfall view
      (add an `otlp/jaeger` exporter to the gateway; no app changes).
- [ ] **Alerting**: cost spike alert on `metrics.claude_code.cost.usage`.
- [ ] Document where the **local JSONL** lives for forensic deep-dives:
      `~/.claude/projects/<safe-cwd>/<session-id>.jsonl`
      (richer than OTel — includes `ephemeral_5m` vs `ephemeral_1h` cache
      breakdown, retry iterations, full tool I/O).

---

## KQL cheat sheet for admins

```kql
# usage per user (last 30d)
attributes.user.email : "alice@company.com"

# everything from one CLI session (works in logs / metrics / traces)
attributes.session.id : "<uuid>"

# all prompts in plain text (only if OTEL_LOG_USER_PROMPTS=1)
name : "claude_code.interaction"
→ add column attributes.user_prompt

# failed API calls
event_name : "api_error"

# slowest tool calls
name : "claude_code.tool" and attributes.duration_ms > 1000
→ sort attributes.duration_ms desc

# top tool by user
name : "claude_code.tool"
→ split by attributes.user.email, attributes.tool_name

# token cost trend per model
_exists_ : metrics.claude_code.token.usage
→ split by attributes.model, attributes.type
```

---

## Sanity check: data stream name → who is responsible

```
       logs   -   <dataset>   .otel   -   <namespace>
        │           │            │              │
        │           │            │              └─ Collector resource processor
        │           │            │                 (or per-host .env in arceus-style edge)
        │           │            └─ ES exporter (OTel mode) — automatic
        │           └─ App (data_stream.dataset attr) OR collector transform
        │              OR exporter fallback "generic"
        └─ Signal type — automatic from SDK
```

If a stream name is unexpected, walk that line right-to-left and find the layer
that set the wrong value.

---

## Where to look when something's off

| Symptom | First place to check |
|---|---|
| No data in ES | Collector `docker logs` — receiver running? exporter rejecting? |
| `index_not_found_exception` for traces | Built-in template matches `*.otel-*` — does your dataset have `.otel`? |
| KQL returns 0 | (1) Data view, (2) Time picker, (3) field path layer |
| Field type wrong, can't aggregate | Mapping is frozen on this backing index — needs rollover |
| User attribution missing | Resource vs record layer — `attributes.user.email` is on record, not resource |

---

*Built from the `claude-otel` demo: docker-compose ES + Kibana + OTel Collector
that mirrors the company edge/gateway architecture.*
