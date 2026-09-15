import { eachDayOfInterval, format, getDay } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Statuses on the Annual Leave board that mean the person is not available. */
const CAPACITY_REDUCING_STATUSES = new Set([
  'approved',
  'completed',
  'before sarah joined',
])

export function isCapacityReducingStatus(status: string | null | undefined): boolean {
  return CAPACITY_REDUCING_STATUSES.has((status || '').trim().toLowerCase())
}

export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

export function isWeekday(date: Date): boolean {
  const dayOfWeek = getDay(date)
  return dayOfWeek !== 0 && dayOfWeek !== 6
}

/** Monday–Friday dates in [start, end], inclusive, as YYYY-MM-DD in local time. */
export function weekdayDatesInRange(start: string, end: string): string[] {
  const startDate = parseDateOnly(start)
  const endDate = parseDateOnly(end)
  if (!startDate || !endDate || endDate < startDate) return []

  return eachDayOfInterval({ start: startDate, end: endDate })
    .filter(isWeekday)
    .map((date) => format(date, 'yyyy-MM-dd'))
}

/**
 * Spread a leave request across weekdays in its timeline.
 * `days` is the Monday "Number of days" value (0.5 for a half day). When it is
 * missing, every weekday in the timeline is treated as a full day off.
 * Extra weekdays beyond `days` stay as working days (timelines often include
 * weekends and buffer days).
 */
export function allocateLeaveFractions(
  start: string,
  end: string,
  days: number | null | undefined
): Map<string, number> {
  const weekdays = weekdayDatesInRange(start, end)
  const result = new Map<string, number>()
  if (weekdays.length === 0) return result

  const amount = days == null || !Number.isFinite(days) || days <= 0 ? weekdays.length : days
  let remaining = amount
  for (const date of weekdays) {
    if (remaining <= 0) break
    const fraction = Math.min(1, remaining)
    result.set(date, fraction)
    remaining -= fraction
  }
  return result
}

export type HolidayRequestRow = {
  user_id: string
  start_date: string
  end_date: string
  days: number | null
}

/**
 * Per user, per date, 0–1 fraction of the day that is leave.
 * Overlapping requests on the same day are added, then capped at 1.
 */
export function buildLeaveFractionByUserDate(
  requests: HolidayRequestRow[]
): Record<string, Record<string, number>> {
  const byUser: Record<string, Record<string, number>> = {}

  for (const request of requests) {
    if (!request.user_id || !request.start_date || !request.end_date) continue
    const start = String(request.start_date).slice(0, 10)
    const end = String(request.end_date).slice(0, 10)
    const days = request.days == null ? null : Number(request.days)
    const fractions = allocateLeaveFractions(start, end, Number.isFinite(days as number) ? days : null)

    if (!byUser[request.user_id]) byUser[request.user_id] = {}
    for (const [date, fraction] of fractions) {
      byUser[request.user_id][date] = Math.min(1, (byUser[request.user_id][date] || 0) + fraction)
    }
  }

  return byUser
}

function isMissingTableError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return (
    code === '42P01' ||
    code === 'PGRST116' ||
    msg.includes('does not exist') ||
    msg.includes('relation') ||
    msg.includes('schema cache')
  )
}

/** Approved / completed leave overlapping [start, end]. Empty if the table is not migrated yet. */
export async function loadCapacityReducingLeave(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<HolidayRequestRow[]> {
  const { data, error } = await supabase
    .from('holiday_requests')
    .select('user_id, start_date, end_date, days')
    .eq('reduces_capacity', true)
    .not('user_id', 'is', null)
    .lte('start_date', endDate)
    .gte('end_date', startDate)

  if (error) {
    if (!isMissingTableError(error)) {
      console.error('holiday_requests:', error)
    }
    return []
  }

  return (data ?? [])
    .filter((row): row is HolidayRequestRow & { user_id: string } => Boolean(row.user_id))
    .map((row) => ({
      user_id: String(row.user_id),
      start_date: String(row.start_date).slice(0, 10),
      end_date: String(row.end_date).slice(0, 10),
      days: row.days == null ? null : Number(row.days),
    }))
}
