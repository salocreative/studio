import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { weekdayDatesInRange } from '@/lib/holidays/working-days'
import { expectedHoursPerDay } from '@/lib/time-tracking/status'

export const WEEK_PEAK_COUNT = 3
export const WEEK_PEAK_COUNT_WITH_LEADS = 6

export type WorkloadWeekPeak = {
  weekStart: string
  label: string
  shortLabel: string
  liveHours: number
  leadHours: number
  hours: number
  capacity: number
}

export function workloadWeekStarts(today: string): string[] {
  const monday = startOfWeek(parseISO(today), { weekStartsOn: 1 })
  return Array.from({ length: WEEK_PEAK_COUNT_WITH_LEADS }, (_, offset) =>
    format(addDays(monday, offset * 7), 'yyyy-MM-dd')
  )
}

export function workloadHorizonEnd(weekStarts: string[]): string {
  const lastMonday = weekStarts[weekStarts.length - 1]
  return format(addDays(parseISO(lastMonday), 4), 'yyyy-MM-dd')
}

export function weekIndexForDate(date: string, weekStarts: string[]): number {
  for (let i = 0; i < weekStarts.length; i++) {
    const weekStart = weekStarts[i]
    const weekEnd = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd')
    if (date >= weekStart && date <= weekEnd) return i
  }
  return -1
}

export function remainingTimelineDays(
  timelineStart: string | null | undefined,
  timelineEnd: string | null | undefined,
  today: string
): string[] {
  const start = timelineStart?.slice(0, 10) || null
  const end = timelineEnd?.slice(0, 10) || null
  if (!start && !end) return []

  const from = start && start > today ? start : today
  const to = end || start || today
  if (to < from) return []
  return weekdayDatesInRange(from, to)
}

export function allocateHoursToWeeks(
  hours: number,
  days: string[],
  weekStarts: string[]
): number[] {
  const buckets = weekStarts.map(() => 0)
  if (hours <= 0) return buckets
  if (days.length === 0) {
    buckets[0] += hours
    return buckets
  }

  const perDay = hours / days.length
  for (const day of days) {
    const index = weekIndexForDate(day, weekStarts)
    if (index >= 0) buckets[index] += perDay
  }
  return buckets
}

export function weekCapacity(
  weekStart: string,
  today: string,
  expectedUtilizationPercentage: number | null | undefined,
  leaveByDate: Record<string, number>
): number {
  const friday = format(addDays(parseISO(weekStart), 4), 'yyyy-MM-dd')
  if (friday < today) return 0

  const from = weekStart < today ? today : weekStart
  const days = weekdayDatesInRange(from, friday)
  const perDay = expectedHoursPerDay(expectedUtilizationPercentage)
  return days.reduce((sum, date) => sum + perDay * (1 - (leaveByDate[date] || 0)), 0)
}

export function emptyWeekPeaks(
  weekStarts: string[],
  today: string,
  expectedUtilizationPercentage: number | null | undefined,
  leaveByDate: Record<string, number>
): WorkloadWeekPeak[] {
  return weekStarts.map((weekStart, index) => {
    const dateLabel = format(parseISO(weekStart), 'd MMM')
    const isCurrent = index === 0
    return {
      weekStart,
      label: isCurrent ? 'This week' : `Week of ${dateLabel}`,
      shortLabel: isCurrent ? 'This' : dateLabel,
      liveHours: 0,
      leadHours: 0,
      hours: 0,
      capacity: weekCapacity(weekStart, today, expectedUtilizationPercentage, leaveByDate),
    }
  })
}

export function visibleWeekPeaks(weeks: WorkloadWeekPeak[], showLeads: boolean): WorkloadWeekPeak[] {
  const visible = showLeads ? weeks : weeks.slice(0, WEEK_PEAK_COUNT)
  return visible.map((week) => ({
    ...week,
    hours: showLeads ? week.liveHours + week.leadHours : week.liveHours,
  }))
}
