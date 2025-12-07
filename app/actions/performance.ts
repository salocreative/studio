'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { startOfMonth, endOfMonth, eachDayOfInterval, getDay, format } from 'date-fns'

interface TeamMemberUtilization {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'designer' | 'employee'
  hours_logged: number
  available_hours: number
  utilization_percentage: number
  days_worked: number
}

interface DayBreakdown {
  date: string
  dayName: string
  isWeekend: boolean
  users: {
    userId: string
    userName: string
    hoursLogged: number
    percentage: number
  }[]
  totalHoursLogged: number
  expectedHours: number
  totalPercentage: number
}

/**
 * Calculate utilization for all team members
 * @param startDate - Start date for the period (ISO string)
 * @param endDate - End date for the period (ISO string)
 */
export async function getTeamUtilization(startDate?: string, endDate?: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if user is admin (or allow all authenticated users to view performance?)
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  // Allow admin and designer roles to view performance
  if (userProfile?.role !== 'admin' && userProfile?.role !== 'designer') {
    return { error: 'Unauthorized: Admin or Designer access required' }
  }

  // Use admin client to bypass RLS and fetch all users
  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin API not available. Please configure SUPABASE_SERVICE_ROLE_KEY.' }
  }

  try {
    // Default to current month if no dates provided
    const periodStart = startDate ? new Date(startDate) : startOfMonth(new Date())
    const periodEnd = endDate ? new Date(endDate) : endOfMonth(new Date())

    // Get all users using admin client (bypasses RLS)
    const { data: users, error: usersError } = await adminClient
      .from('users')
      .select('*')
      .order('full_name', { ascending: true, nullsFirst: false })

    if (usersError) throw usersError

    if (!users || users.length === 0) {
      return { success: true, members: [] }
    }

    // Calculate available working days (excluding weekends)
    const workingDays = eachDayOfInterval({
      start: periodStart,
      end: periodEnd,
    }).filter((date) => {
      const dayOfWeek = getDay(date)
      return dayOfWeek !== 0 && dayOfWeek !== 6 // Exclude Sunday (0) and Saturday (6)
    })

    // Standard expected hours per day
    const expectedHoursPerDay = 6
    const totalAvailableHours = workingDays.length * expectedHoursPerDay

    // Get all time entries for the period
    const startDateStr = format(periodStart, 'yyyy-MM-dd')
    const endDateStr = format(periodEnd, 'yyyy-MM-dd')

    const { data: timeEntries, error: timeEntriesError } = await supabase
      .from('time_entries')
      .select('user_id, hours, date')
      .gte('date', startDateStr)
      .lte('date', endDateStr)

    if (timeEntriesError) throw timeEntriesError

    // Aggregate hours by user
    const hoursByUser: Record<string, { hours: number; days: Set<string> }> = {}
    
    // Aggregate hours by user and date for daily breakdown
    const hoursByUserAndDate: Record<string, Record<string, number>> = {}
    const userMap = new Map(users.map((u: any) => [u.id, u]))

    if (timeEntries) {
      timeEntries.forEach((entry: any) => {
        const userId = entry.user_id
        const date = entry.date
        const hours = Number(entry.hours) || 0
        
        // Overall aggregation
        if (!hoursByUser[userId]) {
          hoursByUser[userId] = { hours: 0, days: new Set() }
        }
        hoursByUser[userId].hours += hours
        hoursByUser[userId].days.add(date)
        
        // Daily breakdown aggregation
        if (!hoursByUserAndDate[date]) {
          hoursByUserAndDate[date] = {}
        }
        if (!hoursByUserAndDate[date][userId]) {
          hoursByUserAndDate[date][userId] = 0
        }
        hoursByUserAndDate[date][userId] += hours
      })
    }

    // Build utilization data for each user
    const members: TeamMemberUtilization[] = users.map((user: any) => {
      const userHours = hoursByUser[user.id]?.hours || 0
      const daysWorked = hoursByUser[user.id]?.days.size || 0
      const utilization = totalAvailableHours > 0
        ? (userHours / totalAvailableHours) * 100
        : 0

      return {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        hours_logged: userHours,
        available_hours: totalAvailableHours,
        utilization_percentage: utilization,
        days_worked: daysWorked,
      }
    })

    // Sort by utilization percentage (descending)
    members.sort((a, b) => b.utilization_percentage - a.utilization_percentage)

    // Get leads for future capacity planning
    const { data: leads } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, quoted_hours')
      .eq('status', 'lead')

    const totalLeadsHours = leads?.reduce((sum, lead) => {
      return sum + (lead.quoted_hours ? Number(lead.quoted_hours) : 0)
    }, 0) || 0

    // Build daily breakdown
    const allDays = eachDayOfInterval({
      start: periodStart,
      end: periodEnd,
    })

    const dailyBreakdown: DayBreakdown[] = allDays.map((date) => {
      const dateStr = format(date, 'yyyy-MM-dd')
      const dayOfWeek = getDay(date)
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
      const dayName = format(date, 'EEEE, MMM d') // e.g., "Monday, Jan 15"
      
      const dayEntries = hoursByUserAndDate[dateStr] || {}
      const dayUsers: DayBreakdown['users'] = []
      let totalHoursForDay = 0
      
      // Get hours logged for each user on this day
      users.forEach((user: any) => {
        const hoursLogged = dayEntries[user.id] || 0
        const percentage = expectedHoursPerDay > 0 ? (hoursLogged / expectedHoursPerDay) * 100 : 0
        totalHoursForDay += hoursLogged
        
        dayUsers.push({
          userId: user.id,
          userName: user.full_name || user.email,
          hoursLogged,
          percentage,
        })
      })
      
      // Calculate total percentage based on number of users and expected hours
      const totalExpectedHours = isWeekend ? 0 : users.length * expectedHoursPerDay
      const totalPercentage = totalExpectedHours > 0 
        ? (totalHoursForDay / totalExpectedHours) * 100 
        : 0
      
      return {
        date: dateStr,
        dayName,
        isWeekend,
        users: dayUsers,
        totalHoursLogged: totalHoursForDay,
        expectedHours: totalExpectedHours,
        totalPercentage,
      }
    })

    return {
      success: true,
      members,
      period: {
        start: startDateStr,
        end: endDateStr,
        working_days: workingDays.length,
        total_available_hours: totalAvailableHours,
      },
      futureCapacity: {
        totalLeadsHours,
        leadsCount: leads?.length || 0,
      },
      dailyBreakdown,
    }
  } catch (error) {
    console.error('Error fetching team utilization:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch team utilization' }
  }
}

