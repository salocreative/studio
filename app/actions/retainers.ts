'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export interface RetainerClient {
  id: string
  client_name: string
  display_order: number
  monthly_hours: number | null
  rollover_hours: number | null
  start_date: string | null
  agreed_days_per_week: number | null
  agreed_days_per_month: number | null
  hours_per_day: number | null
  created_at: string
  updated_at: string
}

export interface RetainerShareLink {
  id: string
  retainer_client_id: string
  share_token: string
  created_by: string | null
  created_at: string
  expires_at: string | null
  is_active: boolean
}

export interface MonthlyProjectData {
  month: string // YYYY-MM format
  projects: Array<{
    id: string
    name: string
    status: string
    tasks: Array<{
      id: string
      name: string
      quoted_hours: number | null
      timeline_start: string | null
      timeline_end: string | null
      time_entries: Array<{
        id: string
        date: string
        hours: number
        notes: string | null
        user_name: string | null
      }>
      total_hours: number
    }>
  }>
}

/**
 * Get all retainer clients
 */
export async function getRetainerClients() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('retainer_clients')
      .select('*')
      .order('display_order', { ascending: true })
      .order('client_name', { ascending: true })

    if (error) throw error

    return { success: true, clients: (data || []) as RetainerClient[] }
  } catch (error) {
    console.error('Error fetching retainer clients:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch retainer clients' }
  }
}

/**
 * Add a client to retainers (admin only)
 */
export async function addRetainerClient(clientName: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Get the highest display_order to append new client
    const { data: existing } = await supabase
      .from('retainer_clients')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1)
      .single()

    const displayOrder = existing?.display_order != null ? existing.display_order + 1 : 0

    const { data, error } = await supabase
      .from('retainer_clients')
      .insert({
        client_name: clientName.trim(),
        display_order: displayOrder,
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, client: data as RetainerClient }
  } catch (error) {
    console.error('Error adding retainer client:', error)
    return { error: error instanceof Error ? error.message : 'Failed to add retainer client' }
  }
}

/**
 * Update retainer client settings (admin only)
 */
export async function updateRetainerClient(
  clientId: string,
  monthlyHours: number | null,
  rolloverHours: number | null,
  startDate: string | null,
  agreedDaysPerWeek: number | null,
  agreedDaysPerMonth: number | null,
  hoursPerDay: number | null
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('retainer_clients')
      .update({
        monthly_hours: monthlyHours,
        rollover_hours: rolloverHours,
        start_date: startDate,
        agreed_days_per_week: agreedDaysPerWeek,
        agreed_days_per_month: agreedDaysPerMonth,
        hours_per_day: hoursPerDay,
      })
      .eq('id', clientId)
      .select()
      .single()

    if (error) throw error

    return { success: true, client: data as RetainerClient }
  } catch (error) {
    console.error('Error updating retainer client:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update retainer client' }
  }
}

/**
 * Remove a client from retainers (admin only)
 */
export async function removeRetainerClient(clientId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { error } = await supabase
      .from('retainer_clients')
      .delete()
      .eq('id', clientId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error removing retainer client:', error)
    return { error: error instanceof Error ? error.message : 'Failed to remove retainer client' }
  }
}

/**
 * Get all available client names from projects
 */
export async function getAvailableClients() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Get all unique client names from projects
    const { data, error } = await supabase
      .from('monday_projects')
      .select('client_name')
      .not('client_name', 'is', null)
      .neq('client_name', '')

    if (error) throw error

    // Get unique client names and sort
    const uniqueClients = Array.from(
      new Set((data || []).map(p => p.client_name).filter(Boolean))
    ).sort() as string[]

    return { success: true, clients: uniqueClients }
  } catch (error) {
    console.error('Error fetching available clients:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch available clients' }
  }
}

/**
 * Get retainer data for a client, grouped by month
 */
