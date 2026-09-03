'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getRequestClient, getRequestUser, isRequestUserAdmin } from '@/lib/supabase/session'
import {
  getFlexiDesignBoardIds,
  getFlexiDesignCompletedBoardId,
  getMainTimesheetBoardIds,
} from '@/lib/monday/board-helpers'
import { getTaskCompletionFromStatus } from '@/lib/monday/task-completion'
import { getUsers } from '@/app/actions/users'
import { checkIsAdmin } from '@/app/actions/auth'

/** Postgres/Supabase errors are not always instanceof Error. */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }
  return 'An unexpected error occurred'
}

/** Columns the timesheet actually renders. `select('*')` would also drag `monday_data` —
 *  the full raw Monday column payload — across the wire for every row. */
const PROJECT_COLUMNS = 'id, name, client_name, quoted_hours, status'
const TASK_COLUMNS = 'id, project_id, name, quoted_hours, monday_data'

/** Shape sent to the client for each task — deliberately excludes the raw Monday payload. */
type TimesheetTask = {
  id: string
  name: string
  quoted_hours: number | null
  is_favorite: boolean
  logged_hours: number
  time_left: number | null
  is_completed: boolean | null
}

type TimeTotals = {
  byProject: Record<string, number>
  byTask: Record<string, number>
}

/** PostgREST/Postgres codes meaning the RPC hasn't been migrated to this database yet. */
function isMissingFunctionError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('Could not find the function') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache')
  )
}

/**
 * Logged-hours totals per project and per task.
 *
 * Aggregated in Postgres: the previous approach pulled every `time_entries` row for every
 * listed project (the select policy is `authenticated`, so that is effectively the whole
 * table, for all users, for all time) and summed them in Node.
 *
 * Falls back to the row-by-row sum if the RPC is missing, since production has sometimes
 * lagged migrations.
 */
async function loadTimeTotals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectIds: string[]
): Promise<TimeTotals> {
  const byProject: Record<string, number> = {}
  const byTask: Record<string, number> = {}

  const { data, error } = await supabase.rpc('time_entry_totals', { p_project_ids: projectIds })

  if (!error) {
    for (const row of (data ?? []) as Array<{
      project_id: string | null
      task_id: string | null
      total_hours: number | string | null
    }>) {
      const hours = Number(row.total_hours) || 0
      if (row.task_id) {
        byTask[row.task_id] = hours
      } else if (row.project_id) {
        byProject[row.project_id] = hours
      }
    }
    return { byProject, byTask }
  }

  if (!isMissingFunctionError(error)) {
    throw error
  }

  const { data: rows, error: rowsError } = await supabase
    .from('time_entries')
    .select('project_id, task_id, hours')
    .in('project_id', projectIds)

  if (rowsError) throw rowsError

  for (const entry of rows ?? []) {
    byProject[entry.project_id] = (byProject[entry.project_id] || 0) + Number(entry.hours)
    if (entry.task_id) {
      byTask[entry.task_id] = (byTask[entry.task_id] || 0) + Number(entry.hours)
    }
  }

  return { byProject, byTask }
}

/**
 * Get all active projects with their tasks
 * @param boardType - 'main' = boards with column mappings that qualify as Main (not Flexi/leads/archives); 'flexi-design' = Flexi boards; 'all' = every active project
 */
