'use client'

import { Card } from '@/components/ui/card'
import { WorkloadBubbles } from './components/workload-bubbles'
import type { WorkloadMember } from '@/app/actions/workload'

function formatHours(hours: number) {
  const rounded = Math.round(hours)
  if (rounded === 0 && hours > 0) return `${hours.toFixed(1)}h`
  return `${rounded}h`
}

function memberName(member: WorkloadMember) {
  return member.full_name || member.email
}

export function WorkloadClient({ members }: { members: WorkloadMember[] }) {
  if (members.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
        No teammates to show. People marked as excluded from utilisation are hidden here.
      </div>
    )
  }

  const valueScaleMax = Math.max(
    1,
    ...members.flatMap((member) => member.projects.map((project) => project.hours))
  )

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {members.map((member) => {
        const projectCount = member.projects.length
        return (
          <Card
            key={member.id}
            className="relative overflow-hidden rounded-xl border-slate-800 bg-slate-950 py-0 text-white shadow-sm"
          >
            <div className="pointer-events-none absolute left-6 top-6 z-10">
              <h2 className="text-base font-semibold tracking-tight">{memberName(member)}</h2>
              <p className="text-sm text-slate-400">
                {projectCount} project{projectCount === 1 ? '' : 's'} · {formatHours(member.total_hours)}
              </p>
            </div>
            <div className="h-[320px] w-full">
              {projectCount === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Nothing on their plate
                </div>
              ) : (
                <WorkloadBubbles projects={member.projects} valueScaleMax={valueScaleMax} />
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
