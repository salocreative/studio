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

