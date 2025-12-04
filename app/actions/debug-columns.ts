'use server'

/**
 * Debug endpoint to check what columns are being returned
 * This can be called from the browser to see server-side data
 */

import { createClient } from '@/lib/supabase/server'

export async function debugBoardColumns(boardId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const mondayApiToken = process.env.MONDAY_API_TOKEN
  if (!mondayApiToken) {
    return { error: 'Monday.com API token not configured' }
  }

  const MONDAY_API_URL = 'https://api.monday.com/v2'

  try {
    const query = `
      query($boardId: [ID!]) {
        boards(ids: $boardId) {
          id
          name
          columns {
            id
            title
            type
          }
          items_page(limit: 5) {
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

    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: mondayApiToken,
      },
      body: JSON.stringify({
        query,
        variables: { boardId: [boardId] },
      }),
    })

    const result = await response.json()
    
    if (result.errors) {
      return { error: result.errors.map((e: any) => e.message).join(', ') }
    }

    const board = result.data.boards?.[0]
    if (!board) {
      return { error: 'Board not found' }
    }

    const debugInfo = {
      board: {
        id: board.id,
        name: board.name,
        allColumnIds: board.columns.map((c: any) => c.id),
        allColumns: board.columns.map((c: any) => ({ id: c.id, title: c.title, type: c.type })),
      },
      items: board.items_page.items.map((item: any) => ({
        id: item.id,
        name: item.name,
        parentColumnIds: item.column_values.map((cv: any) => cv.id),
        subitems: item.subitems.map((subitem: any) => ({
          id: subitem.id,
          name: subitem.name,
          columnIds: subitem.column_values.map((cv: any) => cv.id),
          columns: subitem.column_values.map((cv: any) => ({ id: cv.id, type: cv.type, text: cv.text })),
        })),
      })),
    }

    // Find items with subitems
    const itemsWithSubitems = debugInfo.items.filter((item: any) => item.subitems.length > 0)
    const allSubitemColumnIds = new Set<string>()
    itemsWithSubitems.forEach((item: any) => {
      item.subitems.forEach((subitem: any) => {
        subitem.columnIds.forEach((id: string) => allSubitemColumnIds.add(id))
      })
    })

    return {
      success: true,
      debug: {
        ...debugInfo,
        summary: {
          totalBoardColumns: board.columns.length,
          itemsWithSubitems: itemsWithSubitems.length,
          uniqueSubitemColumnIds: Array.from(allSubitemColumnIds),
          hasEstimated: allSubitemColumnIds.has('estimated'),
          hasTimerange: allSubitemColumnIds.has('timerange_mky9t55j'),
        },
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to debug' }
  }
}

