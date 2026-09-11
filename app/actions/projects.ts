'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getMondayBoardConfig } from '@/lib/monday/board-helpers'

export interface ProjectDesigner {
  id: string
  full_name: string | null
  email: string | null
  hours: number
}

interface ProjectWithTimeTracking {
  id: string
  name: string
  client_name: string | null
  agency: string | null
  completed_date: string | null
  due_date: string | null
  created_at: string
  status: 'active' | 'archived' | 'locked'
  quoted_hours: number | null
  total_logged_hours: number
  designers: ProjectDesigner[]
  tasks: Array<{
    id: string
    name: string
    quoted_hours: number | null
    logged_hours: number
    time_left: number | null
    timeline_start: string | null
    timeline_end: string | null
  }>
}

/** PostgREST puts `.in()` values in the query string; too many UUIDs overflow Node's header limit. */
const IN_FILTER_CHUNK_SIZE = 80
const PAGE_SIZE = 500

const PROJECT_LIST_COLUMNS =
  'id, name, client_name, agency, completed_date, due_date, created_at, status, quoted_hours'

type QueryPageResult<T> = { data: T[] | null; error: { message: string } | null }

async function fetchByIdChunks<T>(
  ids: string[],
  queryPage: (chunk: string[], from: number, to: number) => PromiseLike<QueryPageResult<T>>
): Promise<T[]> {
  const rows: T[] = []
  for (let i = 0; i < ids.length; i += IN_FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_FILTER_CHUNK_SIZE)
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await queryPage(chunk, from, from + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      const page = data ?? []
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  }
  return rows
}

/**
 * Get all projects with time tracking data (all users, not just current user).
 *
 * `statusFilter` chooses both the status and the board set. 'locked' (Completed Projects)
 * searches Main boards ∪ `monday_completed_boards`, so a finished ad-hoc job still shows
 * after it is moved onto "25-26: Completed - Projects". Flexi-Design boards and the Flexi
 * completed archive are never included. Omitted, or 'active', stays Main-boards-only so
 * the live Projects list is unchanged.
 */
