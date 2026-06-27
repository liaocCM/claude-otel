#!/usr/bin/env python3
"""Generate the Claude Code observability dashboard as a Kibana import NDJSON.

Each panel is a self-contained TSVB visualization pointing directly at the
`metrics-*` / `logs-*` index patterns (use_kibana_indexes=false), so the
dashboard does not depend on data-view IDs and imports cleanly anywhere.
"""
import json

VERSION = "8.17.0"

# Deterministic IDs (no randomness) so re-imports overwrite cleanly.
def uid(*parts):
    return "claude-otel-" + "-".join(parts)


def metric_obj(id_, type_, field):
    return {"id": uid(id_, "m"), "type": type_, "field": field}


def series(id_, label, color, metrics, split_mode="everything",
           terms_field=None, chart_type="line", stacked="none", filter_q=None):
    s = {
        "id": uid(id_, "s"),
        "label": label,
        "color": color,
        "metrics": metrics,
        "split_mode": split_mode,
        "chart_type": chart_type,
        "line_width": 2,
        "point_size": 2,
        "fill": 0.3,
        "stacked": stacked,
        "seperate_axis": 0,
        "axis_position": "right",
        "formatter": "number",
    }
    if terms_field:
        s["terms_field"] = terms_field
        s["terms_size"] = 10
        s["terms_order_by"] = uid(id_ + "-0", "m")
    if filter_q:
        s["filter"] = {"language": "kuery", "query": filter_q}
    return s


def tsvb(id_, title, panel_type, index_pattern, series_list,
         formatter="number", value_template=""):
    params = {
        "id": uid(id_, "p"),
        "type": panel_type,
        "series": series_list,
        "time_field": "@timestamp",
        "index_pattern": index_pattern,
        "use_kibana_indexes": False,
        "default_index_pattern": index_pattern,
        "interval": "",
        "axis_position": "left",
        "axis_formatter": "number",
        "axis_scale": "normal",
        "show_legend": 1,
        "show_grid": 1,
        "tooltip_mode": "show_all",
        "drop_last_bucket": 0,
        "isModelInvalid": False,
    }
    if panel_type == "metric":
        params["background_color_rules"] = [{"id": uid(id_, "bcr")}]
    vis_state = {
        "title": title,
        "type": "metrics",
        "aggs": [],
        "params": params,
    }
    # per-panel formatter applied on the (single) series for metric/gauge
    for s in series_list:
        s["formatter"] = formatter
        if value_template:
            s["value_template"] = value_template
    return {
        "id": uid(id_),
        "type": "visualization",
        "attributes": {
            "title": title,
            "description": "",
            "version": 1,
            "visState": json.dumps(vis_state),
            "uiStateJSON": "{}",
            "kibanaSavedObjectMeta": {
                "searchSourceJSON": json.dumps(
                    {"query": {"language": "kuery", "query": ""}, "filter": []}
                )
            },
        },
        "references": [],
        "coreMigrationVersion": VERSION,
    }


GREEN, BLUE, ORANGE, PURPLE, RED = "#54B399", "#6092C0", "#D6BF57", "#9170B8", "#CA8EAE"

panels = []

# --- single-stat KPIs -------------------------------------------------------
panels.append(tsvb(
    "tokens-total", "Total tokens", "metric", "metrics-*",
    [series("tokens-total-0", "Tokens", GREEN,
            [metric_obj("tokens-total-0", "sum", "metrics.claude_code.token.usage")])],
    formatter="0,0"))

panels.append(tsvb(
    "cost-total", "Total cost (USD)", "metric", "metrics-*",
    [series("cost-total-0", "Cost", ORANGE,
            [metric_obj("cost-total-0", "sum", "metrics.claude_code.cost.usage")])],
    formatter="$0,0.000"))

panels.append(tsvb(
    "sessions-total", "Sessions", "metric", "metrics-*",
    [series("sessions-total-0", "Sessions", BLUE,
            [metric_obj("sessions-total-0", "sum", "metrics.claude_code.session.count")])],
    formatter="0,0"))

panels.append(tsvb(
    "loc-total", "Lines of code", "metric", "metrics-*",
    [series("loc-total-0", "Lines", PURPLE,
            [metric_obj("loc-total-0", "sum", "metrics.claude_code.lines_of_code.count")])],
    formatter="0,0"))

# --- time series ------------------------------------------------------------
panels.append(tsvb(
    "tokens-by-type", "Token usage over time (by type)", "timeseries", "metrics-*",
    [series("tokens-by-type-0", "Tokens", GREEN,
            [metric_obj("tokens-by-type-0", "sum", "metrics.claude_code.token.usage")],
            split_mode="terms", terms_field="attributes.type",
            chart_type="line", stacked="stacked")],
    formatter="0,0"))

panels.append(tsvb(
    "cost-over-time", "Cost over time (by model)", "timeseries", "metrics-*",
    [series("cost-over-time-0", "Cost", ORANGE,
            [metric_obj("cost-over-time-0", "sum", "metrics.claude_code.cost.usage")],
            split_mode="terms", terms_field="attributes.model",
            chart_type="bar", stacked="stacked")],
    formatter="$0,0.000"))