export async function getProjectsWithTasks(boardType: 'main' | 'flexi-design' | 'all' = 'main') {
  const supabase = await getRequestClient()

  const user = await getRequestUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Resolve the board filter first; `null` means "every active project".
    let boardIds: string[] | null = null

    if (boardType === 'flexi-design') {
      // Only show active Flexi-Design boards (exclude the completed board).
      const [flexiDesignBoardIds, completedBoardId] = await Promise.all([
        getFlexiDesignBoardIds(),
        getFlexiDesignCompletedBoardId(),
      ])

      boardIds = Array.from(flexiDesignBoardIds).filter(
        (id) => !completedBoardId || id !== completedBoardId
      )

      if (boardIds.length === 0) {
        return { success: true, projects: [] }
      }
    } else if (boardType === 'main') {
      // Main timesheet: only boards that have column mappings and qualify as "Main" in Settings
      // (not Flexi, not completed archives, not Flexi completed, not leads).
      const mainBoardIds = await getMainTimesheetBoardIds()

      if (mainBoardIds.size === 0) {
        return { success: true, projects: [] }
      }

      boardIds = Array.from(mainBoardIds)
    }

    let projectsQuery = supabase
      .from('monday_projects')
      .select(PROJECT_COLUMNS)
      .eq('status', 'active')
      .order('name', { ascending: true })

    if (boardIds) {
      projectsQuery = projectsQuery.in('monday_board_id', boardIds)
    }

    const { data: projects, error: projectsError } = await projectsQuery

    if (projectsError) throw projectsError

    const projectIds = (projects ?? []).map((p) => p.id)

    if (projectIds.length === 0) {
      return { success: true, projects: [] }
    }

    const [tasksResult, favoritesResult, totals] = await Promise.all([
      supabase
        .from('monday_tasks')
        .select(TASK_COLUMNS)
        .in('project_id', projectIds)
        .eq('is_subtask', true)
        .order('created_at', { ascending: true }),
      supabase.from('favorite_tasks').select('task_id').eq('user_id', user.id),
      loadTimeTotals(supabase, projectIds),
    ])

    if (tasksResult.error) throw tasksResult.error

    const favoriteTaskIds = new Set(
      (favoritesResult.data ?? []).map((f: { task_id: string }) => f.task_id)
    )

    // Group tasks by project once rather than filtering the full list per project.
    const tasksByProject = new Map<string, TimesheetTask[]>()
    for (const task of tasksResult.data ?? []) {
      const loggedHours = totals.byTask[task.id] || 0
      const quotedHours = task.quoted_hours ? Number(task.quoted_hours) : null

      const list = tasksByProject.get(task.project_id)
      const shaped = {
        id: task.id,
        name: task.name,
        quoted_hours: quotedHours,
        is_favorite: favoriteTaskIds.has(task.id),
        logged_hours: loggedHours,
        time_left: quotedHours !== null ? Math.max(0, quotedHours - loggedHours) : null,
        // Derived here so the raw `monday_data` blob never reaches the browser.
        is_completed: getTaskCompletionFromStatus(task.monday_data),
      }

      if (list) {
        list.push(shaped)
      } else {
        tasksByProject.set(task.project_id, [shaped])
      }
    }

    const projectsWithTasks = (projects ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      client_name: project.client_name,
      quoted_hours: project.quoted_hours ? Number(project.quoted_hours) : null,
      status: project.status,
      total_logged_hours: totals.byProject[project.id] || 0,
      tasks: tasksByProject.get(project.id) ?? [],
    }))

    return { success: true, projects: projectsWithTasks }
  } catch (error) {
    console.error('Error fetching projects:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch projects' }
  }
}

/**
 * Get time entries for a date range
 * @param targetUserId - Optional user ID to fetch entries for (admin only)
 */
export async function getTimeEntries(startDate: string, endDate: string, targetUserId?: string) {
  const supabase = await getRequestClient()

  const user = await getRequestUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Determine which user's entries to fetch
  let userIdToFetch = user.id
  let clientToUse = supabase

  if (targetUserId && targetUserId !== user.id) {
    // Check if current user is admin
    const isAdmin = await isRequestUserAdmin()
    if (!isAdmin) {
      return { error: 'Unauthorized: Admin access required to view other users\' entries' }
    }

    // Use admin client to bypass RLS
    const adminClient = await createAdminClient()
    if (!adminClient) {
      return { error: 'Admin client not available' }
    }

    userIdToFetch = targetUserId
    clientToUse = adminClient
  }

  try {
    const { data, error } = await clientToUse
      .from('time_entries')
      // Only the fields the transform below keeps. Selecting `*` on the joined rows pulled
      // both raw `monday_data` payloads back for every entry.
      .select(`
        id, hours, notes, date,
        task:monday_tasks(id, name, quoted_hours),
        project:monday_projects(id, name, client_name, status)
      `)
      .eq('user_id', userIdToFetch)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false })

    if (error) {
      console.error('Supabase error in getTimeEntries:', error)
      throw error
    }

    // Transform the response to match the expected format
    // Supabase returns relationships with the alias names (task, project)
    const entries = (data || []).map((entry: any) => {
      try {
        // Supabase returns relationships using the alias (task, project)
        // Since these are foreign keys, they should be single objects, not arrays
        const task = entry.task || {}
        const project = entry.project || {}
        
        return {
          id: entry.id,
          hours: entry.hours || 0,
          notes: entry.notes || null,
          date: entry.date || '',
          task: {
            id: task.id || '',
            name: task.name || '',
            quoted_hours: task.quoted_hours || null,
            is_favorite: false, // Will be set by client
          },
          project: {
            id: project.id || '',
            name: project.name || '',
            client_name: project.client_name || null,
            status: project.status || 'active',
          },
        }
      } catch (transformError) {
        console.error('Error transforming entry:', transformError, entry)
        // Return a minimal valid entry to prevent crashes
        return {
          id: entry.id || '',
          hours: entry.hours || 0,
          notes: entry.notes || null,
          date: entry.date || '',
          task: { id: '', name: '', quoted_hours: null, is_favorite: false },
          project: { id: '', name: '', client_name: null, status: 'active' },
        }
      }
    })

    return { success: true, entries }
  } catch (error) {
    console.error('Error fetching time entries:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch time entries' }
  }
}

