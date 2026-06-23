import { useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  Position,
} from 'reactflow'
import 'reactflow/dist/style.css'

import PipelineNode from './PipelineNode.jsx'

const nodeTypes = { pipeline: PipelineNode }

// ---- Color accents shared between nodes, edges and the side panel ----------
const ACCENTS = {
  claude: '#d97757',
  collector: '#7c93ff',
  // ES stack
  elasticsearch: '#43c59e',
  kibana: '#f6b73c',
  // Grafana stack
  tempo: '#ff7eb6',
  loki: '#f6b73c',
  prometheus: '#e6522c',
  grafana: '#f46800',
  // Signal accents (shared)
  metrics: '#4cc9f0',
  logs: '#b388ff',
  traces: '#ff7eb6',
}

// ---- Shared building blocks ------------------------------------------------
const claudeNode = {
  id: 'claude',
  type: 'pipeline',
  position: { x: 0, y: 200 },
  data: {
    icon: '🤖',
    title: 'Claude Code (CLI)',
    subtitle: 'Emits OTLP telemetry while you code',
    accent: ACCENTS.claude,
  },
}

const signalNodes = [
  {
    id: 'metrics',
    type: 'pipeline',
    position: { x: 360, y: 0 },
    data: {
      icon: '📈',
      title: 'Metrics',
      subtitle: 'Token usage, cost, sessions',
      accent: ACCENTS.metrics,
      variant: 'signal',
      targetPosition: Position.Left,
      sourcePosition: Position.Bottom,
    },
  },
  {
    id: 'logs',
    type: 'pipeline',
    position: { x: 360, y: 410 },
    data: {
      icon: '📝',
      title: 'Logs / Events',
      subtitle: 'Prompts, tool calls, API requests',
      accent: ACCENTS.logs,
      variant: 'signal',
      targetPosition: Position.Left,
      sourcePosition: Position.Top,
    },
  },
  {
    id: 'traces',
    type: 'pipeline',
    position: { x: 360, y: 540 },
    data: {
      icon: '🧵',
      title: 'Traces',
      subtitle: 'Spans across tools & sub-agents',
      accent: ACCENTS.traces,
      variant: 'signal',
      targetPosition: Position.Left,
      sourcePosition: Position.Top,
    },
  },
]

const mainEdgeStyle = (color) => ({ stroke: color, strokeWidth: 2 })
const labeledEdge = (id, source, target, label, color) => ({
  id, source, target, label,
  animated: true,
  style: mainEdgeStyle(color),
  labelStyle: { fill: '#e6e9f5', fontWeight: 600, fontSize: 12 },
  labelBgStyle: { fill: '#1b2030', fillOpacity: 0.9 },
  labelBgPadding: [6, 4],
  labelBgBorderRadius: 6,
  markerEnd: { type: MarkerType.ArrowClosed, color },
})
const signalEdges = (collectorId = 'collector') =>
  [
    ['metrics', ACCENTS.metrics],
    ['logs', ACCENTS.logs],
    ['traces', ACCENTS.traces],
  ].flatMap(([signal, color]) => [
    {
      id: `e-claude-${signal}`,
      source: 'claude',
      target: signal,
      animated: true,
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: '4 4' },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    },
    {
      id: `e-${signal}-${collectorId}`,
      source: signal,
      target: collectorId,
      animated: true,
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: '4 4' },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    },
  ])

