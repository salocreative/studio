'use server'

import { createClient } from '@/lib/supabase/server'

export interface SyncSettings {
  id: string
  enabled: boolean
  interval_minutes: number
  avoid_deletion?: boolean
  last_sync_at: string | null
  next_sync_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Get Monday.com sync settings
 */
export async function getSyncSettings() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Get the single sync settings record
    const { data, error } = await supabase
      .from('monday_sync_settings')
      .select('*')
      .eq('id', '00000000-0000-0000-0000-000000000000')
      .maybeSingle()

    if (error) {
      const errorMsg = error.message || ''
      const errorCode = error.code || ''
      
      if (
        errorCode === 'PGRST116' || 
        errorCode === '42P01' ||
        errorMsg.includes('does not exist') || 
        errorMsg.includes('relation') || 
        errorMsg.includes('table')
      ) {
        console.warn('monday_sync_settings table does not exist yet. Please run migration 015_add_monday_sync_settings.sql')
        return { success: true, settings: null }
      }
      throw error
    }

    return { success: true, settings: data || null }
  } catch (error) {
    console.error('Error fetching sync settings:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch sync settings'
    
    if (errorMessage.includes('does not exist') || errorMessage.includes('relation') || errorMessage.includes('table')) {
      return { 
        error: 'Database table not found. Please run migration 015_add_monday_sync_settings.sql in Supabase. See the migrations folder for details.' 
      }
    }
    
    return { error: errorMessage }
  }
}

/**
 * Update Monday.com sync settings (admin only)
 */
export async function updateSyncSettings(
  enabled: boolean,
  intervalMinutes: number,
  avoidDeletion: boolean = true
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if user is admin
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  // Validate interval
  if (intervalMinutes < 1 || intervalMinutes > 1440) {
    return { error: 'Interval must be between 1 and 1440 minutes (24 hours)' }
  }

  try {
    // Calculate next_sync_at if enabled
    let nextSyncAt: string | null = null
    if (enabled) {
      const nextSync = new Date()
      nextSync.setMinutes(nextSync.getMinutes() + intervalMinutes)
      nextSyncAt = nextSync.toISOString()
    }

    // Update or insert the single sync settings record
    const { data, error } = await supabase
      .from('monday_sync_settings')
      .upsert({
        id: '00000000-0000-0000-0000-000000000000',
        enabled,
        interval_minutes: intervalMinutes,
        avoid_deletion: avoidDeletion,
        next_sync_at: nextSyncAt,
      }, {
        onConflict: 'id'
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, settings: data }
  } catch (error) {
    console.error('Error updating sync settings:', error)
    return { 
      error: error instanceof Error ? error.message : 'Failed to update sync settings' 
    }
  }
}

/**
 * Update last_sync_at after a sync completes (used by the API route)
 * This doesn't require authentication since it's called by the cron service with a secret
 */
export async function updateSyncTimestamp() {
  const supabase = await createClient()

  try {
    // Get current settings
    const { data: settings } = await supabase
      .from('monday_sync_settings')
      .select('*')
      .eq('id', '00000000-0000-0000-0000-000000000000')
      .single()

    if (!settings || !settings.enabled) {
      return { success: false, message: 'Sync is disabled' }
    }

    // Calculate next sync time
    const nextSync = new Date()
    nextSync.setMinutes(nextSync.getMinutes() + settings.interval_minutes)

    // Update last_sync_at and next_sync_at
    const { error } = await supabase
      .from('monday_sync_settings')
      .update({
        last_sync_at: new Date().toISOString(),
        next_sync_at: nextSync.toISOString(),
      })
      .eq('id', '00000000-0000-0000-0000-000000000000')

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error updating sync timestamp:', error)
    return { 
      error: error instanceof Error ? error.message : 'Failed to update sync timestamp' 
    }
  }
}