panels.append(tsvb(
    "loc-by-type", "Lines of code (added vs removed)", "timeseries", "metrics-*",
    [series("loc-by-type-0", "Lines", PURPLE,
            [metric_obj("loc-by-type-0", "sum", "metrics.claude_code.lines_of_code.count")],
            split_mode="terms", terms_field="attributes.type",
            chart_type="bar", stacked="stacked")],
    formatter="0,0"))

# --- events (logs) ----------------------------------------------------------
panels.append(tsvb(
    "events-over-time", "Events over time (by type)", "timeseries", "logs-*",
    [series("events-over-time-0", "Events", BLUE,
            [{"id": uid("events-over-time-0", "m"), "type": "count"}],
            split_mode="terms", terms_field="event_name",
            chart_type="bar", stacked="stacked")],
    formatter="0,0"))

panels.append(tsvb(
    "events-top", "Top event types", "top_n", "logs-*",
    [series("events-top-0", "Events", GREEN,
            [{"id": uid("events-top-0", "m"), "type": "count"}],
            split_mode="terms", terms_field="event_name")],
    formatter="0,0"))

# --- traces (beta) ----------------------------------------------------------
panels.append(tsvb(
    "spans-total", "Trace spans", "metric", "traces-*",
    [series("spans-total-0", "Spans", RED,
            [{"id": uid("spans-total-0", "m"), "type": "count"}])],
    formatter="0,0"))

panels.append(tsvb(
    "llm-latency", "Avg LLM latency (ms)", "metric", "traces-*",
    [series("llm-latency-0", "ms", ORANGE,
            [{"id": uid("llm-latency-0", "m"), "type": "avg",
              "field": "attributes.duration_ms"}],
            filter_q='name: "claude_code.llm_request"')],
    formatter="0,0"))

panels.append(tsvb(
    "tool-calls", "Tool calls by tool", "top_n", "traces-*",
    [series("tool-calls-0", "Calls", GREEN,
            [{"id": uid("tool-calls-0", "m"), "type": "count"}],
            split_mode="terms", terms_field="attributes.tool_name.keyword",
            filter_q='name: "claude_code.tool"')],
    formatter="0,0"))

panels.append(tsvb(
    "spans-by-type", "Trace spans over time (by span type)", "timeseries", "traces-*",
    [series("spans-by-type-0", "Spans", PURPLE,
            [{"id": uid("spans-by-type-0", "m"), "type": "count"}],
            split_mode="terms", terms_field="name",
            chart_type="bar", stacked="stacked")],
    formatter="0,0"))

# --- dashboard layout (12-col grid) ----------------------------------------
layout = [
    ("tokens-total",      0, 0, 12, 7),
    ("cost-total",       12, 0, 12, 7),
    ("sessions-total",   24, 0, 12, 7),
    ("loc-total",        36, 0, 12, 7),
    ("tokens-by-type",    0, 7, 24, 12),
    ("cost-over-time",   24, 7, 24, 12),
    ("loc-by-type",       0, 19, 16, 12),
    ("events-over-time", 16, 19, 20, 12),
    ("events-top",       36, 19, 12, 12),
    # traces row
    ("spans-total",       0, 31, 12, 7),
    ("llm-latency",      12, 31, 12, 7),
    ("tool-calls",       24, 31, 24, 12),
    ("spans-by-type",     0, 38, 24, 12),
]

panels_json, references = [], []
for i, (pid, x, y, w, h) in enumerate(layout):
    ref = f"panel_{i}"
    panels_json.append({
        "version": VERSION,
        "type": "visualization",
        "gridData": {"x": x, "y": y, "w": w, "h": h, "i": str(i)},
        "panelIndex": str(i),
        "embeddableConfig": {"enhancements": {}},
        "panelRefName": ref,
    })
    references.append({"name": ref, "type": "visualization", "id": uid(pid)})

dashboard = {
    "id": "claude-code-overview",
    "type": "dashboard",
    "attributes": {
        "title": "Claude Code · Overview",
        "description": "Cost, tokens, sessions, code changes and events emitted by Claude Code via OpenTelemetry.",
        "version": 1,
        "timeRestore": True,
        "timeFrom": "now-24h",
        "timeTo": "now",
        "refreshInterval": {"pause": False, "value": 10000},
        "panelsJSON": json.dumps(panels_json),
        "optionsJSON": json.dumps({"useMargins": True, "hidePanelTitles": False}),
        "kibanaSavedObjectMeta": {
            "searchSourceJSON": json.dumps(
                {"query": {"language": "kuery", "query": ""}, "filter": []}
            )
        },
    },
    "references": references,
    "coreMigrationVersion": VERSION,
}

with open("kibana/claude-code-dashboard.ndjson", "w") as f:
    for obj in panels + [dashboard]:
        f.write(json.dumps(obj) + "\n")

print(f"Wrote {len(panels)} visualizations + 1 dashboard")
