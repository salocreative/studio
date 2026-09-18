'use client'

import { useState } from 'react'
import type { WorkloadWeekPeak } from '@/app/actions/workload'

const FILL_RED = '232, 72, 80'
const FILL_ORANGE = '245, 140, 48'
const FILL_GREEN = '52, 196, 120'

function formatHours(hours: number) {
  const rounded = Math.round(hours)
  if (rounded === 0 && hours > 0) return `${hours.toFixed(1)}h`
  return `${rounded}h`
}

function loadRatio(week: WorkloadWeekPeak) {
  if (week.capacity > 0) return week.hours / week.capacity
  return week.hours > 0 ? 2 : 0
}

/** Booked % of capacity: quiet and overloaded are red; healthy is green. */
function loadFill(load: number) {
  const pct = load * 100
  if (pct < 25 || pct >= 150) return FILL_RED
  if (pct < 50 || pct >= 100) return FILL_ORANGE
  return FILL_GREEN
}

export function WorkloadWeekBars({ weeks }: { weeks: WorkloadWeekPeak[] }) {
  const [hoveredStart, setHoveredStart] = useState<string | null>(null)
  const hovered = weeks.find((week) => week.weekStart === hoveredStart)

  if (weeks.length === 0) return null

  return (
    <div className="absolute bottom-5 left-6 z-10">
      <div
        className="flex items-end gap-1.5"
        role="img"
        aria-label={
          weeks.length > 3
            ? 'Workload this week and the next five'
            : 'Workload this week and the next two'
        }
      >
        {weeks.map((week) => {
          const load = loadRatio(week)
          const fillPct = Math.min(100, load * 100)
          const isHovered = hoveredStart === week.weekStart
          const fill = loadFill(load)

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
                    background: `rgba(${fill}, ${isHovered ? 1 : 0.92})`,
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
          <div className="text-slate-400">{Math.round(loadRatio(hovered) * 100)}% booked</div>
        </div>
      )}
    </div>
  )
}
