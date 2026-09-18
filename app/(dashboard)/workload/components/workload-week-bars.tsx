'use client'

import { useState } from 'react'
import type { WorkloadWeekPeak } from '@/app/actions/workload'

const FILL = '80, 140, 196'
const OVER_FILL = '232, 168, 90'

function formatHours(hours: number) {
  const rounded = Math.round(hours)
  if (rounded === 0 && hours > 0) return `${hours.toFixed(1)}h`
  return `${rounded}h`
}

function loadRatio(week: WorkloadWeekPeak) {
  if (week.capacity > 0) return week.hours / week.capacity
  return week.hours > 0 ? 2 : 0
}

export function WorkloadWeekBars({ weeks }: { weeks: WorkloadWeekPeak[] }) {
  const [hoveredStart, setHoveredStart] = useState<string | null>(null)
  const hovered = weeks.find((week) => week.weekStart === hoveredStart)

  if (weeks.length === 0) return null

  return (
    <div className="absolute bottom-5 left-6 z-10">
      <div className="flex items-end gap-1.5" role="img" aria-label="Workload this week and the next two">
        {weeks.map((week) => {
          const load = loadRatio(week)
          const fillPct = Math.min(100, load * 100)
          const over = load > 1.02
          const isHovered = hoveredStart === week.weekStart

          return (
            <div
              key={week.weekStart}
              className="flex flex-col items-center"
              onMouseEnter={() => setHoveredStart(week.weekStart)}
              onMouseLeave={() => setHoveredStart((current) => (current === week.weekStart ? null : current))}
            >
              <div className="relative h-24 w-2.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="absolute bottom-0 w-full rounded-full"
                  style={{
                    height: `${fillPct}%`,
                    background: `rgba(${over ? OVER_FILL : FILL}, ${isHovered ? 1 : 0.92})`,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {hovered && (
        <div className="pointer-events-none absolute bottom-full left-0 mb-2 w-max max-w-[200px] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 shadow-lg">
          <div className="font-medium">{hovered.label}</div>
          <div className="mt-1 text-slate-300">
            {formatHours(hovered.hours)} scheduled of {formatHours(hovered.capacity)} capacity
          </div>
          {loadRatio(hovered) > 1.02 && (
            <div className="text-slate-400">{Math.round(loadRatio(hovered) * 100)}% booked</div>
          )}
        </div>
      )}
    </div>
  )
}
