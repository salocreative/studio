'use server'

import { createClient } from '@/lib/supabase/server'
// We'll import from api-helpers, but for now let's duplicate the function here to avoid circular deps
const MONDAY_API_URL = 'https://api.monday.com/v2'

interface MondayApiResponse<T> {
  data: T
  errors?: Array<{ message: string }>
}

async function mondayRequest<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  })

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.statusText}`)
  }

  const result: MondayApiResponse<T> = await response.json()

  if (result.errors && result.errors.length > 0) {
    throw new Error(`Monday.com API errors: ${result.errors.map((e) => e.message).join(', ')}`)
  }

  return result.data
}

interface MondayColumn {
  id: string
  title: string
  type: string
}

interface Board {
  id: string
  name: string
  columns: MondayColumn[]
  parentColumns?: MondayColumn[] // Columns from parent items
  subtaskColumns?: MondayColumn[] // Columns from subtasks
}

/**
 * Get all workspaces from Monday.com
 */
export async function getMondayWorkspaces() {
  const supabase = await createClient()

  // Check if user is admin
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
    const query = `
      query {
        workspaces {
          id
          name
          kind
        }
      }
    `

    const data = await mondayRequest<{ workspaces: Array<{ id: string; name: string; kind: string }> }>(mondayApiToken, query)

    return { success: true, workspaces: data.workspaces || [] }
  } catch (error) {
    console.error('Error fetching Monday.com workspaces:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch workspaces' }
  }
}

/**
 * Get boards for a specific workspace from Monday.com
 * Distinguishes between parent item columns and subtask columns
 */
export async function getMondayBoardsAndColumns(workspaceId?: string) {
  const supabase = await createClient()

  // Check if user is admin
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
    // Get boards for the selected workspace (or all boards if no workspace selected)
    let boards: Board[] = []
    
    if (workspaceId) {
      // Query boards filtered by workspace
      const boardsQuery = `
        query($workspaceId: ID!) {
          boards(limit: 250, workspace_ids: [$workspaceId]) {
            id
            name
            columns {
              id
              title
              type
            }
          }
        }
      `

      try {
        const boardsData = await mondayRequest<{ boards: Board[] }>(mondayApiToken, boardsQuery, { workspaceId })
        // Filter out "Subitems of" boards - these are sub-boards we don't need
        boards = (boardsData.boards || []).filter((board: Board) => 
          !board.name.toLowerCase().startsWith('subitems of')
        )
        
        if (boards.length === 0) {
        }
      } catch (queryError) {
        // Try fallback: get all boards and filter client-side
        const fallbackQuery = `
          query {
            boards(limit: 250) {
              id
              name
              workspace_id
              columns {
                id
                title
                type
              }
            }
          }
        `
        const allBoardsData = await mondayRequest<{ boards: Array<Board & { workspace_id?: string }> }>(mondayApiToken, fallbackQuery)
        boards = (allBoardsData.boards || [])
          .filter((b: any) => b.workspace_id === workspaceId && !b.name.toLowerCase().startsWith('subitems of'))
          .map(({ workspace_id, ...board }) => board) // Remove workspace_id from result
      }
    } else {
      // No workspace selected, get all boards
      const boardsQuery = `
        query {
          boards(limit: 100) {
            id
            name
            columns {
              id
              title
              type
            }
          }
        }
      `

      const boardsData = await mondayRequest<{ boards: Board[] }>(mondayApiToken, boardsQuery)
      // Filter out "Subitems of" boards - these are sub-boards we don't need
      boards = (boardsData.boards || []).filter((board: Board) => 
        !board.name.toLowerCase().startsWith('subitems of')
      )
    }

    // For each board, get a sample item to check parent vs subtask columns
    // We'll fetch one item with subtasks to see the column structure
    for (const board of boards) {
      // Query to get items (projects) and their subitems (subtasks)
      // We need to ensure we're getting subitems with their column_values
      const itemsQuery = `
        query($boardId: [ID!]) {
          boards(ids: $boardId) {
            id
            items_page(limit: 10) {
              items {
                id
                name
                column_values {
                  id
                  type
                  text
                }
                subitems {
                  id
                  name
                  column_values {
                    id
                    type
                    text
                  }
                }
              }
            }
          }
        }
      `

      try {
        const itemsData = await mondayRequest<{
          boards: Array<{
            items_page: {
              items: Array<{
                column_values: Array<{ id: string; type: string }>
                subitems: Array<{
                  column_values: Array<{ id: string; type: string }>
                }>
              }>
            }
          }>
        }>(mondayApiToken, itemsQuery, { boardId: [board.id] })

        const boardData = itemsData.boards?.[0]
        if (boardData?.items_page?.items) {
          // Find the first item that has subtasks
          const itemWithSubtasks = boardData.items_page.items.find((item: any) => 
            item.subitems && item.subitems.length > 0
          )
          
          // Get parent item column IDs (from the first item)
          const firstItem = boardData.items_page.items[0]
          if (firstItem) {
            const parentColumnIds = new Set(firstItem.column_values.map((cv: any) => cv.id))
            board.parentColumns = board.columns.filter((col) => parentColumnIds.has(col.id))
          } else {
            board.parentColumns = board.columns
          }
          
          // For subitems (subtasks): Get columns that actually exist on subitems
          // IMPORTANT: Subitems may have columns that don't exist in board.columns!
          // We need to build a column list from actual subitem columns, not just filter board.columns
          if (itemWithSubtasks && itemWithSubtasks.subitems.length > 0) {
            // Collect ALL unique columns from ALL subitems with their details
            const subitemColumnMap = new Map<string, { id: string; title: string; type: string }>()
            
            // First pass: collect all subitem column IDs
            itemWithSubtasks.subitems.forEach((subitem: any) => {
              if (subitem.column_values && Array.isArray(subitem.column_values)) {
                subitem.column_values.forEach((cv: any) => {
                  if (cv.id) {
                    // Try to get title from board.columns first, or use text/value as fallback
                    const boardCol = board.columns.find((c) => c.id === cv.id)
                    const title = boardCol?.title || cv.text || cv.id || 'Unknown Column'
                    
                    subitemColumnMap.set(cv.id, {
                      id: cv.id,
                      title: title,
                      type: cv.type || boardCol?.type || 'unknown',
                    })
                  }
                })
              }
            })
            
            // Create column list: 
            // 1. Columns from board.columns that exist on subitems (these have proper titles)
            // 2. Subitem-specific columns that aren't in board.columns (like 'estimated', 'timerange_mky9t55j')
            const subitemColumnsFromBoard = board.columns.filter((col) => subitemColumnMap.has(col.id))
            
            // Get subitem-specific columns (not in board.columns) and try to get better titles
            const subitemSpecificColumnIds = Array.from(subitemColumnMap.keys()).filter(
              (colId) => !board.columns.some((bc) => bc.id === colId)
            )
            
            // For subitem-specific columns, try to get title from Monday.com API response
            // Or use a descriptive name based on the column ID
            const subitemSpecificColumns = subitemSpecificColumnIds.map((colId) => {
              const col = subitemColumnMap.get(colId)!
              // Try to make a better title if we have text from the column value
              let title = col.title
              if (title === colId || title === 'Unknown Column') {
                // Make a readable title from the ID
                title = colId
                  .replace(/^estimated$/i, 'Estimated')
                  .replace(/^timerange_/i, 'Time Range')
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, (l) => l.toUpperCase())
              }
              return { ...col, title }
            })
            
            // Combine: board columns that exist on subitems + subitem-specific columns
            board.subtaskColumns = [...subitemColumnsFromBoard, ...subitemSpecificColumns]
          } else {
            // No subitems found, use all board columns for subitems
            board.subtaskColumns = board.columns
          }
        } else {
          // No items found, assume all columns are available for both
          board.parentColumns = board.columns
          // Subtasks always inherit all board columns
          board.subtaskColumns = board.columns
        }
      } catch (error) {
        // If we can't fetch items, use all columns for both
        board.parentColumns = board.columns
        // Subtasks always inherit all board columns in Monday.com
        board.subtaskColumns = board.columns
      }
    }

    return { success: true, boards }
  } catch (error) {
    console.error('Error fetching Monday.com boards:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch boards' }
  }
}

/**
 * Get existing column mappings
 */
export async function getColumnMappings(boardId?: string) {
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
    // Fetch all mappings - we'll filter in JavaScript to prioritize board-specific ones
    const { data, error } = await supabase
      .from('monday_column_mappings')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    // If boardId is provided, prioritize board-specific mappings over global ones
    // Process the results to return the most specific mapping for each column_type
    if (boardId && data && data.length > 0) {
      const mappingMap = new Map<string, any>()
      
      // First pass: collect board-specific mappings
      data.forEach((m: any) => {
        if (m.board_id === boardId) {
          mappingMap.set(m.column_type, m)
        }
      })
      
      // Second pass: add global mappings (board_id = null) only if no board-specific mapping exists
      data.forEach((m: any) => {
        if (m.board_id === null && !mappingMap.has(m.column_type)) {
          mappingMap.set(m.column_type, m)
        }
      })
      
      return { success: true, mappings: Array.from(mappingMap.values()) }
    }
    
    // If no boardId or no data, return all mappings (for backward compatibility)
    // or return empty array if boardId was specified but no mappings found
    if (boardId) {
      return { success: true, mappings: [] }
    }

    return { success: true, mappings: data || [] }
  } catch (error) {
    console.error('Error fetching column mappings:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch mappings' }
  }
}

/**
 * Save column mapping
 */
export async function saveColumnMapping(
  columnType: 'client' | 'quoted_hours' | 'timeline',
  columnId: string,
  boardId?: string,
  workspaceId?: string
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
    // Check if mapping already exists for this type/board/workspace combination
    let query = supabase
      .from('monday_column_mappings')
      .select('id')
      .eq('column_type', columnType)
    
    if (boardId) {
      query = query.eq('board_id', boardId)
    } else {
      query = query.is('board_id', null)
    }

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId)
    } else {
      query = query.is('workspace_id', null)
    }
    
    const { data: existing } = await query.maybeSingle()

    if (existing) {
      // Update existing mapping
      const { error } = await supabase
        .from('monday_column_mappings')
        .update({
          monday_column_id: columnId,
          board_id: boardId ?? null,
          workspace_id: workspaceId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (error) throw error
    } else {
      // Insert new mapping
      const { error } = await supabase
        .from('monday_column_mappings')
        .insert({
          column_type: columnType,
          monday_column_id: columnId,
          board_id: boardId ?? null,
          workspace_id: workspaceId ?? null,
        })

      if (error) throw error
    }

    return { success: true }
  } catch (error) {
    console.error('Error saving column mapping:', error)
    return { error: error instanceof Error ? error.message : 'Failed to save mapping' }
  }
}

/**
 * Delete all column mappings for a board
 */
export async function deleteColumnMappings(boardId?: string) {
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
    if (boardId) {
      // Delete board-specific mappings
      const { error } = await supabase
        .from('monday_column_mappings')
        .delete()
        .eq('board_id', boardId)
      
      if (error) throw error
    } else {
      // Delete all global mappings (board_id = null)
      const { error } = await supabase
        .from('monday_column_mappings')
        .delete()
        .is('board_id', null)
      
      if (error) throw error
    }

    return { success: true }
  } catch (error) {
    console.error('Error deleting column mappings:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete mappings' }
  }
}

/**
 * Get all boards with their column mappings grouped by type (Main Projects vs Flexi-Design)
 */
export async function getAllBoardsWithMappings() {
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
    // Get all column mappings
    const { data: mappings } = await supabase
      .from('monday_column_mappings')
      .select('*')
      .not('board_id', 'is', null)
      .order('created_at', { ascending: false })

    if (!mappings || mappings.length === 0) {
      return { success: true, boards: [] }
    }

    // Get unique board IDs from mappings
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
      return { error: 'Failed to fetch boards from Monday.com' }
    }

    const result = await response.json()
    if (result.errors) {
      return { error: result.errors.map((e: any) => e.message).join(', ') }
    }

    // Group mappings by board
    const boardsWithMappings = (result.data?.boards || []).map((board: { id: string; name: string }) => {
      const boardMappings = mappings.filter((m: any) => m.board_id === board.id)
      const mappingObj: Record<string, string> = {}
      boardMappings.forEach((m: any) => {
        mappingObj[m.column_type] = m.monday_column_id
      })

      return {
        id: board.id,
        name: board.name,
        mappings: mappingObj,
        isFlexiDesign: board.name.toLowerCase().includes('flexi'),
      }
    })

    return { success: true, boards: boardsWithMappings }
  } catch (error) {
    console.error('Error fetching boards with mappings:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch boards' }
  }
}

