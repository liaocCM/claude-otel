# Observability Explainer

A small, runnable frontend that **visually explains an OpenTelemetry observability pipeline** for Claude Code, built with [React Flow](https://reactflow.dev/) (the `reactflow` v11 package), Vite and React 18.

It diagrams how telemetry flows:

```
Claude Code (CLI)  →  OpenTelemetry Collector  →  Elasticsearch  →  Kibana
        │  OTLP gRPC :4317        │  _bulk :9200        │  query :5601
        └── Metrics · Logs/Events · Traces ──┘
```

## What it shows

- **Four main nodes** left to right: Claude Code (CLI), OpenTelemetry Collector, Elasticsearch, Kibana.
- **Animated edges** labeled with protocol/port: `OTLP gRPC :4317`, `_bulk :9200`, `query :5601`.
- **Three signal nodes** — Metrics, Logs / Events, Traces — flowing from Claude Code into the Collector.
- A **custom node component** (`src/PipelineNode.jsx`): rounded cards with an emoji icon, title and one-line role subtitle.
- React Flow **MiniMap**, **Controls** and a dotted **Background**.
- A fixed **right-side panel** explaining each component and the key data it handles
  (e.g. Elasticsearch stores the `logs-*`, `metrics-*`, `traces-*` data streams).
- A **header bar** and a modern **dark theme**.

## Prerequisites

- Node.js 18+ (Node 18 or 20 recommended)
- npm (ships with Node)

## Run it

```bash
cd observability-explainer
npm install
npm run dev
```

Then open the URL Vite prints (default: <http://localhost:5173>).

## Other scripts

```bash
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

## Project structure

```
observability-explainer/
├── index.html            # Vite entry HTML
├── package.json          # scripts + dependencies
├── vite.config.js        # Vite + React plugin config
├── README.md
└── src/
    ├── main.jsx          # React entry point
    ├── App.jsx           # React Flow canvas, nodes, edges, side panel
    ├── PipelineNode.jsx  # custom rounded-card node component
    └── index.css         # dark theme styles
```

## Notes

The diagram is illustrative — the ports and data streams shown (`:4317`, `:9200`, `:5601`,
`logs-*`, `metrics-*`, `traces-*`) match the typical defaults for an OpenTelemetry → Elastic
setup, but no live services are contacted. It's a static, interactive explainer you can pan,
zoom and read.
