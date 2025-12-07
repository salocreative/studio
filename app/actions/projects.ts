'use server'

import { createClient } from '@/lib/supabase/server'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'

interface ProjectWithTimeTracking {
  id: string
  name: string
  client_name: string | null
  status: 'active' | 'archived' | 'locked'
  quoted_hours: number | null
  total_logged_hours: number
  tasks: Array<{
    id: string
    name: string
    quoted_hours: number | null
    logged_hours: number
    time_left: number | null
  }>
}

/**
 * Get all projects with time tracking data (all users, not just current user)
 */
export async function getProjectsWithTimeTracking() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Get Flexi-Design board IDs to exclude from Projects page
    const flexiDesignBoardIds = await getFlexiDesignBoardIds()
    
    // Build query - exclude Flexi-Design boards
    let projectsQuery = supabase
      .from('monday_projects')
      .select('*')
      .in('status', ['active', 'locked'])
      .order('name', { ascending: true })
    
    // Exclude Flexi-Design boards from Projects page
    // Since Supabase doesn't have direct "not in" syntax, filter client-side
    let projects: any[] = []
    if (flexiDesignBoardIds.size > 0) {
      const { data: allProjects, error: projectsError } = await supabase
        .from('monday_projects')
        .select('*')
        .in('status', ['active', 'locked'])
        .order('name', { ascending: true })
      
      if (projectsError) throw projectsError
      
      const flexiIds = Array.from(flexiDesignBoardIds)
      projects = (allProjects || []).filter(p => !flexiIds.includes(p.monday_board_id))
    } else {
      const { data: allProjects, error: projectsError } = await projectsQuery
      if (projectsError) throw projectsError
      projects = allProjects || []
    }

    if (!projects || projects.length === 0) {
      return { success: true, projects: [] }
    }

    // Get all tasks for these projects
    const projectIds = projects.map((p) => p.id)
    const { data: tasks, error: tasksError } = await supabase
      .from('monday_tasks')
      .select('*')
      .in('project_id', projectIds)
      .eq('is_subtask', true)

    if (tasksError) throw tasksError

    // Get all time entries for these projects
    // Query by project_id to ensure we get ALL entries, even if tasks were deleted
    // This is important for completed/locked projects where tasks might no longer exist in Monday
    let timeEntriesByTask: Record<string, number> = {}
    let timeEntriesByProject: Record<string, number> = {}
    
    // First, get time entries by project_id (this ensures we get all entries for completed projects)
    const { data: allTimeEntries, error: timeEntriesError } = await supabase
      .from('time_entries')
      .select('task_id, project_id, hours')
      .in('project_id', projectIds)

    if (timeEntriesError) throw timeEntriesError

    // Aggregate hours by task_id and project_id
    if (allTimeEntries) {
      for (const entry of allTimeEntries) {
        // Aggregate by task_id
        timeEntriesByTask[entry.task_id] = (timeEntriesByTask[entry.task_id] || 0) + Number(entry.hours)
        // Also aggregate by project_id as a backup
        timeEntriesByProject[entry.project_id] = (timeEntriesByProject[entry.project_id] || 0) + Number(entry.hours)
      }
    }

    // Build projects with time tracking data
    const projectsWithTracking: ProjectWithTimeTracking[] = projects.map((project) => {
      const projectTasks = (tasks || []).filter((task) => task.project_id === project.id)
      
      const tasksWithTracking = projectTasks.map((task) => {
        const loggedHours = timeEntriesByTask[task.id] || 0
        const quotedHours = task.quoted_hours ? Number(task.quoted_hours) : null
        const timeLeft = quotedHours !== null ? Math.max(0, quotedHours - loggedHours) : null

        return {
          id: task.id,
          name: task.name,
          quoted_hours: quotedHours,
          logged_hours: loggedHours,
          time_left: timeLeft,
        }
      })

      // Calculate total project hours
      const totalQuotedHours = tasksWithTracking.reduce((sum, task) => {
        return sum + (task.quoted_hours || 0)
      }, 0)

      // Calculate logged hours - use project-level aggregation for completed projects
      // This ensures we get all time entries even if tasks structure changed
      const totalLoggedHoursFromTasks = tasksWithTracking.reduce((sum, task) => {
        return sum + task.logged_hours
      }, 0)
      
      // For completed/locked projects, use project-level time entry total to ensure accuracy
      // This is important because tasks might have been restructured or deleted in Monday
      const projectLevelTotal = timeEntriesByProject[project.id] || 0
      
      // Use the maximum of task-based and project-based totals to ensure we capture all time
      // This handles edge cases where time entries might not be perfectly linked to tasks
      const totalLoggedHours = project.status === 'locked' 
        ? Math.max(totalLoggedHoursFromTasks, projectLevelTotal)
        : totalLoggedHoursFromTasks

      return {
        id: project.id,
        name: project.name,
        client_name: project.client_name,
        status: project.status,
        quoted_hours: project.quoted_hours ? Number(project.quoted_hours) : null,
        total_logged_hours: totalLoggedHours,
        tasks: tasksWithTracking,
      }
    })

    return { success: true, projects: projectsWithTracking }
  } catch (error) {
    console.error('Error fetching projects with time tracking:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch projects' }
  }
}

