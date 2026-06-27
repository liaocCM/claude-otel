# claude-otel — repo context for future Claude sessions

A working demo of Claude Code → OpenTelemetry → (ES + Kibana + Jaeger) **and** an
alternative Grafana LGTM stack, built to teach the OTel routing chain and to test
admin rollout patterns. **Single-node, security disabled — demo only, never production.**

> **Note on file growth**: keep this file under ~200 lines. If it bloats, move
> deep dives into `.claude/rules/<topic>.md` and link from here — the index
> stays small, details stay one click away.

## Architecture (two stacks, side by side)

```
                                           ┌─▶ Elasticsearch ──▶ Kibana          (aggregates)
Claude Code (CLI) ──OTLP gRPC :4317──▶ OTel │      :9200             :5601
                                       Coll │
                                            └─▶ Jaeger (all-in-one) ──▶ Jaeger UI (single trace)
                                                                            :16686

                  ┌─▶ Tempo       (traces)  ─┐
Claude Code ──:14317──▶ OTel Coll ─┼─▶ Loki        (logs)    ─┼─▶ Grafana :13000
                  └─▶ Prometheus  (metrics) ─┘
```

- **ES stack** (`es-stack/docker-compose.yml`): Collector fans **traces** to both ES
  (cross-trace aggregates) and Jaeger (per-trace waterfall, Kibana doesn't render
  well). Logs/metrics → ES only.
- **Grafana stack** (`grafana-stack/docker-compose.yml`): traces → Tempo, logs →
  Loki, metrics → Prometheus, single UI in Grafana. Separate ports so both can
  run at once.
- Mirrors a two-tier production setup (edge → gateway) by collapsing both into
  one local collector. The same routing logic applies.

## File layout (load-bearing files only)

| Path | Purpose |
|---|---|
| `es-stack/docker-compose.yml` | The whole stack — ES 8.17, Kibana 8.17, OTel Collector 0.135, Jaeger 1.62 |
| `es-stack/otel/collector-config.yaml` | OTLP receivers, ES exporter with `mapping.mode: otel` |
| `es-stack/claude-code.env` | Env vars to enable Claude Code telemetry — `source` it before running `claude` |
| `es-stack/scripts/setup-kibana.sh` | One-shot: registers traces template + Claude Code attribute mappings/pipeline, creates data views, imports dashboard |
| `es-stack/kibana/claude-code-dashboard.ndjson` | Pre-built "Claude Code · Overview" dashboard (13 panels incl. trace row) |
| `es-stack/kibana/build-dashboard.py` | Regenerator for the dashboard NDJSON |
| `docs/signals-reference.md` | Authoritative reference for what Claude Code emits |
| `docs/admin-rollout-guide.md` | Practical guide for rolling out to a team plan |
| `docs/es-upgrade-8.14-to-8.17.md` | Pragmatic runbook for upgrading older ES clusters that lack full OTel template support |
| `observability-explainer/` | React Flow app diagramming **both** stacks — tab toggle in header switches ES ↔ Grafana view (built by Claude Code) |
| `grafana-stack/` | Alternative LGTM stack — Tempo / Loki / Prometheus / Grafana on offset ports (14317 / 13000 / 13100 / 13200 / 19090). See its `README.md`. |

## Hard-won facts (don't re-derive these)

1. **OTel Collector image `0.116.0` is broken** (`exec /otelcol-contrib: no such file or directory`). `0.119.0` works but has asymmetric routing across signals. `0.135.0` unified the routing for logs/metrics/traces. **Pin a known-good version; don't use `latest`.**

2. **Vanilla ES has NO `traces-*-*` catch-all template.** Built-in `traces-otel@template` only matches `traces-*.otel-*`. Either route traces to a `*.otel-*` data stream (preferred, achieved by upgrading to exporter 0.135+), or add a custom template (last resort).

3. **Claude Code strips `data_stream.*` from `OTEL_RESOURCE_ATTRIBUTES`.** You cannot brand routing from the app side. Other attributes pass through fine. **Newer Claude Code (≥ 2.1.186) sets `data_stream.dataset=claude_code` natively on _some_ events (api_request) but not others (tool_result, tool_decision)** — so routing is inconsistent without help. Our collector wires `resource/dataset` + `attributes/dataset` upserts into all 3 pipelines to force everything to `claude_code` (underscore — Elastic dataset naming convention).

4. **Two attribute layers — they're NOT the same.**
   - `resource.attributes.*` — per-process (service.name, host.name)
   - `attributes.*` — per-record (user.email, session.id, tool_name)
   - A KQL of `resource.attributes.user.email` returns 0 silently because user.email lives on records.

