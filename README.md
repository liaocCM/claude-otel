# Claude Code observability — Elastic or Grafana

Pre-wired OpenTelemetry pipeline for Claude Code, with two interchangeable
backends in one repo: **Elasticsearch + Kibana + Jaeger** or **Grafana LGTM**
(Tempo + Loki + Prometheus). Pick a stack, `docker compose up`, point Claude
Code at it.

What lands in Elastic, end-to-end:

![Discover · Logs](docs/images/discover-logs.png)
> One typed document per Claude Code event — `api_request`, `tool_result`,
> `tool_decision`, `user_prompt`, `api_error`. `success` is a real boolean,
> `duration_ms` / `cost_usd_micros` are real numbers, `tool_input` JSON is
> parsed into `tool_input_flattened.command` — all queryable without coercion.

![Discover · Metrics](docs/images/discover-metrics.png)
> Token usage split by model + type (input / output / cacheRead /
> cacheCreation), USD cost, active time. Each row is a `(metric, dimensions,
> value)` tuple — drop straight into Lens.

![Discover · Traces](docs/images/discover-traces.png)
> The full span tree per prompt: `claude_code.interaction → llm_request +
> tool → tool.execution`. Every span carries `trace_id`, `duration`, and the
> attribute set you need to attribute work to a user / model / tool.

![Jaeger · trace waterfall](docs/images/jaeger-trace.png)
> Click any `trace_id` into Jaeger for the critical path. Above: two parallel
> `llm_request` spans dominate a 4.55 s prompt; tool execution is ~30 ms.

---

## Pick a stack

| You want… | Stack | Why |
|---|---|---|
| Full-text search, mature aggregations, drop-in beside existing Elastic | **ES + Kibana + Jaeger** | Kibana for aggregates, Jaeger for waterfalls |
| Single UI with one-click jumps between logs / metrics / traces, cheaper at scale | **Grafana LGTM** | Tempo + Loki + Prometheus, correlations pre-wired |
| Both, for side-by-side comparison | Run both | Ports are offset, no conflict |

Both consume the **same** OTLP — only the receiver port and env file change.

---

## Path A — Elasticsearch + Kibana + Jaeger

```bash
docker compose up -d                  # ~1 min on first boot
source claude-code.env
claude -p "what is OTel?"             # generate some telemetry
```

Then:

- **Kibana dashboard** → http://localhost:5601 → *Dashboards* → **Claude Code · Overview** (13 panels, 10 s refresh).
- **Discover** → pick *Claude Code · Logs (events)* / *Metrics* / *Traces (beta)*.
- **Jaeger waterfall** → http://localhost:16686.

The `kibana-setup` one-shot registers the traces template, attribute mappings
(`claude-code-attributes@mappings`), the JSON-parse ingest pipeline, and
imports the dashboard. Without it, `tool_input.command` queries return zero
and `sum(duration_ms)` errors — context in [`CLAUDE.md`](CLAUDE.md) facts 5a–5c.

## Path B — Grafana LGTM

```bash
cd grafana-stack
docker compose up -d
source claude-code-grafana.env        # OTLP → :14317 (vs :4317 for the ES stack)
claude -p "what is OTel?"
```

Then open Grafana at http://localhost:13000 → *Explore* → switch between
Tempo / Loki / Prometheus. Datasource correlations (log → trace, metric →
log) are pre-wired in provisioning.

Details, including the `deltatocumulative` processor required because Prometheus
rejects Claude Code's DELTA metrics, in [`grafana-stack/README.md`](grafana-stack/README.md).

---

## Caveats

- **Demo, not production.** Single-node Elasticsearch with `xpack.security`
  off, no TLS, in-memory Jaeger. For a team rollout (auth, multi-tenancy,
  ILM, MDM-managed env) see [`docs/admin-rollout-guide.md`](docs/admin-rollout-guide.md).
- **Privacy.** `claude-code.env` opts into `OTEL_LOG_USER_PROMPTS=1` and
  `OTEL_LOG_TOOL_DETAILS=1` — prompts, tool commands, and tool args are
  captured verbatim. Comment those two lines out if your policy says no.
- **Teardown.** `docker compose down -v` (the `-v` also drops the ES volume).
- **Old Elasticsearch?** 8.14 ships partial OTel templates, 8.16+ ships them
  all; 8.17 is the recommended target. Runbook:
  [`docs/es-upgrade-8.14-to-8.17.md`](docs/es-upgrade-8.14-to-8.17.md).

---

## Architecture

```
                                                ┌─▶ Elasticsearch ──▶ Kibana
 Claude Code ──OTLP/gRPC :4317──▶ OTel Collector │      :9200             :5601
                                                └─▶ Jaeger ──▶ Jaeger UI :16686

                                                  ┌─▶ Tempo       (traces)
 Claude Code ──OTLP/gRPC :14317──▶ OTel Collector ─┼─▶ Loki        (logs)
                                                  └─▶ Prometheus  (metrics)  → Grafana :13000
```

The collector upserts `data_stream.dataset=claude_code` on resource **and**
record attributes for all three pipelines, so every signal lands in
`*-claude_code.otel-*` regardless of which event Claude Code natively
brands. See [`CLAUDE.md`](CLAUDE.md) for the rest of the hard-won facts.

## Reference

- [`docs/signals-reference.md`](docs/signals-reference.md) — every event,
  metric, span, and attribute Claude Code emits, verified against live data.
- [`docs/admin-rollout-guide.md`](docs/admin-rollout-guide.md) — taking this
  from demo to a team plan.
- [`docs/es-upgrade-8.14-to-8.17.md`](docs/es-upgrade-8.14-to-8.17.md) —
  upgrading older Elasticsearch.
- `observability-explainer/` — React Flow app diagramming both stacks side
  by side, with a tab toggle. `docker compose up -d` already starts it at
  http://localhost:5173.
