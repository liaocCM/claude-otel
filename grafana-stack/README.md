# Grafana stack — alternative to the ES + Kibana setup

OTel Collector → **Tempo** (traces) + **Loki** (logs) + **Prometheus** (metrics)
→ **Grafana** as the single UI. Runs on separate ports from the main ES stack,
so they can coexist.

```
Claude Code  ──OTLP :14317──▶  Collector  ─┬─▶ Tempo       (traces)
                                           ├─▶ Loki        (logs)
                                           └─▶ Prometheus  (OTLP receiver)
                                                   ↓
                                                Grafana    :13000
```

## Ports (deliberately offset so you can run BOTH stacks at once)

| Service | URL |
|---|---|
| **Grafana** | http://localhost:13000 |
| Collector OTLP gRPC | `localhost:14317` |
| Collector OTLP HTTP | `localhost:14318` |
| Tempo HTTP | http://localhost:13200 |
| Loki HTTP | http://localhost:13100 |
| Prometheus | http://localhost:19090 |

## Start

```bash
cd grafana-stack
docker compose up -d
```

First boot pulls ~1.5 GB of images and takes ~1 min.

## Point Claude Code at this stack

```bash
source ./claude-code-grafana.env       # uses port 14317, not 4317
claude -p "run echo hello via Bash"
```

Then **open http://localhost:13000**:
- **Explore → Tempo** → search recent traces, click one for the waterfall
- **Explore → Loki** → `{service_name="claude-code"}` for events
- **Explore → Prometheus** → `claude_code_token_usage_tokens_total` for metrics
- **Dashboards → Claude Code · Overview** for the pre-built dashboard

## The LGTM party trick — cross-signal jumps

Pre-provisioned in `grafana/provisioning/datasources/datasources.yaml`:

- **From a trace span → logs**: open a trace, click a span, "Logs for this span"
  — Grafana queries Loki for `{service_name="..."}` around that time.
- **From a log line → trace**: a `trace_id=…` in a log line is auto-detected
  and shown as a clickable "Open trace" badge.
- **From a metric exemplar → trace**: time-series exemplars (when present)
  jump straight to the originating trace in Tempo.

These cross-jumps are why people pick LGTM over per-tool UIs.

## Comparing to the ES + Kibana stack (port 4317 / 5601)

| You want to… | Use |
|---|---|
| Full-text search across log content | **ES + Kibana** (Loki is label-based, weaker at this) |
| Per-trace waterfall + cross-signal jumps | **Grafana stack** (Tempo + Loki + Prometheus) |
| Lower storage cost at scale | **Grafana stack** (object-store native) |
| Existing Elastic / arceus integration | **ES + Kibana** |

## Field name differences to know

OTel metrics in Prometheus get **flattened** with underscores and a unit suffix:

| OTel metric | Prometheus metric |
|---|---|
| `claude_code.token.usage` (tokens, counter) | `claude_code_token_usage_tokens_total` |
| `claude_code.cost.usage` (USD, counter) | `claude_code_cost_usage_USD_total` |
| `claude_code.session.count` (count, counter) | `claude_code_session_count_total` |
| `claude_code.lines_of_code.count` | `claude_code_lines_of_code_count_total` |

Attributes become labels: `attributes.type` → `type` label, etc.

In **Loki**, resource attributes are promoted to labels by the OTLP receiver
(e.g. `service_name`, `service_namespace`). Per-record `attributes.*` arrive
as **structured metadata** — searchable via LogQL but not used as index labels.

## Stop / clean up

```bash
docker compose down            # stop
docker compose down -v         # also wipe Tempo/Loki/Prometheus data
```

Removing this stack does NOT touch the ES + Kibana stack in the parent
directory.
