'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import type { WorkloadMember, WorkloadPriorityItem } from '@/app/actions/workload'
import { format, parseISO } from 'date-fns'

type Scope = 'external' | 'internal'

function formatHours(hours: number) {
  const rounded = Math.round(hours)
  if (rounded === 0 && hours > 0) return `${hours.toFixed(1)}h`
  return `${rounded}h`
}

function memberName(member: WorkloadMember) {
  return member.full_name || member.email
}

function formatDue(date: string | null) {
  if (!date) return null
  try {
    return format(parseISO(date.slice(0, 10)), 'd MMM')
  } catch {
    return date
  }
}

function ScopeSwitch({
  scope,
  onScopeChange,
}: {
  scope: Scope
  onScopeChange: (scope: Scope) => void
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        type="button"
        className={
          scope === 'external'
            ? 'cursor-pointer font-medium text-foreground'
            : 'cursor-pointer text-muted-foreground'
        }
        onClick={() => onScopeChange('external')}
      >
        External
      </button>
      <Switch
        id="workload-priority-scope"
        checked={scope === 'internal'}
        onCheckedChange={(checked) => onScopeChange(checked ? 'internal' : 'external')}
        aria-label="Show internal priorities"
      />
      <button
        type="button"
        className={
          scope === 'internal'
            ? 'cursor-pointer font-medium text-foreground'
            : 'cursor-pointer text-muted-foreground'
        }
        onClick={() => onScopeChange('internal')}
      >
        Internal
      </button>
    </div>
  )
}

function PriorityRow({ item, rank }: { item: WorkloadPriorityItem; rank: number }) {
  const due = formatDue(item.due_date)

  return (
    <li className="flex gap-3 border-b py-3 last:border-b-0 last:pb-0">
      <span className="w-5 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-muted-foreground">
        {rank}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate font-medium leading-tight">{item.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {item.client_name ? `${item.client_name} · ` : ''}
          {formatHours(item.hours)} remaining
          {due ? ` · Due ${due}` : ''}
        </div>
      </div>
    </li>
  )
}

export function WorkloadPriorities({ members }: { members: WorkloadMember[] }) {
  const [scope, setScope] = useState<Scope>('external')
  const wantInternal = scope === 'internal'

  return (
    <section className="mt-10 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Top priorities</h2>
        <ScopeSwitch scope={scope} onScopeChange={setScope} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
        {members.map((member) => {
          const priorities = member.priorities.filter((item) => item.is_internal === wantInternal)
          return (
            <Card key={member.id} className="p-5">
              <h3 className="font-semibold">{memberName(member)}</h3>
              {priorities.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  {wantInternal ? 'No internal projects' : 'No external projects'}
                </p>
              ) : (
                <ol className="mt-2">
                  {priorities.map((item, index) => (
                    <PriorityRow key={item.id} item={item} rank={index + 1} />
                  ))}
                </ol>
              )}
            </Card>
          )
        })}
      </div>
    </section>
  )
}