/**
 * Get detailed project information with time entries by user and latest entries
 */
export async function getProjectDetails(projectId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Get project
    const { data: project, error: projectError } = await supabase
      .from('monday_projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (projectError) throw projectError
    if (!project) {
      return { error: 'Project not found' }
    }

    // Get all time entries for this project
    const { data: timeEntries, error: timeEntriesError } = await supabase
      .from('time_entries')
      .select(`
        id,
        hours,
        date,
        notes,
        user_id,
        task_id,
        task:monday_tasks(name)
      `)
      .eq('project_id', projectId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    if (timeEntriesError) throw timeEntriesError

    // Get all users (using admin client to bypass RLS)
    const { createAdminClient } = await import('@/lib/supabase/server')
    const adminClient = await createAdminClient()
    
    let allUsers: any[] = []
    if (adminClient) {
      const { data: users } = await adminClient
        .from('users')
        .select('id, email, full_name')
      allUsers = users || []
    }

    // Aggregate hours by user
    const hoursByUser: Record<string, { 
      userId: string
      userName: string
      userEmail: string
      totalHours: number
    }> = {}

    if (timeEntries) {
      timeEntries.forEach((entry: any) => {
        const userId = entry.user_id
        const hours = Number(entry.hours) || 0
        
        if (!hoursByUser[userId]) {
          const user = allUsers.find(u => u.id === userId) || entry.user
          hoursByUser[userId] = {
            userId,
            userName: user?.full_name || user?.email || 'Unknown User',
            userEmail: user?.email || '',
            totalHours: 0,
          }
        }
        hoursByUser[userId].totalHours += hours
      })
    }

    // Get latest time entries (limit to 20 most recent)
    const latestEntries = (timeEntries || []).slice(0, 20).map((entry: any) => {
      const user = allUsers.find(u => u.id === entry.user_id)
      return {
        id: entry.id,
        hours: Number(entry.hours) || 0,
        date: entry.date,
        notes: entry.notes || null,
        taskName: entry.task?.name || 'Unknown Task',
        userName: user?.full_name || user?.email || 'Unknown User',
        userEmail: user?.email || '',
      }
    })

    // Convert hoursByUser to array and sort by total hours (descending)
    const userTotals = Object.values(hoursByUser)
      .sort((a, b) => b.totalHours - a.totalHours)

    return {
      success: true,
      project: {
        id: project.id,
        name: project.name,
        client_name: project.client_name,
        status: project.status,
        quoted_hours: project.quoted_hours ? Number(project.quoted_hours) : null,
      },
      userTotals,
      latestEntries,
    }
  } catch (error) {
    console.error('Error fetching project details:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch project details' }
  }
}

