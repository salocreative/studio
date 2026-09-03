import { createAdminClient } from '@/lib/supabase/server'
import type { SyncSettings } from '@/app/actions/sync-settings'

const SYNC_SETTINGS_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Reads Monday.com sync settings with the service-role client.
 *
 * The cron route has no cookie session, so it cannot use the server actions in
 * `app/actions/sync-settings.ts`: those require a logged-in user, and the RLS
 * policies on `monday_sync_settings` require an authenticated session to read
 * and an admin to write. Kept out of a
 * `'use server'` file deliberately, so an unauthenticated reader of this table
 * is never exposed to the browser as a callable server action.
 */
export async function getSyncSettingsAdmin(): Promise<
  { settings: SyncSettings | null; error?: undefined } | { error: string; settings?: undefined }
> {
  const supabase = await createAdminClient()
  if (!supabase) {
    return { error: 'Service role key is not configured' }
  }

  const { data, error } = await supabase
    .from('monday_sync_settings')
    .select('*')
    .eq('id', SYNC_SETTINGS_ID)
    .maybeSingle()

  if (error) {
    // Production has sometimes lagged migrations; treat a missing table as "not configured".
    if (error.code === '42P01' || (error.message || '').includes('schema cache')) {
      console.warn('monday_sync_settings table does not exist yet. Run migration 015_add_monday_sync_settings.sql')
      return { settings: null }
    }
    return { error: error.message || 'Failed to read sync settings' }
  }

  return { settings: (data as SyncSettings | null) ?? null }
}

/**
 * Records that a sync just finished, and when the next one is due.
 * Uses the service-role client for the same reason as `getSyncSettingsAdmin`.
 */
export async function markSyncCompleteAdmin(intervalMinutes: number) {
  const supabase = await createAdminClient()
  if (!supabase) {
    return { error: 'Service role key is not configured' }
  }

  const now = new Date()
  const nextSync = new Date(now.getTime() + intervalMinutes * 60 * 1000)

  const { error } = await supabase
    .from('monday_sync_settings')
    .update({
      last_sync_at: now.toISOString(),
      next_sync_at: nextSync.toISOString(),
    })
    .eq('id', SYNC_SETTINGS_ID)

  if (error) {
    return { error: error.message || 'Failed to update sync timestamp' }
  }

  return { success: true as const }
}
