'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'
import { getFlexiDesignCompletedBoard } from '@/app/actions/flexi-design-completed-board'
import { checkIsAdmin } from '@/app/actions/auth'

/**
 * Get all active projects with their tasks
 * @param boardType - 'main' for main projects, 'flexi-design' for Flexi-Design projects, or 'all' for both
 */
export async function getProjectsWithTasks(boardType: 'main' | 'flexi-design' | 'all' = 'main') {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Build query for active projects
    let projectsQuery = supabase
      .from('monday_projects')
      .select('*')
      .eq('status', 'active')
      .order('name', { ascending: true })

    // Filter by board type if needed
    if (boardType !== 'all') {
      const flexiDesignBoardIds = await getFlexiDesignBoardIds()
      
      if (boardType === 'flexi-design') {
        // Only show active Flexi-Design boards (exclude completed board)
        const completedBoardResult = await getFlexiDesignCompletedBoard()
        const completedBoardId = completedBoardResult.success && completedBoardResult.board 
          ? completedBoardResult.board.monday_board_id 
          : null
        
        // Filter out completed board from active board IDs
        const activeBoardIds = Array.from(flexiDesignBoardIds).filter(
          boardId => !completedBoardId || boardId !== completedBoardId
        )
        
        if (activeBoardIds.length > 0) {
          projectsQuery = projectsQuery.in('monday_board_id', activeBoardIds)
        } else {
          // No active Flexi-Design boards found, return empty
          return { success: true, projects: [] }
        }
      } else {
        // Only show main projects (exclude Flexi-Design)
        if (flexiDesignBoardIds.size > 0) {
          const flexiIds = Array.from(flexiDesignBoardIds)
          // Filter out Flexi-Design boards
          // Since Supabase doesn't have a direct "not in" operator, we'll filter client-side
          // or use a different approach - get all and filter
          const { data: allProjects } = await supabase
            .from('monday_projects')
            .select('*')
            .eq('status', 'active')
            .order('name', { ascending: true })
          
          const filteredProjects = allProjects?.filter(p => !flexiIds.includes(p.monday_board_id)) || []
          // Continue with filtered projects
          const projectIds = filteredProjects.map((p) => p.id)
          
          if (projectIds.length === 0) {
            return { success: true, projects: [] }
          }

          const { data: tasks, error: tasksError } = await supabase
            .from('monday_tasks')
            .select('*')
            .in('project_id', projectIds)
            .eq('is_subtask', true)
            .order('created_at', { ascending: true })

          if (tasksError) throw tasksError

          // Get user's favorite tasks
          const { data: favorites } = await supabase
            .from('favorite_tasks')
            .select('task_id')
            .eq('user_id', user.id)

          const favoriteTaskIds = new Set(favorites?.map((f) => f.task_id) || [])

          // Group tasks by project
          const projectsWithTasks = filteredProjects.map((project) => {
            const projectTasks = (tasks || [])
              .filter((task) => task.project_id === project.id)
              .map((task) => ({
                ...task,
                is_favorite: favoriteTaskIds.has(task.id),
              }))

            return {
              ...project,
              tasks: projectTasks,
            }
          })

          return { success: true, projects: projectsWithTasks }
        }
      }
    }

    const { data: projects, error: projectsError } = await projectsQuery

    if (projectsError) throw projectsError

    // Get tasks for all projects
    const projectIds = projects?.map((p) => p.id) || []
    
    if (projectIds.length === 0) {
      return { success: true, projects: [] }
    }

    const { data: tasks, error: tasksError } = await supabase
      .from('monday_tasks')
      .select('*')
      .in('project_id', projectIds)
      .eq('is_subtask', true)
      .order('created_at', { ascending: true })

    if (tasksError) throw tasksError

    // Get user's favorite tasks
    const { data: favorites } = await supabase
      .from('favorite_tasks')
      .select('task_id')
      .eq('user_id', user.id)

    const favoriteTaskIds = new Set(favorites?.map((f) => f.task_id) || [])

    // Get assigned tasks (check if user's Monday ID is in assigned_user_ids array)
    // For now, we'll show all tasks - can filter by assignment later

    // Group tasks by project
    const projectsWithTasks = (projects || []).map((project) => {
      const projectTasks = (tasks || [])
        .filter((task) => task.project_id === project.id)
        .map((task) => ({
          ...task,
          is_favorite: favoriteTaskIds.has(task.id),
        }))

      return {
        ...project,
        tasks: projectTasks,
      }
    })

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
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Determine which user's entries to fetch
  let userIdToFetch = user.id
  let clientToUse = supabase

  if (targetUserId && targetUserId !== user.id) {
    // Check if current user is admin
    const { isAdmin } = await checkIsAdmin()
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
      .select(`
        *,
        task:monday_tasks(*),
        project:monday_projects(*)
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
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Determine which user's entry to create
  let userIdToUse = user.id
  let clientToUse = supabase

  if (targetUserId && targetUserId !== user.id) {
    // Check if current user is admin
    const { isAdmin } = await checkIsAdmin()
    if (!isAdmin) {
      return { error: 'Unauthorized: Admin access required to create entries for other users' }
    }

    // Use admin client to bypass RLS
    const adminClient = await createAdminClient()
    if (!adminClient) {
      return { error: 'Admin client not available' }
    }

    userIdToUse = targetUserId
    clientToUse = adminClient
  }

  try {
    // Check if project is locked
    const { data: project } = await supabase
      .from('monday_projects')
      .select('status')
      .eq('id', projectId)
      .single()

    if (project?.status === 'locked') {
      return { error: 'Cannot add time entries to locked projects' }
    }

    // Check if entry already exists for this task/date
    const { data: existing } = await clientToUse
      .from('time_entries')
      .select('id')
      .eq('user_id', userIdToUse)
      .eq('task_id', taskId)
      .eq('date', date)
      .maybeSingle()

    if (existing) {
      return { error: 'Time entry already exists for this task and date. Please update the existing entry.' }
    }

    const { data, error } = await clientToUse
      .from('time_entries')
      .insert({
        user_id: userIdToUse,
        task_id: taskId,
        project_id: projectId,
        date,
        hours,
        notes: notes || null,
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, entry: data }
  } catch (error) {
    console.error('Error creating time entry:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create time entry' }
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
      return { error: 'Unauthorized: Admin access required to update other users\' entries' }
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
      return { error: 'Cannot update time entries for locked projects' }
    }

    const { data, error } = await clientToUse
      .from('time_entries')
      .update({
        hours,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)
      .select()
      .single()

    if (error) throw error

    return { success: true, entry: data }
  } catch (error) {
    console.error('Error updating time entry:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update time entry' }
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