5. **Span name `attributes.tool_name` is `keyword` under built-in templates** — no `.keyword` suffix needed. (My earlier custom template made it `text` with a `.keyword` multi-field; that's gone now.)

5a. **Many Claude Code attributes are emitted as OTLP _string_ values even when semantically numeric/boolean** — e.g. `success="true"`, `tool_result_size_bytes="12"`, `duration_ms="28"` (on tool_result events; api_request sends them as numbers). Without help, ES dynamic mapping makes them all `keyword`, so `sum`/`avg`/boolean queries error or return 0. `es-stack/scripts/setup-kibana.sh` registers `claude-code-attributes@mappings` to force types. This mirrors the Elastic Security Labs guide (https://www.elastic.co/security-labs/claude-code-cowork-monitoring-otel-elastic).

5b. **`tool_input` / `tool_parameters` arrive as stringified JSON** (`"{\"command\":\"ls\",...}"`), not nested objects. `claude-code-attributes@pipeline` JSON-parses them into `attributes.tool_input_flattened` / `tool_parameters_flattened` (type `flattened`), keeping the raw string intact. Without it, `tool_input.command` queries return 0 even when the command is in the data.

5c. **`ecs@mappings` has an `all_strings_to_keywords` dynamic_template that catches strings before any path-based rule.** Custom dynamic_templates that need to override types for string-valued attributes MUST be `composed_of`'d **before** `ecs@mappings` — otherwise they never get evaluated. Took two rollovers to figure out.

6. **Mapping changes apply to FUTURE backing indices only.** To apply now: `POST <data_stream>/_rollover`.

7. **Local source-of-truth is `~/.claude/projects/<safe-cwd>/<session-id>.jsonl`** — richer than OTel (includes cache TTL split, retry iterations, full tool I/O). Use for forensic deep-dives.

8. **Prometheus OTLP receiver rejects DELTA metrics** with `invalid temporality and type combination`. Claude Code emits DELTA; Prom only accepts CUMULATIVE. Grafana stack's collector must include the `deltatocumulative` processor in the metrics pipeline. Tempo/Loki/ES don't care.

9. **Loki promotes only resource attributes to labels** (e.g. `service_name`, `service_namespace`). Per-record `attributes.*` arrive as **structured metadata** — searchable via LogQL but NOT used as index labels. Plan label queries against the resource layer.

10. **Prometheus flattens OTel metric names**: dots → underscores, unit + `_total` appended for counters. `claude_code.token.usage` (tokens) → `claude_code_token_usage_tokens_total`. Attributes become labels.

## Conventions

- Data streams land at `<type>-claude_code.otel-default` (collector upserts `data_stream.dataset=claude_code` on both resource and record attributes). Logs match our higher-priority `logs-claude_code.otel-custom` template (priority 200) which includes the custom attribute mappings; metrics/traces match built-in `<type>-otel@template`.
- `service.name="claude-code"` is hardcoded by Claude Code — safe to use as a routing/filtering predicate.
- `service.namespace="claude-code-demo"` is set via env — that's the filter to isolate demo data from anything else in the same ES.
- Privacy flags are intentionally ON in `es-stack/claude-code.env` (`OTEL_LOG_USER_PROMPTS=1`, `OTEL_LOG_TOOL_DETAILS=1`). Don't enable these without policy review in real rollouts.
- **Cost field choice**: prefer `attributes.cost_usd_micros` (long, integer micro-USD) over `attributes.cost_usd` (float) for aggregation — no precision concerns, both are emitted on every `api_request` event.

## How to run

Both stacks are peers — pick one or run both (offset ports, no conflict).

ES stack:
```bash
cd es-stack && docker compose up -d   # start the stack
source claude-code.env                # in the shell that runs claude
claude -p "what is OTel?"             # generate telemetry
# → http://localhost:5601 → Dashboards → "Claude Code · Overview"
# → http://localhost:16686 for Jaeger waterfall
```

Grafana stack:
```bash
cd grafana-stack && docker compose up -d
source claude-code-grafana.env        # ships to :14317 instead of :4317
claude -p "what is OTel?"
# → http://localhost:13000 → Explore → Tempo / Loki / Prometheus
```

Frontend explainer (shows both architectures with a tab toggle):
```bash
docker run -d --name claude-otel-explainer \
  -v $(pwd)/observability-explainer:/app -w /app -p 5173:5173 \
  node:20-alpine sh -c 'npm install && npm run dev -- --host 0.0.0.0'
# → http://localhost:5173
```

## Useful diagnostic commands

```bash
# what data streams exist + what template each uses
curl -s localhost:9200/_data_stream | jq '.data_streams[] | {name, template}'

# what's in each backing index (doc counts)
curl -s 'localhost:9200/_cat/indices/logs-*,metrics-*,traces-*?v'

# which built-in OTel templates are present
for t in logs-otel@template metrics-otel@template traces-otel@template; do
  echo "$t -> $(curl -s -o /dev/null -w '%{http_code}' localhost:9200/_index_template/$t)"
done

# verify the collector binary actually runs (use when changing image versions)
docker run --rm otel/opentelemetry-collector-contrib:<tag> --version
```

## When changing things

- **Editing `es-stack/otel/collector-config.yaml`** or `grafana-stack/otel/collector-config.yaml` → `docker compose -f <stack>/docker-compose.yml restart otel-collector` (volume-mounted, no rebuild needed).
- **Editing `es-stack/claude-code.env`** / `grafana-stack/claude-code-grafana.env` → re-`source` it before the next `claude` invocation.
- **Editing the dashboard** → regenerate via `python3 es-stack/kibana/build-dashboard.py`, then `docker compose -f es-stack/docker-compose.yml run --rm kibana-setup` to re-import.
- **Editing `es-stack/docker-compose.yml`** → `docker compose -f es-stack/docker-compose.yml up -d` to recreate changed services.
- **Editing the explainer frontend** (`observability-explainer/src/*`) → Vite container has HMR, no restart needed. For prod build: `docker exec claude-otel-explainer npm run build`.

## What this demo deliberately does NOT have

- ES authentication / TLS (would mask the routing experiments under access errors).
- Multiple users / multi-tenancy (single OTel resource = simpler reasoning).
- A central ILM policy beyond ES defaults (data is short-lived demo data).
- Persistent Jaeger storage (in-memory; traces wipe on restart).

These would all be added for a real rollout — see `docs/admin-rollout-guide.md`.