// ---- Architecture A: Elasticsearch + Kibana (+ Jaeger) ---------------------
const ARCH_ES = {
  key: 'es',
  label: 'ES + Kibana + Jaeger',
  tagline: 'Battle-tested, full-text search shines, mirrors your TutorABC setup',
  versionLine:
    'Elasticsearch 8.17 · Kibana 8.17 · Jaeger 1.62 · OTel Collector 0.135 · Claude Code 2.1.186',
  nodes: [
    claudeNode,
    {
      id: 'collector',
      type: 'pipeline',
      position: { x: 360, y: 200 },
      data: {
        icon: '📡',
        title: 'OTel Collector',
        subtitle: 'Receives, batches & fans out',
        accent: ACCENTS.collector,
      },
    },
    {
      id: 'elasticsearch',
      type: 'pipeline',
      position: { x: 720, y: 120 },
      data: {
        icon: '🗄️',
        title: 'Elasticsearch',
        subtitle: 'data streams: logs-* / metrics-* / traces-*',
        accent: ACCENTS.elasticsearch,
      },
    },
    {
      id: 'jaeger',
      type: 'pipeline',
      position: { x: 720, y: 320 },
      data: {
        icon: '🕸️',
        title: 'Jaeger',
        subtitle: 'In-memory trace store, OTLP receiver',
        accent: ACCENTS.tempo,
      },
    },
    {
      id: 'kibana',
      type: 'pipeline',
      position: { x: 1080, y: 120 },
      data: {
        icon: '📊',
        title: 'Kibana',
        subtitle: 'Aggregates · search · dashboard',
        accent: ACCENTS.kibana,
      },
    },
    {
      id: 'jaeger-ui',
      type: 'pipeline',
      position: { x: 1080, y: 320 },
      data: {
        icon: '🌊',
        title: 'Jaeger UI',
        subtitle: 'Single-trace waterfall view',
        accent: ACCENTS.tempo,
      },
    },
    ...signalNodes,
  ],
  edges: [
    labeledEdge('e-claude-collector', 'claude', 'collector', 'OTLP gRPC :4317', ACCENTS.collector),
    labeledEdge('e-collector-es', 'collector', 'elasticsearch', '_bulk :9200', ACCENTS.elasticsearch),
    labeledEdge('e-collector-jaeger', 'collector', 'jaeger', 'OTLP (traces)', ACCENTS.tempo),
    labeledEdge('e-es-kibana', 'elasticsearch', 'kibana', 'query :5601', ACCENTS.kibana),
    labeledEdge('e-jaeger-ui', 'jaeger', 'jaeger-ui', 'UI :16686', ACCENTS.tempo),
    ...signalEdges('collector'),
  ],
  panel: [
    {
      icon: '📡', title: 'OTel Collector', accent: ACCENTS.collector,
      text: 'One inbound OTLP receiver, two outbound exporters. Logs / metrics go only to ES; traces fan out to BOTH ES (for aggregates) and Jaeger (for the waterfall view).',
      data: 'Ports — receives :4317 gRPC, :4318 HTTP',
    },
    {
      icon: '🗄️', title: 'Elasticsearch', accent: ACCENTS.elasticsearch,
      text: 'Stores all three signal types as data streams. Indexed and queryable by Kibana via KQL. Full-text search on log content is its strength.',
      data: 'Data streams — logs-* · metrics-* · traces-*',
    },
    {
      icon: '🕸️', title: 'Jaeger', accent: ACCENTS.tempo,
      text: 'Dedicated trace store and UI. The OTel Collector pushes spans here in parallel with ES, so you can flip between aggregate analysis (Kibana) and per-trace waterfall (Jaeger).',
      data: 'Single-binary all-in-one · in-memory storage',
    },
    {
      icon: '📊', title: 'Kibana', accent: ACCENTS.kibana,
      text: 'Dashboards, Discover and ad-hoc KQL queries against ES. Great for aggregate views like "tokens by user" or "cost over time". Trace waterfall is weak — use Jaeger UI for that.',
      data: 'Pattern — http://localhost:5601',
    },
    {
      icon: '🌊', title: 'Jaeger UI', accent: ACCENTS.tempo,
      text: 'Renders one trace at a time as a horizontal waterfall — spans nest visually with duration bars. Click any span to inspect its attributes (model, tokens, tool_name, …).',
      data: 'Pattern — http://localhost:16686',
    },
  ],
}