export async function getProjectsWithTimeTracking(statusFilter?: 'active' | 'locked') {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const {
      mainBoardIds,
      completedBoardIds,
      flexiBoardIds,
      flexiCompletedBoardId,
    } = await getMondayBoardConfig()

    const flexiIds = new Set(flexiBoardIds)
    if (flexiCompletedBoardId) flexiIds.add(flexiCompletedBoardId)

    const boardIds = new Set(
      statusFilter === 'locked'
        ? [...mainBoardIds, ...completedBoardIds].filter((id) => !flexiIds.has(id))
        : mainBoardIds
    )

    if (boardIds.size === 0) {
      return { success: true, projects: [] }
    }

    const statuses = statusFilter ? [statusFilter] : ['active', 'locked']
    const projects = await fetchByIdChunks(
      Array.from(boardIds),
      (boardChunk, from, to) =>
        supabase
          .from('monday_projects')
          .select(PROJECT_LIST_COLUMNS)
          .in('status', statuses)
          .in('monday_board_id', boardChunk)
          .order('name', { ascending: true })
          .range(from, to)
    )

    if (projects.length === 0) {
      return { success: true, projects: [] }
    }

    const projectIds = projects.map((p) => p.id)

    const tasks = await fetchByIdChunks(
      projectIds,
      (idChunk, from, to) =>
        supabase
          .from('monday_tasks')
          .select('id, name, quoted_hours, project_id, timeline_start, timeline_end')
          .in('project_id', idChunk)
          .eq('is_subtask', true)
          .range(from, to)
    )

    // Query by project_id so we still get hours when tasks were later deleted in Monday.
    let timeEntriesByTask: Record<string, number> = {}
    let timeEntriesByProject: Record<string, number> = {}
    const hoursByProjectUser: Record<string, Record<string, number>> = {}

    const allTimeEntries = await fetchByIdChunks(
      projectIds,
      (idChunk, from, to) =>
        supabase
          .from('time_entries')
          .select('task_id, project_id, hours, user_id')
          .in('project_id', idChunk)
          .range(from, to)
    )

    for (const entry of allTimeEntries) {
      timeEntriesByTask[entry.task_id] = (timeEntriesByTask[entry.task_id] || 0) + Number(entry.hours)
      timeEntriesByProject[entry.project_id] = (timeEntriesByProject[entry.project_id] || 0) + Number(entry.hours)
      if (entry.user_id) {
        if (!hoursByProjectUser[entry.project_id]) {
          hoursByProjectUser[entry.project_id] = {}
        }
        hoursByProjectUser[entry.project_id][entry.user_id] =
          (hoursByProjectUser[entry.project_id][entry.user_id] || 0) + Number(entry.hours)
      }
    }

    const designerIds = [
      ...new Set(
        Object.values(hoursByProjectUser).flatMap((byUser) => Object.keys(byUser))
      ),
    ]

    const designerMap = new Map<string, { id: string; full_name: string | null; email: string | null }>()
    if (designerIds.length > 0) {
      const adminClient = await createAdminClient()
      if (adminClient) {
        const { data: users, error: usersError } = await adminClient
          .from('users')
          .select('id, full_name, email')
          .in('id', designerIds)
          .is('deleted_at', null)

        if (usersError) throw usersError

        for (const u of users || []) {
          designerMap.set(u.id, {
            id: u.id,
            full_name: u.full_name,
            email: u.email,
          })
        }
      }
    }

    const getProjectDesigners = (projectId: string): ProjectDesigner[] => {
      const byUser = hoursByProjectUser[projectId] || {}
      return Object.entries(byUser)
        .map(([userId, hours]) => {
          const user = designerMap.get(userId)
          if (!user) return null
          return {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            hours,
          }
        })
        .filter((d): d is ProjectDesigner => d !== null)
        .sort((a, b) => {
          const nameA = a.full_name || a.email || ''
          const nameB = b.full_name || b.email || ''
          return nameA.localeCompare(nameB)
        })
    }

    // Build projects with time tracking data
    const projectsWithTracking: ProjectWithTimeTracking[] = projects.map((project) => {
      const projectTasks = tasks.filter((task) => task.project_id === project.id)
      
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
          timeline_start: task.timeline_start || null,
          timeline_end: task.timeline_end || null,
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
        agency: project.agency || null,
        completed_date: project.completed_date || null,
        due_date: project.due_date || null,
        created_at: project.created_at,
        status: project.status,
        quoted_hours: project.quoted_hours ? Number(project.quoted_hours) : null,
        total_logged_hours: totalLoggedHours,
        designers: getProjectDesigners(project.id),
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

    // Get all tasks for this project
    const { data: tasks, error: tasksError } = await supabase
      .from('monday_tasks')
      .select('id, name, quoted_hours')
      .eq('project_id', projectId)
      .eq('is_subtask', true)

    if (tasksError) throw tasksError

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
        task:monday_tasks(name, quoted_hours)
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
        .is('deleted_at', null) // Only include active users
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

    // Aggregate hours by task for task breakdown
    const hoursByTask: Record<string, number> = {}
    if (timeEntries) {
      timeEntries.forEach((entry: any) => {
        const taskId = entry.task_id
        if (taskId) {
          hoursByTask[taskId] = (hoursByTask[taskId] || 0) + Number(entry.hours || 0)
        }
      })
    }

    // Build tasks breakdown
    const tasksBreakdown = (tasks || []).map((task: any) => {
      const loggedHours = hoursByTask[task.id] || 0
      const quotedHours = task.quoted_hours ? Number(task.quoted_hours) : null
      const percentage = quotedHours && quotedHours > 0
        ? (loggedHours / quotedHours) * 100
        : loggedHours > 0
          ? null
          : 0

      return {
        id: task.id,
        name: task.name,
        loggedHours,
        quotedHours,
        percentage,
      }
    }).sort((a, b) => b.loggedHours - a.loggedHours) // Sort by logged hours descending

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
      tasksBreakdown,
      userTotals,
      latestEntries,
    }
  } catch (error) {
    console.error('Error fetching project details:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch project details' }
  }
}

