'use server'

import { createClient } from '@/lib/supabase/server'

export type SowPartyType = 'agency' | 'client'
export type SowPartyCurrency = 'GBP' | 'USD'

export interface SowPartyRate {
  id: string
  name: string
  party_type: SowPartyType
  day_rate_gbp: number
  currency: SowPartyCurrency
  created_at: string
  updated_at: string
}

async function requireTeamMember() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, supabase: null, userId: null }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (
    !profile ||
    (profile.role !== 'admin' && profile.role !== 'designer' && profile.role !== 'manager')
  ) {
    return { error: 'Unauthorized' as const, supabase: null, userId: null }
  }

  return { supabase, userId: user.id, role: profile.role as string, error: null as null }
}

export async function getSowPartyRates() {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('sow_party_rates')
      .select('*')
      .order('party_type', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw error
    return { success: true, rates: (data || []) as SowPartyRate[] }
  } catch (error) {
    console.error('Error fetching SoW party rates:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch party rates',
    }
  }
}

export async function upsertSowPartyRate(input: {
  party_type: SowPartyType
  name: string
  day_rate_gbp: number
  currency?: SowPartyCurrency
}) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }
  if (auth.role !== 'admin') return { error: 'Only admins can manage party rates' }

  const name = input.name.trim()
  const dayRate = Number(input.day_rate_gbp)
  const currency = input.currency === 'USD' ? 'USD' : 'GBP'
  if (!name) return { error: 'Name is required' }
  if (!(dayRate > 0)) return { error: 'Day rate must be greater than 0' }
  if (input.party_type !== 'agency' && input.party_type !== 'client') {
    return { error: 'Invalid party type' }
  }

  try {
    const { data, error } = await auth.supabase
      .from('sow_party_rates')
      .upsert(
        {
          party_type: input.party_type,
          name,
          day_rate_gbp: Math.round(dayRate * 100) / 100,
          currency,
        },
        { onConflict: 'party_type,name' }
      )
      .select()
      .single()

    if (error) throw error
    return { success: true, rate: data as SowPartyRate }
  } catch (error) {
    console.error('Error saving SoW party rate:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to save party rate',
    }
  }
}

export async function deleteSowPartyRate(id: string) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }
  if (auth.role !== 'admin') return { error: 'Only admins can manage party rates' }

  try {
    const { error } = await auth.supabase.from('sow_party_rates').delete().eq('id', id)
    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error deleting SoW party rate:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to delete party rate',
    }
  }
}
