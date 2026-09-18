'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { packCircles } from '@/lib/workload/pack-circles'
import type { WorkloadProject } from '@/app/actions/workload'

const CLIENT_FILL = '80, 140, 196'
const INTERNAL_FILL = '100, 5, 255'
const LEAD_FILL = '212, 168, 55'

function formatHours(hours: number) {
  const rounded = Math.round(hours)
  if (rounded === 0 && hours > 0) return `${hours.toFixed(1)}h`
  return `${rounded}h`
}

function truncateLabel(name: string, radius: number) {
  const maxChars = Math.max(4, Math.floor(radius / 4.2))
  if (name.length <= maxChars) return name
  return `${name.slice(0, Math.max(3, maxChars - 1)).trimEnd()}…`
}

function bubbleOpacity(progress: number) {
  return 0.22 + (1 - progress) * 0.73
}

export function WorkloadBubbles({
  projects,
  valueScaleMax,
}: {
  projects: WorkloadProject[]
  valueScaleMax: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const update = () => {
      const rect = el.getBoundingClientRect()
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const packed = useMemo(() => {
    const leftGutter = size.width >= 420 ? 168 : 24
    const packWidth = Math.max(0, size.width - leftGutter - 12)
    const packHeight = Math.max(0, size.height - 24)
    return packCircles(
      projects.map((project) => ({ id: project.id, value: project.hours })),
      packWidth,
      packHeight,
      {
        offsetX: leftGutter,
        offsetY: 12,
        valueScaleMax,
        // Height is the same on every card, so the same hours map to the same pixel radius.
        maxRadius: packHeight * 0.3,
      }
    )
  }, [projects, size.height, size.width, valueScaleMax])

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )

  const hovered = hoveredId ? projectById.get(hoveredId) : null
  const hoveredCircle = hoveredId ? packed.find((circle) => circle.id === hoveredId) : null

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {size.width > 0 && (
        <svg
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="img"
          aria-label="Projects on this person's plate"
        >
          {packed.map((circle) => {
            const project = projectById.get(circle.id)
            if (!project) return null
            const fill = project.is_lead
              ? LEAD_FILL
              : project.is_internal
                ? INTERNAL_FILL
                : CLIENT_FILL
            const opacity = bubbleOpacity(project.progress)
            const showName = circle.r >= 28
            const showHours = circle.r >= 18
            const label = truncateLabel(project.name, circle.r)
            const isHovered = hoveredId === circle.id

            return (
              <g
                key={circle.id}
                className="cursor-default"
                onMouseEnter={() => setHoveredId(circle.id)}
                onMouseLeave={() => setHoveredId((current) => (current === circle.id ? null : current))}
              >
                <circle
                  cx={circle.x}
                  cy={circle.y}
                  r={circle.r}
                  fill={`rgba(${fill}, ${opacity})`}
                  stroke={
                    isHovered
                      ? 'rgba(255, 255, 255, 0.45)'
                      : `rgba(255, 255, 255, ${0.06 + (1 - project.progress) * 0.14})`
                  }
                  strokeWidth={isHovered ? 1.5 : 1}
                />
                {showHours && (
                  <text
                    x={circle.x}
                    y={circle.y}
                    textAnchor="middle"
                    dominantBaseline={showName ? 'auto' : 'middle'}
                    fill="rgba(255,255,255,0.92)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {showName && (
                      <tspan
                        x={circle.x}
                        dy="-0.35em"
                        fontSize={Math.max(9, Math.min(13, circle.r / 4.6))}
                        fontWeight={500}
                      >
                        {label}
                      </tspan>
                    )}
                    <tspan
                      x={circle.x}
                      dy={showName ? '1.25em' : '0'}
                      fontSize={Math.max(9, Math.min(12, circle.r / 5.2))}
                      fill="rgba(255,255,255,0.78)"
                    >
                      {formatHours(project.hours)}
                    </tspan>
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {hovered && hoveredCircle && (
        <div
          className="pointer-events-none absolute z-20 max-w-[220px] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 shadow-lg"
          style={{
            left: Math.min(size.width - 230, Math.max(8, hoveredCircle.x + hoveredCircle.r + 8)),
            top: Math.max(8, hoveredCircle.y - 28),
          }}
        >
          <div className="font-medium">{hovered.name}</div>
          {hovered.client_name && <div className="text-slate-400">{hovered.client_name}</div>}
          {hovered.is_lead ? (
            <div className="mt-1 text-slate-300">
              {hovered.quoted_hours > 0
                ? `${formatHours(hovered.quoted_hours)} quoted`
                : 'No hours quoted'}
              {' · Lead'}
            </div>
          ) : (
            <>
              <div className="mt-1 text-slate-300">
                {hovered.quoted_hours > 0
                  ? `${formatHours(hovered.hours)} remaining of ${formatHours(hovered.quoted_hours)}`
                  : `${formatHours(hovered.hours)} logged`}
                {hovered.is_internal ? ' · Internal' : ''}
              </div>
              <div className="text-slate-400">{Math.round(hovered.progress * 100)}% progressed</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
