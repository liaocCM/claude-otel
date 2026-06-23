# Claude Code → OpenTelemetry → (Elasticsearch | Grafana LGTM)

Captures Claude Code telemetry and ships it to **either** an ES + Kibana + Jaeger
stack **or** a Grafana LGTM stack (Tempo / Loki / Prometheus / Grafana). Both
compose files live in this repo and can run side by side on offset ports.

```
                                                ┌─▶ Elasticsearch ──▶ Kibana
 Claude Code ──OTLP/gRPC:4317──▶ OTel Collector │      :9200             :5601
                                                └─▶ Jaeger ──▶ Jaeger UI :16686

                                                 ┌─▶ Tempo       (traces)
 Claude Code ──OTLP/gRPC:14317──▶ OTel Collector ─┼─▶ Loki        (logs)
                                                 └─▶ Prometheus  (metrics)  → Grafana :13000
```

| Service        | URL / Port              | Purpose                          |
|----------------|-------------------------|----------------------------------|
| OTel Collector (ES) | `localhost:4317` (gRPC), `4318` (HTTP) | receives Claude Code telemetry |
| Elasticsearch  | http://localhost:9200   | storage (logs/metrics/traces)    |
| Kibana         | http://localhost:5601   | aggregate exploration + dashboard |
| Jaeger UI      | http://localhost:16686  | single-trace waterfall view      |
| **Grafana stack** | see [`grafana-stack/README.md`](grafana-stack/README.md) | alternative LGTM backend on offset ports (14317 / 13000 / 13100 / 13200 / 19090) |
| **Explainer UI** | http://localhost:5173 | React Flow diagram of **both** stacks (tab toggle in header) |

## 1. Start the stack

```bash
docker compose up -d
```

First boot takes ~1 min (Elasticsearch + Kibana). The one-shot `kibana-setup`
container waits for Kibana and creates the `logs-*`, `metrics-*`, `traces-*`
data views automatically, then exits.

Check it's healthy:

```bash
docker compose ps
curl -s localhost:9200/_cluster/health | grep -o '"status":"[a-z]*"'
```

## 2. Point Claude Code at the collector

In the shell where you run `claude`:

```bash
source claude-code.env
claude
```

Then use Claude Code normally — ask a question, run a tool, etc.

## 3. View the data in Kibana

**Dashboard** — open http://localhost:5601 → **Dashboards** → **Claude Code · Overview**.
It has KPI tiles (tokens / cost / sessions / lines of code), token-usage-by-type,
cost-by-model, lines-added-vs-removed, event-type breakdowns, and a **traces row**
(span count, avg LLM latency, tool-calls-by-tool, spans-by-type). Auto-refreshes
every 10s over the last 24h.

**Raw exploration** — **Discover** → choose a data view:

- **Claude Code · Logs (events)** — `api_request`, `tool_result`, `tool_decision`, `user_prompt`, …
- **Claude Code · Metrics** — `claude_code.token.usage`, `claude_code.cost.usage`, `claude_code.session.count`, …
- **Claude Code · Traces** — request spans (beta)

Filter to this demo with `resource.attributes.service.namespace : "claude-code-demo"`.

Sanity-check that data is landing in Elasticsearch directly:

```bash
curl -s 'localhost:9200/_cat/indices/logs-*,metrics-*,traces-*?v'
```

## Files

| File | What it is |
|------|------------|
| `docker-compose.yml`               | the whole stack (multi-service)                 |
| `otel/collector-config.yaml`       | OTLP receivers + Elasticsearch exporter         |
| `scripts/setup-kibana.sh`          | registers traces template + data views + imports dashboard (one-shot) |
| `kibana/claude-code-dashboard.ndjson` | the "Claude Code · Overview" dashboard       |
| `kibana/build-dashboard.py`        | regenerates the dashboard NDJSON                |
| `claude-code.env`                  | env vars to enable Claude Code telemetry        |
| `docs/signals-reference.md`        | what Claude Code emits (metrics / events / traces), verified vs. live data |
| `docs/admin-rollout-guide.md`      | rollout guide for shipping this to a team plan |
| `observability-explainer/`         | Vite + React Flow app diagramming **both** stacks — tab toggle switches ES ↔ Grafana view |
| `grafana-stack/`                   | alternative compose: Tempo + Loki + Prometheus + Grafana, on offset ports — see its [README](grafana-stack/README.md) |

## Notes

- **Traces** (beta) are fully wired. Claude Code emits a span tree per prompt:
  `claude_code.interaction` → `claude_code.llm_request` + `claude_code.tool` →
  `claude_code.tool.execution`. Vanilla Elasticsearch ships data-stream templates
  for `logs-*`/`metrics-*` but **not** `traces-*`, so `scripts/setup-kibana.sh`
  registers one — without it, trace writes fail with `index_not_found_exception`.
- **Demo security**: Elasticsearch runs single-node with `xpack.security` disabled.
  Do **not** use this config in production — add auth/TLS and a real cluster.
- **Privacy**: `claude-code.env` sets `OTEL_LOG_USER_PROMPTS=1` and
  `OTEL_LOG_TOOL_DETAILS=1`, so prompt text and tool commands/args are logged.
  Remove those two lines if you don't want that captured.
- **Tear down**: `docker compose down` (add `-v` to also delete the ES volume).

## Which stack should I use?

| You want to… | Use |
|---|---|
| Full-text search across log content | **ES + Kibana** (Loki is label-based) |
| Per-trace waterfall + one-click cross-signal jumps | **Grafana stack** (Tempo + Loki + Prometheus) |
| Lower storage cost at scale | **Grafana stack** (object-store native) |
| Drop-in next to an existing Elastic / arceus deployment | **ES + Kibana** |

Both stacks consume the **same** Claude Code telemetry — only the env file
(`claude-code.env` vs `grafana-stack/claude-code-grafana.env`) and the port it
points at change.
