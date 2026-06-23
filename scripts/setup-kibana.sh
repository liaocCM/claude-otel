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
