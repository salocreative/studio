'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Get leads status configuration (which statuses to include/exclude)
 */
export async function getLeadsStatusConfig() {
  const supabase = await createClient()

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
    // Get the single config row (enforced by unique constraint)
    const { data: config, error } = await supabase
      .from('leads_status_config')
      .select('included_statuses, excluded_statuses')
      .limit(1)
      .maybeSingle()

    if (error && error.code !== 'PGRST116') throw error // PGRST116 is "no rows returned"

    return {
      success: true,
      includedStatuses: config?.included_statuses || [],
      excludedStatuses: config?.excluded_statuses || [],
    }
  } catch (error) {
    console.error('Error fetching leads status config:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch leads status config' }
  }
}

/**
 * Update leads status configuration
 */
export async function updateLeadsStatusConfig(
  includedStatuses: string[],
  excludedStatuses: string[]
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
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Check if config exists
    const { data: existing } = await supabase
      .from('leads_status_config')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (existing) {
      // Update existing config
      const { error } = await supabase
        .from('leads_status_config')
        .update({
          included_statuses: includedStatuses,
          excluded_statuses: excludedStatuses,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (error) throw error
    } else {
      // Insert new config
      const { error } = await supabase
        .from('leads_status_config')
        .insert({
          included_statuses: includedStatuses,
          excluded_statuses: excludedStatuses,
        })

      if (error) throw error
    }

    return { success: true }
  } catch (error) {
    console.error('Error updating leads status config:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update leads status config' }
  }
}

