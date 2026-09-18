'use client'

import { Check } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { WorkloadCompletedItem, WorkloadMember } from '@/app/actions/workload'
import { format, parseISO } from 'date-fns'

function formatHours(hours: number) {
  const rounded = Math.round(hours)
  if (rounded === 0 && hours > 0) return `${hours.toFixed(1)}h`
  return `${rounded}h`
}

function memberName(member: WorkloadMember) {
  return member.full_name || member.email
}

function formatCompletedDate(date: string) {
  try {
    return format(parseISO(date.slice(0, 10)), 'd MMM')
  } catch {
    return date
  }
}

function CompletedRow({ item }: { item: WorkloadCompletedItem }) {
  const detail = [
    item.client_name,
    item.kind === 'task' ? item.project_name : null,
    formatCompletedDate(item.completed_date),
    item.hours > 0 ? formatHours(item.hours) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="flex gap-3 border-b py-3 last:border-b-0 last:pb-0">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate font-medium leading-tight">{item.name}</div>
        {detail ? <div className="truncate text-xs text-muted-foreground">{detail}</div> : null}
      </div>
    </li>
  )
}

export function WorkloadCompleted({ members }: { members: WorkloadMember[] }) {
  return (
    <section className="mt-10 space-y-4">
      <h2 className="text-lg font-semibold">Recently completed</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
        {members.map((member) => (
          <Card key={member.id} className="p-5">
            <h3 className="font-semibold">{memberName(member)}</h3>
            {member.completed.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">Nothing in the last two weeks</p>
            ) : (
              <ul className="mt-2">
                {member.completed.map((item) => (
                  <CompletedRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </section>
  )
}
