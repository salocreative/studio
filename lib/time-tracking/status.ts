import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, format, startOfWeek } from 'date-fns'

/** Full-time expected hours per weekday. Matches Performance / utilisation. */
export const BASE_HOURS_PER_DAY = 6

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

/** Logged-day statuses. `upcoming` is a weekday after today in Europe/London. */
export type TimesheetDayStatus = 'complete' | 'partial' | 'missing' | 'upcoming'

export type WeeklyTimesheetMember = {
  name: string
  days: Record<WeekdayKey, TimesheetDayStatus>
}

export function todayInLondon(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
}

export function capacityMultiplier(expectedUtilizationPercentage: number | null | undefined): number {
  const pct = expectedUtilizationPercentage ?? 100
  const clamped = Math.min(100, Math.max(0, Number(pct)))
  return clamped / 100
}

export function expectedHoursPerDay(expectedUtilizationPercentage: number | null | undefined): number {
  return BASE_HOURS_PER_DAY * capacityMultiplier(expectedUtilizationPercentage)
}

export function classifyLoggedHours(
  hoursLogged: number,
  expectedHours: number
): Exclude<TimesheetDayStatus, 'upcoming'> {
  if (expectedHours <= 0) return 'complete'
  if (hoursLogged <= 0) return 'missing'
  if (hoursLogged < expectedHours) return 'partial'
  return 'complete'
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

/** Monday of the week containing `weekStart` (or the current London week if omitted). */
export function resolveWeekStartMonday(weekStart?: string): { weekStart: string } | { error: string } {
  const source = weekStart?.trim() || todayInLondon()
  const parsed = parseDateOnly(source)
  if (!parsed) {
    return { error: 'week_start must be a calendar date (YYYY-MM-DD)' }
  }

  const monday = startOfWeek(parsed, { weekStartsOn: 1 })
  return { weekStart: format(monday, 'yyyy-MM-dd') }
}

function displayFirstName(fullName: string | null | undefined, email: string | null | undefined): string {
  const full = (fullName || '').trim()
  if (full) return full.split(/\s+/)[0]
  const local = (email || '').split('@')[0]?.trim()
  return local || 'Unknown'
}

export async function getWeeklyTimesheetStatus(
  supabase: SupabaseClient,
  options?: { weekStart?: string }
): Promise<{ week_start: string; team: WeeklyTimesheetMember[] } | { error: string }> {
  const resolved = resolveWeekStartMonday(options?.weekStart)
  if ('error' in resolved) return resolved

  const monday = parseDateOnly(resolved.weekStart)
  if (!monday) return { error: 'week_start must be a calendar date (YYYY-MM-DD)' }

  const friday = addDays(monday, 4)
  const weekStart = resolved.weekStart
  const weekEnd = format(friday, 'yyyy-MM-dd')
  const today = todayInLondon()

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, full_name, email, expected_utilization_percentage')
    .eq('exclude_from_utilization', false)
    .is('deleted_at', null)
    .order('full_name', { ascending: true, nullsFirst: false })

  if (usersError) {
    console.error('Error loading users for timesheet status:', usersError)
    return { error: 'Failed to load timesheet status' }
  }

  const teamUsers = users || []
  const hoursByUserAndDate: Record<string, Record<string, number>> = {}

  if (teamUsers.length > 0) {
    const { data: timeEntries, error: timeEntriesError } = await supabase
      .from('time_entries')
      .select('user_id, hours, date')
      .gte('date', weekStart)
      .lte('date', weekEnd)

    if (timeEntriesError) {
      console.error('Error loading time entries for timesheet status:', timeEntriesError)
      return { error: 'Failed to load timesheet status' }
    }

    for (const entry of timeEntries || []) {
      const userId = String(entry.user_id)
      const date = String(entry.date || '').slice(0, 10)
      const hours = Number(entry.hours) || 0
      if (!hoursByUserAndDate[userId]) hoursByUserAndDate[userId] = {}
      hoursByUserAndDate[userId][date] = (hoursByUserAndDate[userId][date] || 0) + hours
    }
  }

  const team: WeeklyTimesheetMember[] = teamUsers.map((user) => {
    const expected = expectedHoursPerDay(user.expected_utilization_percentage)
    const userHours = hoursByUserAndDate[String(user.id)] || {}
    const days = {} as Record<WeekdayKey, TimesheetDayStatus>

    WEEKDAY_KEYS.forEach((key, index) => {
      const dateStr = format(addDays(monday, index), 'yyyy-MM-dd')
      if (dateStr > today) {
        days[key] = 'upcoming'
        return
      }
      days[key] = classifyLoggedHours(userHours[dateStr] || 0, expected)
    })

    return {
      name: displayFirstName(user.full_name, user.email),
      days,
    }
  })

  return { week_start: weekStart, team }
}