export async function getRetainerData(clientName: string, startDate?: string, endDate?: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Get retainer client info to check start_date and get monthly_hours
    const { data: retainerClient } = await supabase
      .from('retainer_clients')
      .select('start_date, monthly_hours, rollover_hours, agreed_days_per_week, agreed_days_per_month, hours_per_day')
      .eq('client_name', clientName)
      .single()

    // Use retainer start_date if provided, otherwise use the startDate parameter
    const effectiveStartDate = retainerClient?.start_date || startDate

    // Get all projects for this client
    let projectsQuery = supabase
      .from('monday_projects')
      .select('id, name, status, created_at, completed_date')
      .eq('client_name', clientName)

    // Filter by start_date if provided (only include time entries after the start date)
    // We'll filter time entries later, but we need all projects first
    const { data: projects, error: projectsError } = await projectsQuery
      .order('created_at', { ascending: false })

    if (projectsError) throw projectsError

    if (!projects || projects.length === 0) {
      return { success: true, data: [] }
    }

    const projectIds = projects.map(p => p.id)

    // Get all tasks for these projects
    const { data: tasks, error: tasksError } = await supabase
      .from('monday_tasks')
      .select('id, name, project_id, quoted_hours, timeline_start, timeline_end')
      .in('project_id', projectIds)
      .eq('is_subtask', true)

    if (tasksError) throw tasksError

    // Get all time entries for these projects
    // Use admin client to bypass RLS and get all time entries
    const adminClient = await createAdminClient()
    if (!adminClient) {
      return { error: 'Admin client not available' }
    }

    let timeEntriesQuery = adminClient
      .from('time_entries')
      .select('id, task_id, project_id, date, hours, notes, user_id')
      .in('project_id', projectIds)

    // Filter time entries by retainer start_date if provided
    if (effectiveStartDate) {
      timeEntriesQuery = timeEntriesQuery.gte('date', effectiveStartDate)
    }

    const { data: timeEntries, error: timeEntriesError } = await timeEntriesQuery
      .order('date', { ascending: true })

    if (timeEntriesError) throw timeEntriesError

    // Get all users to map user_id to user names
    const { data: users } = await adminClient
      .from('users')
      .select('id, full_name')
      .is('deleted_at', null)

    const usersMap = new Map((users || []).map(u => [u.id, u.full_name]))

    // Group data by month
    const monthlyData: Record<string, MonthlyProjectData['projects']> = {}

    for (const project of projects) {
      const projectTasks = (tasks || []).filter(t => t.project_id === project.id)

      for (const task of projectTasks) {
        const taskTimeEntries = (timeEntries || []).filter(te => te.task_id === task.id)
        
        // Determine which months this task belongs to based on time entries and timeline
        const months = new Set<string>()
        
        // Add months from time entries
        taskTimeEntries.forEach(te => {
          const date = new Date(te.date)
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          months.add(monthKey)
        })

        // Add months from timeline if available, but only if timeline is on/after start_date
        if (task.timeline_start) {
          const timelineStart = new Date(task.timeline_start)
          const timelineEnd = task.timeline_end ? new Date(task.timeline_end) : new Date()
          
          // Only include timeline months if timeline starts on/after the retainer start_date
          if (!effectiveStartDate || timelineStart >= new Date(effectiveStartDate)) {
            const startDate = effectiveStartDate ? new Date(Math.max(timelineStart.getTime(), new Date(effectiveStartDate).getTime())) : timelineStart
            const current = new Date(startDate)
            
            while (current <= timelineEnd) {
              const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`
              months.add(monthKey)
              current.setMonth(current.getMonth() + 1)
            }
          }
        }

        // Only add task to months if it has time entries or timeline dates (i.e., months set is not empty)
        if (months.size === 0) {
          continue // Skip this task if it has no relevant months
        }

        // Add task to each relevant month
        months.forEach(monthKey => {
          if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = []
          }

          let monthProject = monthlyData[monthKey].find(p => p.id === project.id)
          if (!monthProject) {
            monthProject = {
              id: project.id,
              name: project.name,
              status: project.status,
              tasks: [],
            }
            monthlyData[monthKey].push(monthProject)
          }

          const totalHours = taskTimeEntries.reduce((sum, te) => sum + (te.hours || 0), 0)

          monthProject.tasks.push({
            id: task.id,
            name: task.name,
            quoted_hours: task.quoted_hours,
            timeline_start: task.timeline_start,
            timeline_end: task.timeline_end,
            time_entries: taskTimeEntries.map(te => ({
              id: te.id,
              date: te.date,
              hours: te.hours,
              notes: te.notes,
              user_name: usersMap.get((te as any).user_id) || null,
            })),
            total_hours: totalHours,
          })
        })
      }
    }

    // Calculate remaining hours from active projects (status !== 'locked')
    // For each active project, calculate: sum of task quoted_hours - sum of task logged hours
    let remainingProjectHours = 0
    const activeProjects = (projects || []).filter(p => p.status !== 'locked')
    const activeProjectIds = new Set(activeProjects.map(p => p.id))
    
    // Aggregate hours by project and task
    const projectHoursMap = new Map<string, { quoted: number; logged: number }>()
    
    // Initialize map for active projects
    activeProjects.forEach(p => {
      projectHoursMap.set(p.id, { quoted: 0, logged: 0 })
    })
    
    // Aggregate from tasks
    ;(tasks || []).forEach(task => {
      if (activeProjectIds.has(task.project_id)) {
        const projectData = projectHoursMap.get(task.project_id) || { quoted: 0, logged: 0 }
        const quotedHours = task.quoted_hours ? Number(task.quoted_hours) : 0
        projectData.quoted += quotedHours
        projectHoursMap.set(task.project_id, projectData)
      }
    })
    
    // Aggregate logged hours from time entries
    ;(timeEntries || []).forEach(entry => {
      const task = (tasks || []).find(t => t.id === entry.task_id)
      if (task && activeProjectIds.has(task.project_id)) {
        const projectData = projectHoursMap.get(task.project_id) || { quoted: 0, logged: 0 }
        projectData.logged += Number(entry.hours || 0)
        projectHoursMap.set(task.project_id, projectData)
      }
    })
    
    // Calculate remaining hours (quoted - logged, but don't go negative)
    projectHoursMap.forEach((data, projectId) => {
      const remaining = Math.max(0, data.quoted - data.logged)
      remainingProjectHours += remaining
    })

    // Convert to array and sort by month
    const result: MonthlyProjectData[] = Object.entries(monthlyData)
      .map(([month, projects]) => ({
        month,
        projects: projects.map(p => ({
          ...p,
          tasks: p.tasks.sort((a, b) => {
            // Sort tasks by timeline_start if available, otherwise by name
            if (a.timeline_start && b.timeline_start) {
              return a.timeline_start.localeCompare(b.timeline_start)
            }
            return a.name.localeCompare(b.name)
          }),
        })),
      }))
      .sort((a, b) => b.month.localeCompare(a.month)) // Most recent first

    // Filter by date range if provided
    let filteredResult = result
    if (startDate || endDate) {
      filteredResult = result.filter(item => {
        const monthStart = `${item.month}-01`
        if (startDate && monthStart < startDate) return false
        if (endDate) {
          const monthEnd = new Date(`${item.month}-01`)
          monthEnd.setMonth(monthEnd.getMonth() + 1)
          monthEnd.setDate(0) // Last day of month
          if (monthEnd.toISOString().split('T')[0] > endDate) return false
        }
        return true
      })
    }

    return { 
      success: true, 
      data: filteredResult,
      monthly_hours: retainerClient?.monthly_hours || null,
      rollover_hours: retainerClient?.rollover_hours || null,
      agreed_days_per_week: retainerClient?.agreed_days_per_week || null,
      agreed_days_per_month: retainerClient?.agreed_days_per_month || null,
      hours_per_day: retainerClient?.hours_per_day || null,
      remaining_project_hours: remainingProjectHours,
    }
  } catch (error) {
    console.error('Error fetching retainer data:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch retainer data' }
  }
}

/**
 * Get retainer client ID by client name
 */
export async function getRetainerClientIdByName(clientName: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('retainer_clients')
      .select('id')
      .eq('client_name', clientName)
      .single()

    if (error) throw error

    return { success: true, id: data.id }
  } catch (error) {
    console.error('Error fetching retainer client ID:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch retainer client ID' }
  }
}

/**
 * Create a public share link for a retainer client (admin only)
 */
export async function createRetainerShareLink(retainerClientId: string, expiresAt?: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Generate a unique token
    const shareToken = crypto.randomBytes(32).toString('hex')

    const { data, error } = await supabase
      .from('retainer_share_links')
      .insert({
        retainer_client_id: retainerClientId,
        share_token: shareToken,
        created_by: user.id,
        expires_at: expiresAt || null,
        is_active: true,
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, shareLink: data as RetainerShareLink }
  } catch (error) {
    console.error('Error creating share link:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create share link' }
  }
}

/**
 * Get retainer client by share token (public access)
 */
export async function getRetainerClientByToken(shareToken: string) {
  const supabase = await createAdminClient()

  if (!supabase) {
    return { error: 'Admin client not available' }
  }

  try {
    const { data, error } = await supabase
      .from('retainer_share_links')
      .select(`
        *,
        retainer_client:retainer_clients(*)
      `)
      .eq('share_token', shareToken)
      .eq('is_active', true)
      .single()

    if (error) throw error

    if (!data) {
      return { error: 'Share link not found or inactive' }
    }

    // Check if expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { error: 'Share link has expired' }
    }

    return { success: true, shareLink: data as any, client: (data as any).retainer_client as RetainerClient }
  } catch (error) {
    console.error('Error fetching share link:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch share link' }
  }
}

/**
 * Get all share links for a retainer client (admin only)
 */
export async function getRetainerShareLinks(retainerClientId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('retainer_share_links')
      .select('*')
      .eq('retainer_client_id', retainerClientId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return { success: true, shareLinks: (data || []) as RetainerShareLink[] }
  } catch (error) {
    console.error('Error fetching share links:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch share links' }
  }
}

/**
 * Deactivate a share link (admin only)
 */
export async function deactivateShareLink(shareLinkId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { error } = await supabase
      .from('retainer_share_links')
      .update({ is_active: false })
      .eq('id', shareLinkId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error deactivating share link:', error)
    return { error: error instanceof Error ? error.message : 'Failed to deactivate share link' }
  }
}