// ---- Architecture B: Grafana LGTM (Loki/Grafana/Tempo + Prometheus) --------
const ARCH_GRAFANA = {
  key: 'grafana',
  label: 'Grafana LGTM stack',
  tagline: 'Cross-signal jumps in one UI, cheaper storage, community trend',
  versionLine:
    'Tempo 2.6 · Loki 3.3 · Prometheus 3.0 · Grafana 11.4 · OTel Collector 0.135 · Claude Code 2.1.186',
  nodes: [
    claudeNode,
    {
      id: 'collector',
      type: 'pipeline',
      position: { x: 360, y: 200 },
      data: {
        icon: '📡',
        title: 'OTel Collector',
        subtitle: 'Delta→cumulative · fans out 3-way',
        accent: ACCENTS.collector,
      },
    },
    {
      id: 'tempo',
      type: 'pipeline',
      position: { x: 720, y: 40 },
      data: {
        icon: '🧵',
        title: 'Tempo',
        subtitle: 'Trace backend (object-store native)',
        accent: ACCENTS.tempo,
      },
    },
    {
      id: 'loki',
      type: 'pipeline',
      position: { x: 720, y: 220 },
      data: {
        icon: '📝',
        title: 'Loki',
        subtitle: 'Label-indexed log store',
        accent: ACCENTS.loki,
      },
    },
    {
      id: 'prometheus',
      type: 'pipeline',
      position: { x: 720, y: 400 },
      data: {
        icon: '📈',
        title: 'Prometheus',
        subtitle: 'OTLP receiver + TSDB',
        accent: ACCENTS.prometheus,
      },
    },
    {
      id: 'grafana',
      type: 'pipeline',
      position: { x: 1080, y: 220 },
      data: {
        icon: '🎛️',
        title: 'Grafana',
        subtitle: 'One UI · cross-signal jumps',
        accent: ACCENTS.grafana,
      },
    },
    ...signalNodes,
  ],
  edges: [
    labeledEdge('e-claude-collector', 'claude', 'collector', 'OTLP gRPC :14317', ACCENTS.collector),
    labeledEdge('e-collector-tempo', 'collector', 'tempo', 'OTLP (traces)', ACCENTS.tempo),
    labeledEdge('e-collector-loki', 'collector', 'loki', 'OTLP HTTP (logs)', ACCENTS.loki),
    labeledEdge('e-collector-prom', 'collector', 'prometheus', 'OTLP HTTP (metrics)', ACCENTS.prometheus),
    labeledEdge('e-tempo-grafana', 'tempo', 'grafana', 'Tempo DS', ACCENTS.tempo),
    labeledEdge('e-loki-grafana', 'loki', 'grafana', 'Loki DS', ACCENTS.loki),
    labeledEdge('e-prom-grafana', 'prometheus', 'grafana', 'Prometheus DS', ACCENTS.prometheus),
    ...signalEdges('collector'),
  ],
  panel: [
    {
      icon: '📡', title: 'OTel Collector', accent: ACCENTS.collector,
      text: 'Fans out 3-way to three specialized backends. Adds a delta→cumulative processor on metrics because Prometheus only accepts cumulative.',
      data: 'Ports — :14317 gRPC, :14318 HTTP (offset from ES stack)',
    },
    {
      icon: '🧵', title: 'Tempo', accent: ACCENTS.tempo,
      text: 'Object-storage-native trace backend. Cheap at scale because it doesn\'t fully index spans — you find them via TraceQL or via cross-signal jumps from logs/metrics.',
      data: 'Pattern — traces queried in Grafana via Tempo data source',
    },
    {
      icon: '📝', title: 'Loki', accent: ACCENTS.loki,
      text: 'Indexes log labels only (service_name, etc.) rather than full text. Cheaper but full-text search is weaker than Elasticsearch. Resource attributes auto-promoted to labels.',
      data: 'Query — LogQL: {service_name="claude-code"}',
    },
    {
      icon: '📈', title: 'Prometheus', accent: ACCENTS.prometheus,
      text: 'Built-in OTLP receiver since v2.47. Metric names get flattened with underscores plus a unit/total suffix (e.g. claude_code_token_usage_tokens_total).',
      data: 'Query — PromQL with exemplars enabled (links to traces)',
    },
    {
      icon: '🎛️', title: 'Grafana', accent: ACCENTS.grafana,
      text: 'Single UI for all three backends. The headline feature: click a span in Tempo → jump to that time-window in Loki; click a metric exemplar → open the originating trace.',
      data: 'Pattern — http://localhost:13000',
    },
  ],
}

