'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Get board IDs that are Flexi-Design boards
 * Flexi-Design boards are identified by board name containing "flexi" (case-insensitive)
 */
export async function getFlexiDesignBoardIds(): Promise<Set<string>> {
  const supabase = await createClient()
  
  try {
    // Get all boards from column mappings
    const { data: mappings } = await supabase
      .from('monday_column_mappings')
      .select('board_id')
      .not('board_id', 'is', null)
    
    if (!mappings || mappings.length === 0) {
      return new Set()
    }

    // We need to get board names from Monday.com API to identify Flexi-Design boards
    const mondayApiToken = process.env.MONDAY_API_TOKEN
    if (!mondayApiToken) {
      return new Set()
    }

    const boardIds = Array.from(new Set(mappings.map((m: any) => m.board_id).filter(Boolean)))
    
    // Fetch board names from Monday.com API
    const MONDAY_API_URL = 'https://api.monday.com/v2'
    const query = `
      query($boardIds: [ID!]) {
        boards(ids: $boardIds) {
          id
          name
        }
      }
    `

    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: mondayApiToken,
      },
      body: JSON.stringify({ query, variables: { boardIds } }),
    })

    if (!response.ok) {
      return new Set()
    }

    const result = await response.json()
    if (result.errors) {
      return new Set()
    }

    // Identify Flexi-Design boards by name (case-insensitive)
    const flexiDesignBoardIds = new Set<string>()
    result.data?.boards?.forEach((board: { id: string; name: string }) => {
      if (board.name.toLowerCase().includes('flexi')) {
        flexiDesignBoardIds.add(board.id)
      }
    })

    return flexiDesignBoardIds
  } catch (error) {
    console.error('Error identifying Flexi-Design boards:', error)
    return new Set()
  }
}

/**
 * Get the leads board ID
 * Returns the board ID if configured, null otherwise
 */
export async function getLeadsBoardId(): Promise<string | null> {
  const supabase = await createClient()
  
  try {
    const { data, error } = await supabase
      .from('monday_leads_board')
      .select('monday_board_id')
      .maybeSingle()
    
    if (error) {
      console.error('Error fetching leads board:', error)
      return null
    }
    
    return data?.monday_board_id || null
  } catch (error) {
    console.error('Error fetching leads board:', error)
    return null
  }
}