/**
 * Everything the time-tracking page needs for its first paint, in one round trip.
 *
 * The page previously fired four server actions from separate effects. Next queues server
 * actions from a client, so they ran strictly one after another, each paying for its own
 * `auth.getUser()` network call.
 */
export async function getTimeTrackingBootstrap(params: {
  boardType: 'main' | 'flexi-design' | 'all'
  startDate: string
  endDate: string
  targetUserId?: string
}) {
  const user = await getRequestUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const [adminContext, projectsResult, entriesResult] = await Promise.all([
    // The users list is only needed by admins, but resolving it in this chain keeps it off
    // the critical path for the projects and entries queries.
    (async () => {
      const isAdmin = await isRequestUserAdmin()
      if (!isAdmin) return { isAdmin: false, users: [] as unknown[] }
      const usersResult = await getUsers()
      return {
        isAdmin: true,
        users: 'users' in usersResult ? usersResult.users : [],
      }
    })(),
    getProjectsWithTasks(params.boardType),
    getTimeEntries(params.startDate, params.endDate, params.targetUserId),
  ])

  return {
    success: true,
    isAdmin: adminContext.isAdmin,
    users: adminContext.users,
    projects: 'projects' in projectsResult ? projectsResult.projects : [],
    projectsError: 'error' in projectsResult ? projectsResult.error : undefined,
    entries: 'entries' in entriesResult ? entriesResult.entries : [],
    entriesError: 'error' in entriesResult ? entriesResult.error : undefined,
  }
}

/**
 * Create a time entry
 * @param targetUserId - Optional user ID to create entry for (admin only)
 */
export async function createTimeEntry(
  taskId: string,
  projectId: string,
  date: string,
  hours: number,
  notes?: string,
  targetUserId?: string
) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return { error: 'Not authenticated' }
    }

    let userIdToUse = user.id
    let clientToUse = supabase

    if (targetUserId && targetUserId !== user.id) {
      const { isAdmin } = await checkIsAdmin()
      if (!isAdmin) {
        return { error: 'Unauthorized: Admin access required to create entries for other users' }
      }

      const adminClient = await createAdminClient()
      if (!adminClient) {
        return { error: 'Admin client not available' }
      }

      userIdToUse = targetUserId
      clientToUse = adminClient
    }

    const { data: project, error: projectErr } = await supabase
      .from('monday_projects')
      .select('status')
      .eq('id', projectId)
      .maybeSingle()

    if (projectErr) {
      console.error('createTimeEntry project lookup:', projectErr)
      return { error: toErrorMessage(projectErr) }
    }
    if (!project) {
      return { error: 'Project not found' }
    }
    if (project.status === 'locked') {
      return { error: 'Cannot add time entries to locked projects' }
    }

    const { data: existing } = await clientToUse
      .from('time_entries')
      .select('id')
      .eq('user_id', userIdToUse)
      .eq('task_id', taskId)
      .eq('date', date)
      .maybeSingle()

    if (existing) {
      return {
        error:
          'Time entry already exists for this task and date. Please edit the existing entry.',
      }
    }

    const { error: insertErr } = await clientToUse.from('time_entries').insert({
      user_id: userIdToUse,
      task_id: taskId,
      project_id: projectId,
      date,
      hours,
      notes: notes || null,
    })

    if (insertErr) {
      console.error('createTimeEntry insert:', insertErr)
      return { error: toErrorMessage(insertErr) }
    }

    return { success: true }
  } catch (error) {
    console.error('Error creating time entry:', error)
    return { error: toErrorMessage(error) }
  }
}

