'use server'

import { createClient } from '@/lib/supabase/server'
import { syncMondayData } from '@/lib/monday/api'

/**
 * Server action to sync projects and tasks from Monday.com
 * This should be called from admin settings or a scheduled job
 */
export async function syncMondayProjects() {
  const supabase = await createClient()

  // Check if user is admin
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  // Get Monday.com API token from environment (server-side only)
  const mondayApiToken = process.env.MONDAY_API_TOKEN
  if (!mondayApiToken) {
    return { error: 'Monday.com API token not configured' }
  }

  try {
    const result = await syncMondayData(mondayApiToken)
    const messages = [`Synced ${result.projectsSynced} projects`]
    if (result.archived > 0) {
      messages.push(`${result.archived} archived`)
    }
    if (result.deleted > 0) {
      messages.push(`${result.deleted} deleted`)
    }
    
    return { 
      success: true, 
      projectsSynced: result.projectsSynced,
      archived: result.archived,
      deleted: result.deleted,
      message: messages.join(', ') + ' from Monday.com'
    }
  } catch (error) {
    console.error('Error syncing Monday.com data:', error)
    return { 
      error: error instanceof Error ? error.message : 'Failed to sync data from Monday.com' 
    }
  }
}

/**
 * Delete all Monday.com projects and tasks from the database
 * WARNING: This will delete all synced data. Use with caution.
 * Admin only.
 */
export async function deleteAllMondayData() {
  const supabase = await createClient()

  // Check if user is admin
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Check if there are any time entries that would prevent deletion
    const { data: timeEntries, error: timeEntriesError } = await supabase
      .from('time_entries')
      .select('id')
      .limit(1)

    if (timeEntriesError) throw timeEntriesError

    if (timeEntries && timeEntries.length > 0) {
      return {
        error: 'Cannot delete Monday.com data: There are time entries linked to these projects/tasks. Please delete time entries first or archive projects instead.',
      }
    }

    // Get counts BEFORE deletion
    const { count: projectsCount } = await supabase
      .from('monday_projects')
      .select('*', { count: 'exact', head: true })

    const { count: tasksCount } = await supabase
      .from('monday_tasks')
      .select('*', { count: 'exact', head: true })

    // Delete all tasks first (they reference projects via foreign key)
    // Using a condition that's always true to delete all rows
    const { error: tasksDeleteError } = await supabase
      .from('monday_tasks')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all (this condition is always true)

    if (tasksDeleteError) throw tasksDeleteError

    // Delete all projects
    const { error: projectsDeleteError } = await supabase
      .from('monday_projects')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all

    if (projectsDeleteError) throw projectsDeleteError

    return {
      success: true,
      message: `Successfully deleted ${projectsCount || 0} projects and ${tasksCount || 0} tasks`,
      projectsDeleted: projectsCount || 0,
      tasksDeleted: tasksCount || 0,
    }
  } catch (error) {
    console.error('Error deleting Monday.com data:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to delete Monday.com data',
    }
  }
}

