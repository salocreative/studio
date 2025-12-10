'use server'

import { createClient } from '@/lib/supabase/server'
import { getLeadsBoard } from './leads-board'
import { getMondayWorkspaces } from './column-mappings'

const MONDAY_API_URL = 'https://api.monday.com/v2'

interface CreateQuoteToMondayParams {
  projectTitle: string
  customerType: 'partner' | 'client'
  items: Array<{
    title: string
    hours: number
    isDays: boolean
  }>
  subtotal: number
}

/**
 * Create a Monday.com item with subtasks from a quote
 */
export async function createQuoteToMonday(params: CreateQuoteToMondayParams) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if user is admin, designer, or manager
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userProfile || (userProfile.role !== 'admin' && userProfile.role !== 'designer' && userProfile.role !== 'manager')) {
    return { error: 'Unauthorized: Admin, Designer, or Manager access required' }
  }

  // Get Monday.com API token
  const mondayApiToken = process.env.MONDAY_API_TOKEN
  if (!mondayApiToken) {
    return { error: 'Monday.com API token not configured' }
  }

  try {
    // Get Leads board
    const leadsBoardResult = await getLeadsBoard()
    if (leadsBoardResult.error || !leadsBoardResult.board) {
      return { error: 'Leads board not configured. Please configure it in Settings → Monday.com Configuration → Leads Board.' }
    }

    const leadsBoardId = leadsBoardResult.board.monday_board_id

    // Helper function to get column mapping with fallback logic
    const getColumnMapping = async (columnType: string): Promise<string | undefined> => {
      const { data: allMappings } = await supabase
        .from('monday_column_mappings')
        .select('monday_column_id, column_type, board_id')
        .eq('column_type', columnType)

      if (!allMappings || allMappings.length === 0) {
        return undefined
      }

      // First, try board-specific mapping
      const boardSpecificMapping = allMappings.find(m => m.board_id === leadsBoardId)
      if (boardSpecificMapping) {
        return boardSpecificMapping.monday_column_id
      }

      // Try global mapping (board_id is null)
      const globalMapping = allMappings.find(m => !m.board_id)
      if (globalMapping) {
        return globalMapping.monday_column_id
      }

      // Fallback: use any mapping (for boards that share column structure)
      if (allMappings.length > 0) {
        return allMappings[0].monday_column_id
      }

      return undefined
    }

    // Get quoted_hours column mapping for subtasks
    const quotedHoursColumnId = await getColumnMapping('quoted_hours')
    if (!quotedHoursColumnId) {
      return { error: 'Quoted hours column not mapped. Please configure it in Settings → Monday.com Configuration → Column Mappings for the Leads board or globally.' }
    }

    // Get quote_value column mapping for main item (optional)
    const quoteValueColumnId = await getColumnMapping('quote_value')

    // First, create the main item (project)
    // Column values need to be a JSON string for Monday.com API
    const createItemMutation = `
      mutation($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
        create_item(
          board_id: $boardId,
          item_name: $itemName,
          column_values: $columnValues
        ) {
          id
          name
        }
      }
    `

    // Build column values for the main item
    const mainItemColumnValues: Record<string, any> = {}
    
    // Add quote value if column is mapped
    if (quoteValueColumnId && params.subtotal) {
      // For number columns in Monday.com, pass as string
      mainItemColumnValues[quoteValueColumnId] = params.subtotal.toFixed(2)
    }

    const createItemResponse = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: mondayApiToken,
      },
      body: JSON.stringify({
        query: createItemMutation,
        variables: {
          boardId: leadsBoardId,
          itemName: params.projectTitle,
          columnValues: JSON.stringify(mainItemColumnValues),
        },
      }),
    })

    if (!createItemResponse.ok) {
      throw new Error(`Failed to create Monday.com item: ${createItemResponse.statusText}`)
    }

    const createItemData = await createItemResponse.json()

    if (createItemData.errors) {
      throw new Error(`Monday.com API errors: ${createItemData.errors.map((e: any) => e.message).join(', ')}`)
    }

    const itemId = createItemData.data?.create_item?.id

    if (!itemId) {
      throw new Error('Failed to create Monday.com item: No item ID returned')
    }

    // Get current rate to convert days to hours if needed
    const { data: currentRate } = await supabase
      .from('quote_rates')
      .select('hours_per_day')
      .eq('customer_type', params.customerType)
      .single()

    const hoursPerDay = currentRate?.hours_per_day || 6

    // Create subtasks for each quote item
    const subtaskIds: string[] = []
    
    for (const item of params.items) {
      // Convert days to hours if needed
      const hours = item.isDays ? item.hours * hoursPerDay : item.hours

      // Format the hours value for Monday.com
      // For numeric columns in Monday.com, the value format depends on column type
      // Numbers columns typically expect: { "number": value }
      // But we can also try just passing the number as a string
      // Column values need to be a JSON string containing the column ID as key
      const columnValuesObj: Record<string, any> = {}
      // Try format for numeric columns: just pass the number as a string
      // Monday.com will parse it correctly for number columns
      columnValuesObj[quotedHoursColumnId] = hours.toString()

      const createSubtaskMutation = `
        mutation($parentItemId: ID!, $itemName: String!, $columnValues: JSON!) {
          create_subitem(
            parent_item_id: $parentItemId,
            item_name: $itemName,
            column_values: $columnValues
          ) {
            id
            name
          }
        }
      `

      const createSubtaskResponse = await fetch(MONDAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: mondayApiToken,
        },
        body: JSON.stringify({
          query: createSubtaskMutation,
          variables: {
            parentItemId: itemId,
            itemName: item.title,
            columnValues: JSON.stringify(columnValuesObj),
          },
        }),
      })

      if (!createSubtaskResponse.ok) {
        console.error(`Failed to create subtask "${item.title}": ${createSubtaskResponse.statusText}`)
        continue // Continue with other subtasks even if one fails
      }

      const createSubtaskData = await createSubtaskResponse.json()

      if (createSubtaskData.errors) {
        console.error(`Monday.com API errors for subtask "${item.title}":`, createSubtaskData.errors)
        continue
      }

      const subtaskId = createSubtaskData.data?.create_subitem?.id
      if (subtaskId) {
        subtaskIds.push(subtaskId)
      }
    }

    return {
      success: true,
      itemId,
      subtaskIds,
      message: `Quote pushed to Monday.com: Created project "${params.projectTitle}" with ${subtaskIds.length} subtask(s)`,
    }
  } catch (error) {
    console.error('Error creating quote in Monday.com:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to create quote in Monday.com',
    }
  }
}