const ARCHS = [ARCH_ES, ARCH_GRAFANA]

// ---- Architecture comparison strip ----------------------------------------
const COMPARISON = [
  { label: 'Single UI', es: 'No — Kibana + Jaeger', grafana: 'Yes — Grafana only' },
  { label: 'Trace waterfall', es: 'Jaeger UI (great)', grafana: 'Tempo in Grafana (great)' },
  { label: 'Log full-text search', es: 'Excellent', grafana: 'Limited (label-based)' },
  { label: 'Cross-signal jumps', es: 'Manual (copy trace_id)', grafana: 'One click' },
  { label: 'Storage cost at scale', es: 'Higher (full index)', grafana: 'Lower (object store)' },
  { label: 'Fits with TutorABC', es: 'Drop-in next to arceus', grafana: 'New ecosystem' },
]

// ---- The App component -----------------------------------------------------
export default function App() {
  const [archKey, setArchKey] = useState('es')
  const arch = ARCHS.find((a) => a.key === archKey)

  const flowNodes = useMemo(() => arch.nodes, [arch])
  const flowEdges = useMemo(() => arch.edges, [arch])

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__logo" aria-hidden="true">⚡</span>
        <h1 className="app__title">
          Claude Code <span className="app__arrow">→</span> OpenTelemetry{' '}
          <span className="app__arrow">→</span> {arch.key === 'es' ? 'Elastic' : 'Grafana'} stack
        </h1>
        <span className="app__subtitle">{arch.tagline}</span>

        <div className="app__tabs" role="tablist">
          {ARCHS.map((a) => (
            <button
              key={a.key}
              role="tab"
              aria-selected={archKey === a.key}
              className={`app__tab ${archKey === a.key ? 'app__tab--active' : ''}`}
              onClick={() => setArchKey(a.key)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </header>

      <div className="app__body">
        <main className="app__canvas">
          <ReactFlow
            // re-mount on arch switch so fitView re-runs on the new graph
            key={arch.key}
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
            maxZoom={1.75}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#2a3145" />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(10, 13, 22, 0.65)"
              nodeColor={(n) => n.data?.accent || '#7c93ff'}
              style={{ backgroundColor: '#131826' }}
            />
            <Controls />
          </ReactFlow>
        </main>

        <aside className="app__panel">
          <h2 className="panel__heading">{arch.label}</h2>
          <p className="panel__intro">
            Telemetry flows left to right. Switch the tab above to compare the
            two architectures — same Claude Code, same Collector, different backends.
          </p>

          <ul className="panel__list">
            {arch.panel.map((item) => (
              <li
                key={item.title}
                className="panel__item"
                style={{ '--accent': item.accent }}
              >
                <div className="panel__item-head">
                  <span className="panel__item-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="panel__item-title">{item.title}</span>
                </div>
                <p className="panel__item-text">{item.text}</p>
                <p className="panel__item-data">{item.data}</p>
              </li>
            ))}
          </ul>

          <h3 className="panel__heading panel__heading--sub">Quick comparison</h3>
          <table className="panel__compare">
            <thead>
              <tr>
                <th></th>
                <th className={archKey === 'es' ? 'panel__compare-head--active' : ''}>ES</th>
                <th className={archKey === 'grafana' ? 'panel__compare-head--active' : ''}>Grafana</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label}>
                  <td className="panel__compare-label">{row.label}</td>
                  <td className={archKey === 'es' ? 'panel__compare-cell--active' : ''}>{row.es}</td>
                  <td className={archKey === 'grafana' ? 'panel__compare-cell--active' : ''}>{row.grafana}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="panel__footer">
            <span className="panel__chip" style={{ '--accent': ACCENTS.metrics }}>Metrics</span>
            <span className="panel__chip" style={{ '--accent': ACCENTS.logs }}>Logs / Events</span>
            <span className="panel__chip" style={{ '--accent': ACCENTS.traces }}>Traces</span>
          </div>
        </aside>
      </div>

      <footer className="app__versions">{arch.versionLine}</footer>
    </div>
  )
}
