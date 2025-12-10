'use server'

import { createClient } from '@/lib/supabase/server'

export interface QuoteRate {
  id: string
  customer_type: 'partner' | 'client'
  day_rate_gbp: number
  hours_per_day: number
  created_at: string
  updated_at: string
}

/**
 * Get all quote rates
 */
export async function getQuoteRates() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('quote_rates')
      .select('*')
      .order('customer_type', { ascending: true })

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
        console.warn('quote_rates table does not exist yet. Please run migration 016_add_quote_rates.sql')
        return { success: true, rates: null }
      }
      throw error
    }

    return { success: true, rates: data || [] }
  } catch (error) {
    console.error('Error fetching quote rates:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch quote rates'
    
    if (errorMessage.includes('does not exist') || errorMessage.includes('relation') || errorMessage.includes('table')) {
      return { 
        error: 'Database table not found. Please run migration 016_add_quote_rates.sql in Supabase. See the migrations folder for details.' 
      }
    }
    
    return { error: errorMessage }
  }
}

/**
 * Get a specific quote rate by customer type
 */
export async function getQuoteRateByType(customerType: 'partner' | 'client') {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('quote_rates')
      .select('*')
      .eq('customer_type', customerType)
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
        return { success: true, rate: null }
      }
      throw error
    }

    return { success: true, rate: data || null }
  } catch (error) {
    console.error('Error fetching quote rate:', error)
    return { 
      error: error instanceof Error ? error.message : 'Failed to fetch quote rate' 
    }
  }
}

/**
 * Update quote rate (admin only)
 */
export async function updateQuoteRate(
  customerType: 'partner' | 'client',
  dayRateGbp: number,
  hoursPerDay: number = 6.0
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

  // Validate inputs
  if (dayRateGbp <= 0) {
    return { error: 'Day rate must be greater than 0' }
  }
  if (hoursPerDay <= 0) {
    return { error: 'Hours per day must be greater than 0' }
  }

  try {
    const { data, error } = await supabase
      .from('quote_rates')
      .upsert({
        customer_type: customerType,
        day_rate_gbp: dayRateGbp,
        hours_per_day: hoursPerDay,
      }, {
        onConflict: 'customer_type'
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, rate: data }
  } catch (error) {
    console.error('Error updating quote rate:', error)
    return { 
      error: error instanceof Error ? error.message : 'Failed to update quote rate' 
    }
  }
}

