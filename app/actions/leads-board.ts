'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Get the configured leads board
 */
export async function getLeadsBoard() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('monday_leads_board')
      .select('*')
      .maybeSingle()

    if (error) {
      // Check if table doesn't exist
      const errorMsg = error.message || ''
      const errorCode = error.code || ''
      
      if (
        errorCode === 'PGRST116' || 
        errorCode === '42P01' ||
        errorMsg.includes('does not exist') || 
        errorMsg.includes('relation') || 
        errorMsg.includes('table')
      ) {
        // Table doesn't exist yet - return null (no board configured)
        console.warn('monday_leads_board table does not exist yet. Please run migration 005_add_leads_board.sql')
        return { success: true, board: null }
      }
      throw error
    }

    return { success: true, board: data || null }
  } catch (error) {
    console.error('Error fetching leads board:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch leads board'
    
    // Provide more specific error messages
    if (errorMessage.includes('does not exist') || errorMessage.includes('relation') || errorMessage.includes('table')) {
      return { 
        error: 'Database table not found. Please run migration 005_add_leads_board.sql in Supabase. See the migrations folder for details.' 
      }
    }
    
    return { error: errorMessage }
  }
}

/**
 * Set the leads board (admin only)
 */
export async function setLeadsBoard(boardId: string, boardName: string) {
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
    // Check if a leads board already exists
    const { data: existing, error: checkError } = await supabase
      .from('monday_leads_board')
      .select('id')
      .maybeSingle()

    if (checkError) {
      // Check if table doesn't exist
      const errorMsg = checkError.message || ''
      const errorCode = checkError.code || ''
      
      if (
        errorCode === 'PGRST116' || 
        errorCode === '42P01' ||
        errorMsg.includes('does not exist') || 
        errorMsg.includes('relation') || 
        errorMsg.includes('table')
      ) {
        return { 
          error: 'Database table not found. Please run migration 005_add_leads_board.sql in Supabase. See the migrations folder for details.' 
        }
      }
      throw checkError
    }

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from('monday_leads_board')
        .update({
          monday_board_id: boardId,
          board_name: boardName,
        })
        .eq('id', existing.id)

      if (error) throw error
    } else {
      // Insert new
      const { error } = await supabase
        .from('monday_leads_board')
        .insert({
          monday_board_id: boardId,
          board_name: boardName,
        })

      if (error) {
        // Check if table doesn't exist
        const errorMsg = error.message || ''
        const errorCode = error.code || ''
        
        if (
          errorCode === 'PGRST116' || 
          errorCode === '42P01' ||
          errorMsg.includes('does not exist') || 
          errorMsg.includes('relation') || 
          errorMsg.includes('table')
        ) {
          return { 
            error: 'Database table not found. Please run migration 005_add_leads_board.sql in Supabase. See the migrations folder for details.' 
          }
        }
        throw error
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Error setting leads board:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to set leads board'
    
    // Provide more specific error messages
    if (errorMessage.includes('does not exist') || errorMessage.includes('relation') || errorMessage.includes('table')) {
      return { 
        error: 'Database table not found. Please run migration 005_add_leads_board.sql in Supabase. See the migrations folder for details.' 
      }
    }
    
    return { error: errorMessage }
  }
}

/**
 * Remove the leads board (admin only)
 */
export async function removeLeadsBoard() {
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
      .from('monday_leads_board')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all rows

    if (error) {
      // Check if table doesn't exist
      const errorMsg = error.message || ''
      const errorCode = error.code || ''
      
      if (
        errorCode === 'PGRST116' || 
        errorCode === '42P01' ||
        errorMsg.includes('does not exist') || 
        errorMsg.includes('relation') || 
        errorMsg.includes('table')
      ) {
        // Table doesn't exist - nothing to remove
        return { success: true }
      }
      throw error
    }

    return { success: true }
  } catch (error) {
    console.error('Error removing leads board:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to remove leads board'
    
    // Provide more specific error messages
    if (errorMessage.includes('does not exist') || errorMessage.includes('relation') || errorMessage.includes('table')) {
      return { success: true } // Table doesn't exist, so nothing to remove
    }
    
    return { error: errorMessage }
  }
}

