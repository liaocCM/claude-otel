import { memo } from 'react'
import { Handle, Position } from 'reactflow'

/**
 * Custom React Flow node: a rounded card with an emoji icon, a title, and a
 * one-line subtitle describing the component's role in the pipeline.
 *
 * data = {
 *   icon: string (emoji),
 *   title: string,
 *   subtitle: string,
 *   accent: string (css color),
 *   variant: 'main' | 'signal',
 *   sourcePosition, targetPosition (optional reactflow Position overrides)
 * }
 */
function PipelineNode({ data }) {
  const {
    icon,
    title,
    subtitle,
    accent = '#7c93ff',
    variant = 'main',
    targetPosition = Position.Left,
    sourcePosition = Position.Right,
  } = data

  return (
    <div
      className={`pipeline-node pipeline-node--${variant}`}
      style={{ '--accent': accent }}
    >
      <Handle type="target" position={targetPosition} className="pipeline-handle" />

      <div className="pipeline-node__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="pipeline-node__body">
        <div className="pipeline-node__title">{title}</div>
        {subtitle ? (
          <div className="pipeline-node__subtitle">{subtitle}</div>
        ) : null}
      </div>

      <Handle type="source" position={sourcePosition} className="pipeline-handle" />
    </div>
  )
}

export default memo(PipelineNode)
