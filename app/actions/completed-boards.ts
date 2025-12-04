'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Get all completed boards
 */
export async function getCompletedBoards() {
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
    const { data, error } = await supabase
      .from('monday_completed_boards')
      .select('*')
      .order('board_name', { ascending: true })

    if (error) throw error

    return { success: true, boards: data || [] }
  } catch (error) {
    console.error('Error fetching completed boards:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch completed boards' }
  }
}

/**
 * Add a completed board
 */
export async function addCompletedBoard(boardId: string, boardName: string) {
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
      .from('monday_completed_boards')
      .insert({
        monday_board_id: boardId,
        board_name: boardName,
      })

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error adding completed board:', error)
    return { error: error instanceof Error ? error.message : 'Failed to add completed board' }
  }
}

/**
 * Remove a completed board
 */
export async function removeCompletedBoard(boardId: string) {
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
      .from('monday_completed_boards')
      .delete()
      .eq('monday_board_id', boardId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error removing completed board:', error)
    return { error: error instanceof Error ? error.message : 'Failed to remove completed board' }
  }
}

