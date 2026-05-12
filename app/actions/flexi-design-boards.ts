'use server'

import { createClient } from '@/lib/supabase/server'

export interface FlexiDesignBoardRow {
  id: string
  monday_board_id: string
  board_name: string | null
}

export async function listFlexiDesignBoards() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('flexi_design_boards')
      .select('id, monday_board_id, board_name')
      .order('board_name', { ascending: true, nullsFirst: false })
      .order('monday_board_id', { ascending: true })

    if (error) throw error

    return { success: true, boards: (data ?? []) as FlexiDesignBoardRow[] }
  } catch (error) {
    console.error('listFlexiDesignBoards:', error)
    const msg = error instanceof Error ? error.message : 'Failed to load Flexi-Design boards'
    return { error: msg }
  }
}

export async function addFlexiDesignBoard(mondayBoardId: string, boardName: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase.from('users').select('role').eq('id', user.id).single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  const trimmedId = mondayBoardId.trim()
  if (!trimmedId) {
    return { error: 'Board ID is required' }
  }

  try {
    const { error } = await supabase.from('flexi_design_boards').insert({
      monday_board_id: trimmedId,
      board_name: boardName.trim() || null,
    })

    if (error) {
      if (error.code === '23505') {
        return { error: 'This board is already listed as a Flexi-Design board' }
      }
      throw error
    }

    return { success: true }
  } catch (error) {
    console.error('addFlexiDesignBoard:', error)
    const msg = error instanceof Error ? error.message : 'Failed to add Flexi-Design board'
    return { error: msg }
  }
}

export async function removeFlexiDesignBoard(id: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase.from('users').select('role').eq('id', user.id).single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { error } = await supabase.from('flexi_design_boards').delete().eq('id', id)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('removeFlexiDesignBoard:', error)
    const msg = error instanceof Error ? error.message : 'Failed to remove Flexi-Design board'
    return { error: msg }
  }
}
