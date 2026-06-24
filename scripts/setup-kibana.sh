#!/bin/sh
# One-shot bootstrap: register the traces data-stream template in Elasticsearch,
# then create Kibana data views and import the dashboard.
set -eu

ES="${ES_URL:-http://elasticsearch:9200}"
KIBANA="${KIBANA_URL:-http://kibana:5601}"

# Elasticsearch ships built-in data-stream templates for logs-*-* and
# metrics-*-*, but NOT for traces-*. Without one, the collector's trace bulk
# writes fail with index_not_found_exception. Register a minimal one.
echo "Registering traces-* data-stream template in Elasticsearch ..."
until curl -s -o /dev/null -w '%{http_code}' "$ES" | grep -q '200'; do sleep 3; done
curl -s -o /dev/null -X PUT "$ES/_index_template/traces-otel-demo" \
  -H 'Content-Type: application/json' \
  -d '{
    "index_patterns": ["traces-*"],
    "data_stream": {},
    "priority": 200,
    "template": {
      "settings": { "number_of_replicas": 0 },
      "mappings": { "properties": {
        "@timestamp": { "type": "date" },
        "trace_id": { "type": "keyword" }, "span_id": { "type": "keyword" },
        "parent_span_id": { "type": "keyword" },
        "name": { "type": "keyword" }, "kind": { "type": "keyword" },
        "duration": { "type": "long" }
      } }
    }
  }' || true

# Claude Code attribute mappings + ingest pipeline.
# Why: Claude Code emits `success`, `tool_result_size_bytes`, `duration_ms`,
# `tool_input`, `tool_parameters` as OTLP string-attributes. Vanilla dynamic
# mapping makes them all `keyword` — so sum()/avg() error out and the JSON
# strings can't be queried by inner key.
# - component template: dynamic_templates forcing right ES types
# - ingest pipeline: parses tool_input/tool_parameters into *_flattened
# - index template (priority 200): hooks both into `logs-claude_code.otel-*`
#   AND orders our dynamic_templates BEFORE ecs@mappings (otherwise its
#   `all_strings_to_keywords` rule wins for string-valued attributes).
echo "Registering Claude Code attribute mappings + pipeline ..."
curl -s -o /dev/null -X PUT "$ES/_component_template/claude-code-attributes@mappings" \
  -H 'Content-Type: application/json' \
  -d '{
    "template": { "mappings": { "dynamic_templates": [
      { "cc_cost_usd":           { "path_match": "attributes.cost_usd",                "mapping": { "type": "float" } } },
      { "cc_cost_usd_micros":    { "path_match": "attributes.cost_usd_micros",         "mapping": { "type": "long" } } },
      { "cc_duration_ms":        { "path_match": "attributes.duration_ms",             "mapping": { "type": "long" } } },
      { "cc_input_tokens":       { "path_match": "attributes.input_tokens",            "mapping": { "type": "long" } } },
      { "cc_output_tokens":      { "path_match": "attributes.output_tokens",           "mapping": { "type": "long" } } },
      { "cc_cache_read":         { "path_match": "attributes.cache_read_tokens",       "mapping": { "type": "long" } } },
      { "cc_cache_creation":     { "path_match": "attributes.cache_creation_tokens",   "mapping": { "type": "long" } } },
      { "cc_tool_input_bytes":   { "path_match": "attributes.tool_input_size_bytes",   "mapping": { "type": "long" } } },
      { "cc_tool_result_bytes":  { "path_match": "attributes.tool_result_size_bytes",  "mapping": { "type": "long" } } },
      { "cc_success":            { "path_match": "attributes.success",                 "mapping": { "type": "boolean" } } },
      { "cc_tool_input_flat":      { "path_match": "attributes.tool_input_flattened",      "mapping": { "type": "flattened" } } },
      { "cc_tool_parameters_flat": { "path_match": "attributes.tool_parameters_flattened", "mapping": { "type": "flattened" } } }
    ] } },
    "_meta": { "managed_by": "claude-otel-demo" }
  }' || true

curl -s -o /dev/null -X PUT "$ES/_ingest/pipeline/claude-code-attributes@pipeline" \
  -H 'Content-Type: application/json' \
  -d '{
    "description": "Parse stringified-JSON tool_input/tool_parameters into *_flattened objects",
    "processors": [
      { "json": { "field": "attributes.tool_input",      "target_field": "attributes.tool_input_flattened",      "if": "ctx?.attributes?.tool_input instanceof String && ctx.attributes.tool_input.startsWith(\"{\")",      "ignore_failure": true } },
      { "json": { "field": "attributes.tool_parameters", "target_field": "attributes.tool_parameters_flattened", "if": "ctx?.attributes?.tool_parameters instanceof String && ctx.attributes.tool_parameters.startsWith(\"{\")", "ignore_failure": true } }
    ]
  }' || true

curl -s -o /dev/null -X PUT "$ES/_index_template/logs-claude_code.otel-custom" \
  -H 'Content-Type: application/json' \
  -d '{
    "index_patterns": ["logs-claude_code.otel-*"],
    "data_stream": {},
    "priority": 200,
    "composed_of": [
      "logs@mappings", "logs@settings", "otel@mappings", "logs-otel@mappings",
      "claude-code-attributes@mappings",
      "semconv-resource-to-ecs@mappings", "ecs@mappings"
    ],
    "template": { "settings": { "index.default_pipeline": "claude-code-attributes@pipeline" } }
  }' || true

echo "Waiting for Kibana at $KIBANA ..."
until curl -s "$KIBANA/api/status" | grep -q '"level":"available"'; do
  sleep 5
done

create_dv() {
  title="$1"; name="$2"
  echo "Creating data view: $name ($title)"
  curl -s -o /dev/null -X POST "$KIBANA/api/data_views/data_view" \
    -H 'kbn-xsrf: true' \
    -H 'Content-Type: application/json' \
    -d "{\"data_view\":{\"title\":\"$title\",\"name\":\"$name\",\"timeFieldName\":\"@timestamp\"}}" \
    || true   # ignore "already exists" conflicts
}

create_dv "logs-*"    "Claude Code · Logs (events)"
create_dv "metrics-*" "Claude Code · Metrics"
create_dv "traces-*"  "Claude Code · Traces"

# Import the prebuilt dashboard (visualizations + dashboard).
DASHBOARD="/kibana/claude-code-dashboard.ndjson"
if [ -f "$DASHBOARD" ]; then
  echo "Importing dashboard: Claude Code · Overview"
  curl -s -o /dev/null -X POST "$KIBANA/api/saved_objects/_import?overwrite=true" \
    -H 'kbn-xsrf: true' \
    --form file=@"$DASHBOARD" \
    || true
fi

echo "Done. Open Kibana → Dashboards → 'Claude Code · Overview'."
