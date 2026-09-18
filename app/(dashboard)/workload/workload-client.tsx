'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { WorkloadBubbles } from './components/workload-bubbles'
import { WorkloadCompleted } from './components/workload-completed'
import { WorkloadHeader } from './components/workload-header'
import { WorkloadLegend } from './components/workload-legend'
import { WorkloadPriorities } from './components/workload-priorities'
import { WorkloadWeekBars } from './components/workload-week-bars'
import type { WorkloadMember } from '@/app/actions/workload'
import { visibleWeekPeaks } from '@/lib/workload/week-peaks'

function formatHours(hours: number) {
  const rounded = Math.round(hours)
  if (rounded === 0 && hours > 0) return `${hours.toFixed(1)}h`
  return `${rounded}h`
}

function memberName(member: WorkloadMember) {
  return member.full_name || member.email
}

function withLeadVisibility(members: WorkloadMember[], showLeads: boolean): WorkloadMember[] {
  if (showLeads) return members
  return members.map((member) => {
    const projects = member.projects.filter((project) => !project.is_lead)
    return {
      ...member,
      projects,
      weeks: visibleWeekPeaks(member.weeks, false),
      total_hours: projects.reduce((sum, project) => sum + project.hours, 0),
    }
  })
}

export function WorkloadClient({ members }: { members: WorkloadMember[] }) {
  const [showLeads, setShowLeads] = useState(false)
  const visibleMembers = withLeadVisibility(members, showLeads)

  const valueScaleMax = Math.max(
    1,
    ...visibleMembers.flatMap((member) => member.projects.map((project) => project.hours))
  )

  return (
    <>
      <WorkloadHeader>
        <WorkloadLegend
          action={
            <Switch
              id="workload-show-leads"
              checked={showLeads}
              onCheckedChange={setShowLeads}
              aria-label="Show leads"
            />
          }
        />
      </WorkloadHeader>
      <div className="flex-1 overflow-y-auto p-6">
        {members.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            No teammates to show. People marked as excluded from utilisation are hidden here.
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {visibleMembers.map((member) => {
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
                    <WorkloadWeekBars weeks={member.weeks} />
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
            <WorkloadPriorities members={members} />
            <WorkloadCompleted members={members} />
          </div>
        )}
      </div>
    </>
  )
}
