# Claude Code telemetry — signals reference

What Claude Code emits over OpenTelemetry, and how it lands in this stack's
Elasticsearch. Verified against the official docs **and** the live data this
demo collected (Claude Code 2.1.186).

> **ES field note** — with the collector's `mapping.mode: otel`:
> - metric value → `metrics.<metric.name>` (e.g. `metrics.claude_code.token.usage`)
> - dimensions   → `attributes.<key>` (e.g. `attributes.type`)
> - identity     → `resource.attributes.<key>` (metrics) / `attributes.<key>` (logs)
> - time field   → `@timestamp` on every signal
> String trace attributes are `text` with a `.keyword` subfield → aggregate on
> `attributes.<key>.keyword`.

---

## Metrics — 8 built-in

| Metric | Unit | Meaning | Key attributes |
|---|---|---|---|
| `claude_code.session.count` | count | CLI sessions started | — |
| `claude_code.token.usage` | tokens | Tokens consumed | `type`, `model` |
| `claude_code.cost.usage` | USD | Estimated cost | `model` |
| `claude_code.lines_of_code.count` | count | Lines changed | `type` (`added` / `removed`) |
| `claude_code.pull_request.count` | count | PRs created | — |
| `claude_code.commit.count` | count | Commits created | — |
| `claude_code.code_edit_tool.decision` | count | Edit-permission decisions | `decision`, `tool_name`, `language`, `source` |
| `claude_code.active_time.total` | s | Active time | — |

**Precision notes (from live data):**

- `token.usage` `type` has **four** values, not "input/output/cache":
  `input` · `output` · `cacheRead` · `cacheCreation` (cache is split into
  read vs. creation — they price differently).
- `code_edit_tool.decision` carries `decision` (`accept`/`reject`), `tool_name`
  (e.g. `Write`), `language` (e.g. `Markdown`), and `source` (e.g. `config`).
- `pull_request.count` and `commit.count` are real but only emit when Claude
  actually opens a PR / makes a commit — none appeared in this demo.
- Counters use **delta** temporality by default.

---

## Events (logs) — 5 documented core events

These are the events in the official docs' main table. All verified correct.

| Event | Fires when | Key fields |
|---|---|---|
| `user_prompt` | User submits a prompt | `prompt_length` (+ `prompt` text only if `OTEL_LOG_USER_PROMPTS=1`) |
| `tool_result` | A tool call finishes | `tool_name`, `success`, `duration_ms`, `error`¹, `tool_use_id` |
| `api_request` | An API call to Claude | `model`, `cost_usd`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `request_id` |
| `api_error` | An API call fails | `model`, `error`, `status_code`, `duration_ms`, `attempt` |
| `tool_decision` | A permission decision | `tool_name`, `decision` (`accept`/`reject`), `source`, `tool_use_id` |

¹ `error` on `tool_result` is **conditional** — present only when `success=false`.

**Important caveats:**

- **There are more than 5 events.** This is the documented *core subset*. Claude
  Code actually emits ~20 event types. This demo additionally observed
  `at_mention`; the full set also includes `api_refusal`,
  `mcp_server_connection`, `compaction`, `permission_mode_changed`,
  `skill_activated`, `hook_*`, `auth`, `plugin_*`, `internal_error`, and more.
  So phrase it as "5 core events," not "5 events total."
- **`user_prompt` is interactive-mostly.** Running headless (`claude -p "..."`)
  in this demo produced `api_request` / `tool_result` / `tool_decision` but **no**
  `user_prompt` event. It shows up in interactive sessions.
- Every event also carries `prompt.id` (correlates all events from one prompt),
  `session.id`, `event.sequence`, and `event.timestamp`.

---

## Traces (beta) — span hierarchy

Enabled with `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`. One span tree per prompt:

```
claude_code.interaction                  (root, per prompt)
├── claude_code.llm_request              (each API call)
└── claude_code.tool                     (each tool use)
    ├── claude_code.tool.execution       (actual run)
    └── claude_code.tool.blocked_on_user (permission wait)
```

Key span attributes:
- `interaction`: `user_prompt`, `interaction.sequence`, `interaction.duration_ms`
- `llm_request`: `model`, `duration_ms`, `ttft_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `stop_reason`, `success`
- `tool`: `tool_name`, `duration_ms`, `file_path` (Read/Edit/Write), `full_command` (Bash)

> ES needs a `traces-*` data-stream template (it ships ones for `logs-*` /
> `metrics-*` but not traces) — registered by `scripts/setup-kibana.sh`.

---

## Standard attributes (on every signal)

`service.name` (`claude-code`), `session.id`, `user.id`, `user.email`,
`user.account_uuid`, `organization.id`, `terminal.type`, plus anything set via
`OTEL_RESOURCE_ATTRIBUTES` (here: `service.namespace=claude-code-demo`,
`deployment.environment=dev`).

Some are toggleable: `OTEL_METRICS_INCLUDE_SESSION_ID`,
`OTEL_METRICS_INCLUDE_ACCOUNT_UUID`, `OTEL_METRICS_INCLUDE_VERSION`.

---

*Source: [Claude Code monitoring docs](https://code.claude.com/docs/en/monitoring-usage) cross-checked against this stack's live Elasticsearch data.*
