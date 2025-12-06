'use server'

import { createClient } from '@/lib/supabase/server'
import { getXeroAuthUrl, getXeroConnection, fetchXeroFinancialData } from '@/lib/xero/api'

/**
 * Get Xero connection status
 */
export async function getXeroStatus() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const result = await getXeroConnection()
    
    if (result.error) {
      return { error: result.error }
    }

    const connection = result.connection
    
    if (!connection) {
      return { success: true, connected: false }
    }

    // Check if token is expired
    const expiresAt = new Date(connection.token_expires_at)
    const now = new Date()
    const isExpired = expiresAt <= now

    return {
      success: true,
      connected: true,
      tenantName: connection.tenant_name,
      expiresAt: connection.token_expires_at,
      isExpired,
    }
  } catch (error) {
    console.error('Error getting Xero status:', error)
    return { error: error instanceof Error ? error.message : 'Failed to get Xero status' }
  }
}

/**
 * Get Xero OAuth authorization URL
 */
export async function getXeroAuthUrlAction() {
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

  return await getXeroAuthUrl()
}

/**
 * Disconnect Xero
 */
export async function disconnectXero() {
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
    const { error } = await supabase
      .from('xero_connection')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error disconnecting Xero:', error)
    return { error: error instanceof Error ? error.message : 'Failed to disconnect Xero' }
  }
}

/**
 * Get financial data for a date range
 */
export async function getFinancialData(startDate: string, endDate: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const result = await fetchXeroFinancialData(startDate, endDate)
    return result
  } catch (error) {
    console.error('Error getting financial data:', error)
    return { error: error instanceof Error ? error.message : 'Failed to get financial data' }
  }
}

