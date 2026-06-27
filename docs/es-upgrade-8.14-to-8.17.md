# ES 8.14.1 → 8.17.3 upgrade — quick runbook

Why we're upgrading: 8.14 has incomplete `metrics-otel@template` and **no**
`traces-otel@template`. Both land properly in 8.16, stabilise in 8.17.
Low-risk same-major upgrade — no reindex, ~20 min wallclock for single-node.

Target: **ES 8.17.3 + Kibana 8.17.3 + OTel Collector contrib ≥ 0.135**.

Skip these patch versions:
- **8.16.0 / 8.16.1** — `enrich.cache_size` rename (reverted in 8.16.2)
- **8.17.0 / 8.17.2** — ES|QL ENRICH NPE/CCE (fixed in 8.17.3)

8.x → 8.x lets you jump straight from 8.14.1 to 8.17.3, no intermediate stops.

---

## What you gain

- `traces-otel@template` (8.16) — no more custom traces template
- `metrics-otel@template` completeness (8.16) — histogram + boolean TSDB dimensions correct
- `subobjects: auto` (8.16) — third option for OTel `attributes.*`
- Synthetic source improvements (8.15+) — disk savings on logs/metrics

---

## Risks that actually matter

| Risk | When it bites |
|---|---|
| JDK 23 CLDR locale change (8.16) | Custom date formats with textual month/weekday (`MMM`, `EEEE`, `YYYY-ww`) — `arceus` Serilog → OTel doesn't use these |
| `_source.mode` mapping deprecated (8.17) | Only if you've forked built-in OTel templates and used it |
| `data_lifecycle.retention` → `data_lifecycle.data_retention` rename (8.16) | Only if you scrape `_data_stream/_lifecycle/stats` |

The OTel surface (template syntax, `subobjects`, dotted attributes,
`mapping.mode: otel` exporter) has **no breaking changes** across 8.15–8.17.

---

## Pre-upgrade checklist

1. **Snapshot current OTel templates** for compare-after:
   ```bash
   for t in logs-otel metrics-otel traces-otel; do
     curl -s ":9200/_index_template/${t}@template" \
       > /tmp/${t}-before.json
   done
   ```
2. **Confirm collector version** in your edge + gateway: `docker exec <collector> /otelcol-contrib --version` — need ≥ 0.135.
3. **Audit `_source.mode`**: `grep -r '"_source"' your-templates/` — expect none.
4. **Audit ingest pipeline date formats**: search for `MMM`, `EEEE`, `YYYY-ww` in any pipeline definition.
5. **Confirm no ES|QL ENRICH** usage outside 8.17.3+, or land directly on 8.17.3.
6. **Snapshot ES**: `PUT _snapshot/<repo>/pre-8.17 ...` — standard belt-and-braces, not OTel-specific.
7. **Stage first**: run the full upgrade on staging cluster, generate Claude Code / arceus telemetry, confirm data lands in `*.otel-*` data streams.

---

## Upgrade order

```
1. Stop Kibana
2. Stop Elasticsearch
3. Bump ES image tag → 8.17.3, start, wait for green
4. Bump Kibana image tag → 8.17.3, start, wait for "level: available"
   (first start runs saved-object migrations — takes 1–15 min)
5. Rollover all OTel data streams so new built-in templates apply to
   future backing indices:

      for ds in $(curl -s :9200/_data_stream | \
                  jq -r '.data_streams[].name | select(test("\\.otel-"))'); do
        curl -s -XPOST ":9200/$ds/_rollover" >/dev/null
      done
```

(Multi-node: do a real rolling restart instead of stop/start; same patch target.)

---

## Verify

```bash
# (a) built-in OTel templates exist and are current
for t in logs-otel metrics-otel traces-otel; do
  echo "$t -> $(curl -s -o /dev/null -w '%{http_code}' \
    :9200/_index_template/${t}@template)"
done
# expect: 200 / 200 / 200   (8.14 returned 200 / 200 / 404)

# (b) compare against pre-snapshot
diff <(jq -S . /tmp/metrics-otel-before.json) \
     <(curl -s :9200/_index_template/metrics-otel@template | jq -S .)
# expect: meaningful diffs — Elastic's new template won, not yours

# (c) send a real signal and confirm the data stream is .otel-flavored
source ../es-stack/claude-code.env && claude -p "hello"
curl -s ':9200/_cat/indices/*.otel-*?v'
```

---

## Estimated downtime (single-node)

- ES: ~5 min restart
- Kibana: ~5–15 min saved-object migration
- **Total wallclock: under 20 min**
- No reindex required — 8.x indices are read-write compatible across the major.

---

## Rollback

If something's wrong after step 4 and you've **not yet rolled over** any data
stream (step 5), rollback is straightforward:

1. Stop Kibana → restore image to 8.14.1
2. Stop ES → restore image to 8.14.1
3. Restart in original order

Once you've rolled over, the new backing indices have 8.17-flavored mappings
and can't be served by 8.14.1. At that point rollback means **restoring from
the pre-upgrade snapshot** (step 6 of the checklist).

In practice for our setup the rollover is the point of no return — plan to
either commit or restore-from-snapshot, not partial roll back.
