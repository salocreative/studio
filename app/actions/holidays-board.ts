'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidateMondayBoardConfig } from '@/lib/monday/board-helpers'
import { mondayRequest } from '@/lib/monday/api'

function isMissingTableError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return (
    code === '42P01' ||
    code === 'PGRST116' ||
    msg.includes('does not exist') ||
    msg.includes('relation') ||
    msg.includes('schema cache') ||
    msg.includes('table')
  )
}

/**
 * Get the configured Annual Leave / holidays board
 */
export async function getHolidaysBoard() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('monday_holidays_board')
      .select('*')
      .maybeSingle()

    if (error) {
      if (isMissingTableError(error)) {
        console.warn('monday_holidays_board table does not exist yet. Please run migration 073_holiday_leave.sql')
        return { success: true, board: null }
      }
      throw error
    }

    return { success: true, board: data || null }
  } catch (error) {
    console.error('Error fetching holidays board:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch holidays board'
    if (isMissingTableError({ message: errorMessage })) {
      return {
        error: 'Database table not found. Please run migration 073_holiday_leave.sql in Supabase. See the migrations folder for details.',
      }
    }
    return { error: errorMessage }
  }
}

/**
 * Set the holidays board (admin only)
 */
export async function setHolidaysBoard(boardId: string, boardName: string) {
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
    const { data: existing, error: checkError } = await supabase
      .from('monday_holidays_board')
      .select('id')
      .maybeSingle()

    if (checkError) {
      if (isMissingTableError(checkError)) {
        return {
          error: 'Database table not found. Please run migration 073_holiday_leave.sql in Supabase. See the migrations folder for details.',
        }
      }
      throw checkError
    }

    if (existing) {
      const { error } = await supabase
        .from('monday_holidays_board')
        .update({
          monday_board_id: boardId,
          board_name: boardName,
        })
        .eq('id', existing.id)

      if (error) throw error
    } else {
      const { error } = await supabase
        .from('monday_holidays_board')
        .insert({
          monday_board_id: boardId,
          board_name: boardName,
        })

      if (error) {
        if (isMissingTableError(error)) {
          return {
            error: 'Database table not found. Please run migration 073_holiday_leave.sql in Supabase. See the migrations folder for details.',
          }
        }
        throw error
      }
    }

    revalidateMondayBoardConfig()
    return { success: true }
  } catch (error) {
    console.error('Error setting holidays board:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to set holidays board'
    if (isMissingTableError({ message: errorMessage })) {
      return {
        error: 'Database table not found. Please run migration 073_holiday_leave.sql in Supabase. See the migrations folder for details.',
      }
    }
    return { error: errorMessage }
  }
}

/**
 * Remove the holidays board (admin only)
 */
export async function removeHolidaysBoard() {
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
      .from('monday_holidays_board')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (error) {
      if (isMissingTableError(error)) {
        return { success: true }
      }
      throw error
    }

    revalidateMondayBoardConfig()
    return { success: true }
  } catch (error) {
    console.error('Error removing holidays board:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to remove holidays board'
    if (isMissingTableError({ message: errorMessage })) {
      return { success: true }
    }
    return { error: errorMessage }
  }
}

export type MondayPerson = {
  id: string
  name: string
  email: string | null
}

/**
 * Monday.com people for linking Studio users. Admin only.
 */
export async function getMondayPeople(): Promise<{ people?: MondayPerson[]; error?: string }> {
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

  const mondayApiToken = process.env.MONDAY_API_TOKEN
  if (!mondayApiToken) {
    return { error: 'Monday.com API token not configured' }
  }

  try {
    const data = await mondayRequest<{
      users: Array<{
        id: string
        name?: string | null
        email?: string | null
        enabled?: boolean | null
        is_guest?: boolean | null
      }>
    }>(
      mondayApiToken,
      `query {
        users {
          id
          name
          email
          enabled
          is_guest
        }
      }`
    )

    const people = (data.users || [])
      .filter((person) => person.enabled !== false && person.is_guest !== true)
      .map((person) => ({
        id: String(person.id),
        name: person.name?.trim() || person.email?.trim() || String(person.id),
        email: person.email?.trim() || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { people }
  } catch (error) {
    console.error('Error fetching Monday people:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch Monday people' }
  }
}
