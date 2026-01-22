'use server'

import { createAdminClient } from '@/lib/supabase/server'

/**
 * Get retainer data for a client (public access via share token)
 * This version uses admin client to bypass authentication
 */
export async function getRetainerDataPublic(clientName: string, startDate?: string, endDate?: string) {
  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin client not available' }
  }

  try {
    // Get retainer client info to check start_date
    const { data: retainerClient } = await adminClient
      .from('retainer_clients')
      .select('start_date, monthly_hours, rollover_hours, agreed_days_per_week, agreed_days_per_month, hours_per_day')
      .eq('client_name', clientName)
      .single()

    // Use retainer start_date if provided, otherwise use the startDate parameter
    const effectiveStartDate = retainerClient?.start_date || startDate

    // Get all projects for this client
    const { data: projects, error: projectsError } = await adminClient
      .from('monday_projects')
      .select('id, name, status, created_at, completed_date')
      .eq('client_name', clientName)
      .order('created_at', { ascending: false })

    if (projectsError) throw projectsError

    if (!projects || projects.length === 0) {
      return { success: true, data: [] }
    }

    const projectIds = projects.map(p => p.id)

    // Get all tasks for these projects
    const { data: tasks, error: tasksError } = await adminClient
      .from('monday_tasks')
      .select('id, name, project_id, quoted_hours, timeline_start, timeline_end')
      .in('project_id', projectIds)
      .eq('is_subtask', true)

    if (tasksError) throw tasksError

    // Get all time entries for these projects
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

    // Group data by month (same logic as getRetainerData)
    const monthlyData: Record<string, any[]> = {}

    for (const project of projects) {
      const projectTasks = (tasks || []).filter(t => t.project_id === project.id)

      for (const task of projectTasks) {
        const taskTimeEntries = (timeEntries || []).filter(te => te.task_id === task.id)
        
        const months = new Set<string>()
        
        taskTimeEntries.forEach(te => {
          const date = new Date(te.date)
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          months.add(monthKey)
        })

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

        months.forEach(monthKey => {
          if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = []
          }

          let monthProject = monthlyData[monthKey].find((p: any) => p.id === project.id)
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
              user_name: usersMap.get(te.user_id) || null,
            })),
            total_hours: totalHours,
          })
        })
      }
    }

    // Calculate remaining hours from active projects (status !== 'locked')
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

    const result = Object.entries(monthlyData)
      .map(([month, projects]) => ({
        month,
        projects: projects.map((p: any) => ({
          ...p,
          tasks: p.tasks.sort((a: any, b: any) => {
            if (a.timeline_start && b.timeline_start) {
              return a.timeline_start.localeCompare(b.timeline_start)
            }
            return a.name.localeCompare(b.name)
          }),
        })),
      }))
      .sort((a, b) => b.month.localeCompare(a.month))

    let filteredResult = result
    if (startDate || endDate) {
      filteredResult = result.filter(item => {
        const monthStart = `${item.month}-01`
        if (startDate && monthStart < startDate) return false
        if (endDate) {
          const monthEnd = new Date(`${item.month}-01`)
          monthEnd.setMonth(monthEnd.getMonth() + 1)
          monthEnd.setDate(0)
          if (monthEnd.toISOString().split('T')[0] > endDate) return false
        }
        return true
      })
    }

    return { success: true, data: filteredResult, remaining_project_hours: remainingProjectHours }
  } catch (error) {
    console.error('Error fetching retainer data:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch retainer data' }
  }
}