/**
 * Update a time entry
 * @param targetUserId - Optional user ID (admin only, used for verification)
 */
export async function updateTimeEntry(
  entryId: string,
  hours: number,
  notes?: string,
  targetUserId?: string
) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return { error: 'Not authenticated' }
    }

    let clientToUse = supabase
    let isAdminAction = false

    if (targetUserId && targetUserId !== user.id) {
      const { isAdmin } = await checkIsAdmin()
      if (!isAdmin) {
        return { error: 'Unauthorized: Admin access required to update other users\' entries' }
      }

      const adminClient = await createAdminClient()
      if (!adminClient) {
        return { error: 'Admin client not available' }
      }

      clientToUse = adminClient
      isAdminAction = true
    }

    let query = clientToUse
      .from('time_entries')
      .select('id, user_id, project:monday_projects(status)')
      .eq('id', entryId)

    if (!isAdminAction) {
      query = query.eq('user_id', user.id)
    }

    const { data: existing, error: existingErr } = await query.maybeSingle()

    if (existingErr) {
      console.error('updateTimeEntry fetch:', existingErr)
      return { error: toErrorMessage(existingErr) }
    }

    if (!existing) {
      return { error: 'Time entry not found or access denied' }
    }

    if (isAdminAction && targetUserId && existing.user_id !== targetUserId) {
      return { error: 'Time entry does not belong to the specified user' }
    }

    const project = existing.project as { status?: string } | null | undefined
    if (project?.status === 'locked') {
      return { error: 'Cannot update time entries for locked projects' }
    }

    const { error: updateErr } = await clientToUse
      .from('time_entries')
      .update({
        hours,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)

    if (updateErr) {
      console.error('updateTimeEntry update:', updateErr)
      return { error: toErrorMessage(updateErr) }
    }

    return { success: true }
  } catch (error) {
    console.error('Error updating time entry:', error)
    return { error: toErrorMessage(error) }
  }
}

/**
 * Delete a time entry
 * @param targetUserId - Optional user ID (admin only, used for verification)
 */
export async function deleteTimeEntry(entryId: string, targetUserId?: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  let clientToUse = supabase
  let isAdminAction = false

  // If targetUserId is provided and different from current user, check if admin
  if (targetUserId && targetUserId !== user.id) {
    const { isAdmin } = await checkIsAdmin()
    if (!isAdmin) {
      return { error: 'Unauthorized: Admin access required to delete other users\' entries' }
    }

    const adminClient = await createAdminClient()
    if (!adminClient) {
      return { error: 'Admin client not available' }
    }

    clientToUse = adminClient
    isAdminAction = true
  }

  try {
    // Verify ownership (or admin access)
    let query = clientToUse
      .from('time_entries')
      .select('id, user_id, project:monday_projects(status)')
      .eq('id', entryId)
    
    if (!isAdminAction) {
      query = query.eq('user_id', user.id)
    }

    const { data: existing } = await query.single()

    if (!existing) {
      return { error: 'Time entry not found or access denied' }
    }

    // If admin action, verify the entry belongs to the target user
    if (isAdminAction && targetUserId && existing.user_id !== targetUserId) {
      return { error: 'Time entry does not belong to the specified user' }
    }

    // Check if project is locked (type narrowing needed)
    const project = existing.project as any
    if (project?.status === 'locked') {
      return { error: 'Cannot delete time entries for locked projects' }
    }

    const { error } = await clientToUse
      .from('time_entries')
      .delete()
      .eq('id', entryId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error deleting time entry:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete time entry' }
  }
}

/**
 * Toggle favorite task
 */
export async function toggleFavoriteTask(taskId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Check if already favorited
    const { data: existing } = await supabase
      .from('favorite_tasks')
      .select('id')
      .eq('user_id', user.id)
      .eq('task_id', taskId)
      .maybeSingle()

    if (existing) {
      // Remove favorite
      const { error } = await supabase
        .from('favorite_tasks')
        .delete()
        .eq('id', existing.id)

      if (error) throw error
      return { success: true, is_favorite: false }
    } else {
      // Add favorite
      const { error } = await supabase
        .from('favorite_tasks')
        .insert({
          user_id: user.id,
          task_id: taskId,
        })

      if (error) throw error
      return { success: true, is_favorite: true }
    }
  } catch (error) {
    console.error('Error toggling favorite:', error)
    return { error: error instanceof Error ? error.message : 'Failed to toggle favorite' }
  }
}

