import { differenceInCalendarDays, parseISO } from 'date-fns'
import { getWorkloadPace, type WorkloadPace } from '@/lib/workload/pace'

export type { WorkloadPace }

export type WorkloadPriorityFlag =
  | 'working-on'
  | 'in-timeline'
  | 'starting-soon'
  | 'overdue'
  | 'due-soon'
  | 'critical'
  | 'high'
  | 'behind'
  | 'ahead'
  | 'over-budget'

export type WorkloadPriorityItem = {
  id: string
  name: string
  client_name: string | null
  hours: number
  is_internal: boolean
  monday_status: string | null
  priority_label: string | null
  pace: WorkloadPace
  due_date: string | null
  score: number
  flags: WorkloadPriorityFlag[]
}

type PriorityInput = {
  id: string
  name: string
  client_name: string | null
  hours: number
  quotedHours: number
  loggedHours: number
  isInternal: boolean
  mondayStatus: string | null
  mondayData: Record<string, unknown> | null
  dueDate: string | null
  createdAt: string | null
  projectTimelines: Array<{ start: string | null; end: string | null }>
  assignedTimelines: Array<{ start: string | null; end: string | null }>
  today: string
}

const PRIORITY_RANK: Array<{ pattern: RegExp; rank: number; flag: WorkloadPriorityFlag | null }> = [
  { pattern: /\b(critical|urgent)\b/i, rank: 3, flag: 'critical' },
  { pattern: /\bhigh\b/i, rank: 2, flag: 'high' },
  { pattern: /\bmedium\b/i, rank: 1, flag: null },
]

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function daysFromToday(value: string | null, today: string): number | null {
  const day = dateOnly(value)
  if (!day) return null
  return differenceInCalendarDays(parseISO(day), parseISO(today))
}

function columnText(column: unknown): string {
  if (!column || typeof column !== 'object') return ''
  const record = column as { text?: unknown; value?: unknown; label?: unknown }
  if (typeof record.text === 'string' && record.text.trim()) return record.text.trim()
  if (typeof record.label === 'string' && record.label.trim()) return record.label.trim()
  const value = record.value
  if (value && typeof value === 'object') {
    const label = (value as { label?: unknown }).label
    if (typeof label === 'string' && label.trim()) return label.trim()
  }
  return ''
}

function columnType(column: unknown): string {
  if (!column || typeof column !== 'object') return ''
  const type = (column as { type?: unknown }).type
  return typeof type === 'string' ? type : ''
}

/** Monday Priority is usually a colour column; fall back to a status labelled High/Critical/etc. */
export function extractProjectPriority(mondayData: Record<string, unknown> | null | undefined): {
  label: string | null
  rank: number
  flag: WorkloadPriorityFlag | null
} {
  if (!mondayData) return { label: null, rank: 0, flag: null }

  const columns = Object.values(mondayData)
  const colourColumns = columns.filter((column) => columnType(column) === 'color')
  const statusColumns = columns.filter((column) => {
    const type = columnType(column)
    return type === 'status' || type === 'dropdown'
  })

  for (const column of [...colourColumns, ...statusColumns]) {
    const text = columnText(column)
    if (!text) continue
    for (const candidate of PRIORITY_RANK) {
      if (candidate.pattern.test(text) && candidate.rank >= 2) {
        return { label: text, rank: candidate.rank, flag: candidate.flag }
      }
    }
  }

  for (const column of colourColumns) {
    const text = columnText(column)
    if (!text) continue
    for (const candidate of PRIORITY_RANK) {
      if (candidate.pattern.test(text)) {
        return { label: text, rank: candidate.rank, flag: candidate.flag }
      }
    }
  }

  return { label: null, rank: 0, flag: null }
}

export function isWorkingOnStatus(status: string | null | undefined) {
  return /working on/i.test(status ?? '')
}

export function scoreWorkloadPriority(input: PriorityInput): WorkloadPriorityItem {
  const flags: WorkloadPriorityFlag[] = []
  let score = 0

  const pace = getWorkloadPace({
    quotedHours: input.quotedHours,
    loggedHours: input.loggedHours,
    timelineStarts: input.projectTimelines.map((item) => item.start),
    timelineEnds: input.projectTimelines.map((item) => item.end),
    dueDate: input.dueDate,
    createdAt: input.createdAt,
  })

  const workingOn = isWorkingOnStatus(input.mondayStatus)
  if (workingOn) {
    flags.push('working-on')
    score += 35
  }

  const inTimeline = input.assignedTimelines.some((item) => {
    const start = dateOnly(item.start)
    const end = dateOnly(item.end)
    if (!start || !end) return false
    return start <= input.today && input.today <= end
  })
  if (inTimeline) {
    flags.push('in-timeline')
    score += 45
  } else {
    const nextStart = input.assignedTimelines
      .map((item) => daysFromToday(item.start, input.today))
      .filter((days): days is number => days != null && days >= 0)
      .sort((a, b) => a - b)[0]
    if (nextStart != null && nextStart <= 7) {
      flags.push('starting-soon')
      score += 25
    }
  }

  const dueIn = daysFromToday(input.dueDate, input.today)
  if (dueIn != null && dueIn < 0) {
    flags.push('overdue')
    score += 40
  } else if (dueIn != null && dueIn <= 7) {
    flags.push('due-soon')
    score += 30
  }

  const priority = extractProjectPriority(input.mondayData)
  if (priority.flag === 'critical') {
    flags.push('critical')
    score += 30
  } else if (priority.flag === 'high' && priority.rank >= 2) {
    flags.push('high')
    score += 18
  }

  if (pace === 'behind') {
    flags.push('behind')
    score += 22
  } else if (pace === 'over-budget') {
    flags.push('over-budget')
    score += 16
  } else if (pace === 'ahead') {
    flags.push('ahead')
    score -= 18
  }

  return {
    id: input.id,
    name: input.name,
    client_name: input.client_name,
    hours: input.hours,
    is_internal: input.isInternal,
    monday_status: input.mondayStatus,
    priority_label: priority.label,
    pace,
    due_date: input.dueDate,
    score,
    flags,
  }
}

export function sortPriorityItems(items: WorkloadPriorityItem[]): WorkloadPriorityItem[] {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.due_date && b.due_date && a.due_date !== b.due_date) {
      return a.due_date.localeCompare(b.due_date)
    }
    if (a.due_date && !b.due_date) return -1
    if (!a.due_date && b.due_date) return 1
    if (b.hours !== a.hours) return b.hours - a.hours
    return a.name.localeCompare(b.name)
  })
}
