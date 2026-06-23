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

- **ES stack** (root `docker-compose.yml`): Collector fans **traces** to both ES
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
| `docker-compose.yml` | The whole stack — ES 8.17, Kibana 8.17, OTel Collector 0.135, Jaeger 1.62 |
| `otel/collector-config.yaml` | OTLP receivers, ES exporter with `mapping.mode: otel` |
| `claude-code.env` | Env vars to enable Claude Code telemetry — `source` it before running `claude` |
| `scripts/setup-kibana.sh` | One-shot: registers traces template, creates data views, imports dashboard |
| `kibana/claude-code-dashboard.ndjson` | Pre-built "Claude Code · Overview" dashboard (13 panels incl. trace row) |
| `kibana/build-dashboard.py` | Regenerator for the dashboard NDJSON |
| `docs/signals-reference.md` | Authoritative reference for what Claude Code emits |
| `docs/admin-rollout-guide.md` | Practical guide for rolling out to a team plan |
| `observability-explainer/` | React Flow app diagramming **both** stacks — tab toggle in header switches ES ↔ Grafana view (built by Claude Code) |
| `grafana-stack/` | Alternative LGTM stack — Tempo / Loki / Prometheus / Grafana on offset ports (14317 / 13000 / 13100 / 13200 / 19090). See its `README.md`. |

## Hard-won facts (don't re-derive these)

1. **OTel Collector image `0.116.0` is broken** (`exec /otelcol-contrib: no such file or directory`). `0.119.0` works but has asymmetric routing across signals. `0.135.0` unified the routing for logs/metrics/traces. **Pin a known-good version; don't use `latest`.**

2. **Vanilla ES has NO `traces-*-*` catch-all template.** Built-in `traces-otel@template` only matches `traces-*.otel-*`. Either route traces to a `*.otel-*` data stream (preferred, achieved by upgrading to exporter 0.135+), or add a custom template (last resort).

3. **Claude Code strips `data_stream.*` from `OTEL_RESOURCE_ATTRIBUTES`.** You cannot brand routing from the app side. Other attributes pass through fine. To brand from collector side, use a `resource` or `transform` processor.

4. **Two attribute layers — they're NOT the same.**
   - `resource.attributes.*` — per-process (service.name, host.name)
   - `attributes.*` — per-record (user.email, session.id, tool_name)
   - A KQL of `resource.attributes.user.email` returns 0 silently because user.email lives on records.

5. **Span name `attributes.tool_name` is `keyword` under built-in templates** — no `.keyword` suffix needed. (My earlier custom template made it `text` with a `.keyword` multi-field; that's gone now.)

6. **Mapping changes apply to FUTURE backing indices only.** To apply now: `POST <data_stream>/_rollover`.

7. **Local source-of-truth is `~/.claude/projects/<safe-cwd>/<session-id>.jsonl`** — richer than OTel (includes cache TTL split, retry iterations, full tool I/O). Use for forensic deep-dives.

8. **Prometheus OTLP receiver rejects DELTA metrics** with `invalid temporality and type combination`. Claude Code emits DELTA; Prom only accepts CUMULATIVE. Grafana stack's collector must include the `deltatocumulative` processor in the metrics pipeline. Tempo/Loki/ES don't care.

9. **Loki promotes only resource attributes to labels** (e.g. `service_name`, `service_namespace`). Per-record `attributes.*` arrive as **structured metadata** — searchable via LogQL but NOT used as index labels. Plan label queries against the resource layer.

10. **Prometheus flattens OTel metric names**: dots → underscores, unit + `_total` appended for counters. `claude_code.token.usage` (tokens) → `claude_code_token_usage_tokens_total`. Attributes become labels.

## Conventions

- Data streams currently land at `<type>-generic.otel-default` (no `data_stream.dataset` set on the resource). All three match built-in `<type>-otel@template`.
- `service.name="claude-code"` is hardcoded by Claude Code — safe to use as a routing/filtering predicate.
- `service.namespace="claude-code-demo"` is set via env — that's the filter to isolate demo data from anything else in the same ES.
- Privacy flags are intentionally ON in `claude-code.env` (`OTEL_LOG_USER_PROMPTS=1`, `OTEL_LOG_TOOL_DETAILS=1`). Don't enable these without policy review in real rollouts.

## How to run

ES stack (default):
```bash
docker compose up -d                # start the stack
source claude-code.env              # in the shell that runs claude
claude -p "what is OTel?"           # generate telemetry
# → http://localhost:5601 → Dashboards → "Claude Code · Overview"
# → http://localhost:16686 for Jaeger waterfall
```

Grafana stack (alternative, can run alongside):
```bash
cd grafana-stack && docker compose up -d
source claude-code-grafana.env      # ships to :14317 instead of :4317
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

- **Editing `otel/collector-config.yaml`** or `grafana-stack/otel/collector-config.yaml` → `docker compose restart otel-collector` in that dir (volume-mounted, no rebuild needed).
- **Editing `claude-code.env`** / `grafana-stack/claude-code-grafana.env` → re-`source` it before the next `claude` invocation.
- **Editing the dashboard** → regenerate via `python3 kibana/build-dashboard.py`, then `docker compose run --rm kibana-setup` to re-import.
- **Editing `docker-compose.yml`** → `docker compose up -d` to recreate changed services.
- **Editing the explainer frontend** (`observability-explainer/src/*`) → Vite container has HMR, no restart needed. For prod build: `docker exec claude-otel-explainer npm run build`.

## What this demo deliberately does NOT have

- ES authentication / TLS (would mask the routing experiments under access errors).
- Multiple users / multi-tenancy (single OTel resource = simpler reasoning).
- A central ILM policy beyond ES defaults (data is short-lived demo data).
- Persistent Jaeger storage (in-memory; traces wipe on restart).

These would all be added for a real rollout — see `docs/admin-rollout-guide.md`.
