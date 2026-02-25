/**
 * Monday.com API integration (server-side only)
 * This will be used to sync projects and tasks from Monday.com
 */

import { createClient } from '@/lib/supabase/server'

const MONDAY_API_URL = 'https://api.monday.com/v2'

const MONDAY_REQUEST_TIMEOUT_MS = 30_000
const MONDAY_MAX_RETRIES = 3
const MONDAY_RETRY_DELAY_MS = 1_000

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EPIPE',
])

function isTransientNetworkError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { cause?: { code?: string } }
  const code = e?.cause?.code ?? e?.code
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return true
  if (err instanceof TypeError && err.message === 'fetch failed' && e?.cause?.code) {
    return TRANSIENT_NETWORK_CODES.has(e.cause.code)
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface MondayProject {
  id: string
  name: string
  board_id: string
  client_name?: string
  agency?: string
  completed_date?: string
  due_date?: string
  status?: string
  quoted_hours?: number
  quote_value?: number
  column_values?: Record<string, any>
  board_name?: string
}

export interface MondayTask {
  id: string
  name: string
  parent_item_id?: string
  assigned_user_ids?: string[]
  quoted_hours?: number
  timeline_start?: string
  timeline_end?: string
  column_values?: Record<string, any>
}

interface MondayApiResponse<T> {
  data: T
  errors?: Array<{ message: string }>
}

/**
 * Make a GraphQL request to Monday.com API.
 * Retries on transient network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff.
 * Uses a request timeout to avoid hanging on slow or unresponsive connections.
 */
async function mondayRequest<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= MONDAY_MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), MONDAY_REQUEST_TIMEOUT_MS)

    try {
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
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Monday.com API error: ${response.statusText}`)
      }

      const result: MondayApiResponse<T> = await response.json()

      if (result.errors && result.errors.length > 0) {
        throw new Error(`Monday.com API errors: ${result.errors.map((e) => e.message).join(', ')}`)
      }

      return result.data
    } catch (err) {
      clearTimeout(timeoutId)
      lastError = err

      const isAbort = err instanceof Error && err.name === 'AbortError'
      const isTransient = isTransientNetworkError(err) || isAbort
      const canRetry = isTransient && attempt < MONDAY_MAX_RETRIES

      if (!canRetry) {
        throw isAbort
          ? new Error('Monday.com API request timed out')
          : err
      }

      const delayMs = MONDAY_RETRY_DELAY_MS * Math.pow(2, attempt)
      await sleep(delayMs)
    }
  }

  throw lastError
}

/**
 * Get all boards from Monday.com
 */
async function getMondayBoards(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const query = `
    query {
      boards(limit: 100) {
        id
        name
      }
    }
  `

  const data = await mondayRequest<{ boards: Array<{ id: string; name: string }> }>(
    accessToken,
    query
  )

  return data.boards || []
}

/**
 * Get projects (items) from Monday.com boards.
 * When syncAllBoards is true, all boards (active + completed) are scanned fully; use for full resync.
 */
export async function getMondayProjects(
  accessToken: string,
  includeCompletedBoards: boolean = false,
  syncAllBoards: boolean = false
): Promise<MondayProject[]> {
  // Get column mappings from Supabase to determine which boards to sync
  const supabase = await createClient()
  const { data: allMappings } = await supabase
    .from('monday_column_mappings')
    .select('monday_column_id, column_type, board_id, workspace_id')
  
  if (!allMappings || allMappings.length === 0) {
    // No mappings configured, return empty array
    return []
  }
  
  // Get unique board IDs and workspace IDs from mappings (only boards with mappings)
  const mappedBoardIds = new Set<string>()
  const mappedWorkspaceIds = new Set<string>()
  allMappings?.forEach(m => {
    if (m.board_id) {
      mappedBoardIds.add(m.board_id)
    }
    if (m.workspace_id) {
      mappedWorkspaceIds.add(m.workspace_id)
    }
  })
  
  // Track completed board IDs to avoid falling back to global mappings for these boards
  // (since they may have different column structures than active boards)
  const completedBoardIds = new Set<string>()
  
  // If including completed boards, fetch those as well
  if (includeCompletedBoards) {
    const { data: completedBoards } = await supabase
      .from('monday_completed_boards')
      .select('monday_board_id')
    
    completedBoards?.forEach(cb => {
      mappedBoardIds.add(cb.monday_board_id)
      completedBoardIds.add(cb.monday_board_id)
    })
    
    // Also include leads board if configured (it needs column mappings too)
    const { data: leadsBoard } = await supabase
      .from('monday_leads_board')
      .select('monday_board_id')
      .maybeSingle()
    
    if (leadsBoard?.monday_board_id) {
      // Only include if it has column mappings
      const hasMappings = allMappings?.some(m => m.board_id === leadsBoard.monday_board_id)
      if (hasMappings) {
        mappedBoardIds.add(leadsBoard.monday_board_id)
      }
    }
    
    // Also include Flexi-Design completed board if configured.
    // Always include it so we never miss completed Flexi-Design projects (fetch-by-ID list).
    const { data: flexiDesignCompletedBoard } = await supabase
      .from('flexi_design_completed_board')
      .select('monday_board_id, board_name')
      .maybeSingle()
    
    if (flexiDesignCompletedBoard?.monday_board_id) {
      const completedBoardId = flexiDesignCompletedBoard.monday_board_id
      mappedBoardIds.add(completedBoardId)
      completedBoardIds.add(completedBoardId)
      // Column mappings: use own mappings if present; otherwise getColumnId will inherit from other Flexi boards
    }
  }
  
  // If no board-specific mappings, we can't sync (need at least one board mapped)
  if (mappedBoardIds.size === 0) {
    return []
  }

  const allBoardIds = Array.from(mappedBoardIds)

  // Split into active boards (full scan) vs completed boards (fetch by ID only)
  const { data: flexiCompletedBoard } = await supabase
    .from('flexi_design_completed_board')
    .select('monday_board_id')
    .maybeSingle()
  const allCompletedBoardIds = new Set(completedBoardIds)
  if (flexiCompletedBoard?.monday_board_id) {
    allCompletedBoardIds.add(flexiCompletedBoard.monday_board_id)
  }
  const activeBoardIds = allBoardIds.filter(id => !allCompletedBoardIds.has(id))
  const completedBoardIdsList = allBoardIds.filter(id => allCompletedBoardIds.has(id))

  // For completed boards: only fetch items we already have in DB (avoid scanning full board).
  // When syncAllBoards, we scan all boards so no fetch-by-ID.
  let completedItemIds: string[] = []
  if (includeCompletedBoards && completedBoardIdsList.length > 0 && !syncAllBoards) {
    const { data: existingCompleted } = await supabase
      .from('monday_projects')
      .select('monday_item_id')
      .in('monday_board_id', completedBoardIdsList)
    completedItemIds = (existingCompleted || []).map(p => p.monday_item_id).filter(Boolean)
  }

  const boardsToSync = syncAllBoards ? allBoardIds : activeBoardIds
  
  // Build a map of board_id -> column_type -> column_id for quick lookup
  const columnMappingsByBoard = new Map<string, Map<string, string>>()
  
  // Add global mappings (board_id = null)
  const globalMappings = new Map<string, string>()
  allMappings?.forEach(m => {
    if (!m.board_id) {
      globalMappings.set(m.column_type, m.monday_column_id)
    }
  })
  
  // Add board-specific mappings
  allMappings?.forEach(m => {
    if (m.board_id) {
      if (!columnMappingsByBoard.has(m.board_id)) {
        columnMappingsByBoard.set(m.board_id, new Map())
      }
      columnMappingsByBoard.get(m.board_id)!.set(m.column_type, m.monday_column_id)
    }
  })
  
  // Build a cache of Flexi-Design board mappings (for inheritance)
  // We'll populate this as we process boards from the API response
  const flexiDesignBoardMappings = new Map<string, string>() // column_type -> column_id
  
  // Helper to get column ID for a board (prioritize board-specific, fallback to other Flexi-Design boards, then global)
  // For completed boards, avoid falling back to global mappings for critical columns (they may have different structures)
  function getColumnId(boardId: string, columnType: string, boardName?: string, requireBoardSpecific: boolean = false): string | undefined {
    const isCompletedBoard = completedBoardIds.has(boardId)
    
    // First, try board-specific mappings
    const boardMappings = columnMappingsByBoard.get(boardId)
    if (boardMappings?.get(columnType)) {
      // If this is a Flexi-Design board, cache the mapping for inheritance
      if (boardName?.toLowerCase().includes('flexi')) {
        flexiDesignBoardMappings.set(columnType, boardMappings.get(columnType)!)
      }
      return boardMappings.get(columnType)
    }
    
    // If no board-specific mapping and this is a Flexi-Design board, try to inherit from cached Flexi-Design mappings
    if (boardName?.toLowerCase().includes('flexi')) {
      const cachedMapping = flexiDesignBoardMappings.get(columnType)
      if (cachedMapping) {
        return cachedMapping
      }
      
      // If not cached yet, find mappings from any other Flexi-Design board that has mappings
      // (This handles the case where we haven't processed a Flexi-Design board yet)
      for (const [otherBoardId, mappings] of columnMappingsByBoard.entries()) {
        if (otherBoardId !== boardId) {
          const mapping = mappings.get(columnType)
          if (mapping) {
            // Cache it for future use
            flexiDesignBoardMappings.set(columnType, mapping)
            return mapping
          }
        }
      }
    }
    
    // For completed boards, don't fall back to global mappings for critical columns like quote_value
    // (they likely have different column structures)
    // Also respect the requireBoardSpecific flag
    if (isCompletedBoard && (columnType === 'quote_value' || requireBoardSpecific)) {
      // Return undefined - this board needs its own mapping configured
      return undefined
    }
    
    // Fallback to global mappings (for active boards or non-critical columns)
    return globalMappings.get(columnType)
  }

  type BoardItem = {
    id: string
    name: string
    column_values: Array<{ id: string; text?: string; value?: string; type: string }>
    board: { id: string }
  }

  const boardsQuery = `
    query($boardIds: [ID!]) {
      boards(ids: $boardIds) {
        id
        name
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values { id text value type }
            board { id }
          }
        }
      }
    }
  `

  const nextPageQuery = `
    query($cursor: String!) {
      next_items_page(cursor: $cursor) {
        cursor
        items {
          id
          name
          column_values { id text value type }
          board { id }
        }
      }
    }
  `

  const data = boardsToSync.length > 0
    ? await mondayRequest<{
        boards: Array<{
          id: string
          name: string
          items_page: { cursor?: string; items: BoardItem[] }
        }>
      }>(accessToken, boardsQuery, { boardIds: boardsToSync })
    : { boards: [] as Array<{ id: string; name: string; items_page: { cursor?: string; items: BoardItem[] } }> }

  const projects: MondayProject[] = []
  const activeItemIds = new Set<string>()

  type BoardInfo = { id: string; name: string }
  const cursorQueue: { board: BoardInfo; cursor: string }[] = []
  for (const board of data.boards || []) {
    if (board.items_page?.cursor) {
      cursorQueue.push({ board: { id: board.id, name: board.name }, cursor: board.items_page.cursor })
    }
    // Get client column ID for this board (from parent items)
    const clientColumnId = getColumnId(board.id, 'client', board.name)
    // Get agency column ID for this board (from parent items)
    const agencyColumnId = getColumnId(board.id, 'agency', board.name)
    // Get quote_value column ID for this board (from parent items)
    // For completed boards, require board-specific mapping (don't fall back to global)
    const isCompletedBoard = completedBoardIds.has(board.id)
    const quoteValueColumnId = getColumnId(board.id, 'quote_value', board.name, isCompletedBoard)
    // Get date column IDs for this board
    const dueDateColumnId = getColumnId(board.id, 'due_date', board.name)
    const completedDateColumnId = getColumnId(board.id, 'completed_date', board.name)

    for (const item of board.items_page.items || []) {
      // Find client name from column values using the mapped column
      let client_name: string | undefined

      if (item.column_values && clientColumnId) {
        const clientColumn = item.column_values.find((cv) => cv.id === clientColumnId)
        if (clientColumn?.text) {
          client_name = clientColumn.text
        }
      }

      // Find agency name from column values using the mapped column
      let agency: string | undefined

      if (item.column_values && agencyColumnId) {
        const agencyColumn = item.column_values.find((cv) => cv.id === agencyColumnId)
        if (agencyColumn?.text) {
          agency = agencyColumn.text
        }
      }

      // Helper function to extract date from column
      const extractDateFromColumn = (columnId: string | undefined): string | undefined => {
        if (!columnId || !item.column_values) return undefined
        
        const dateColumn = item.column_values.find((cv) => cv.id === columnId)
        if (dateColumn) {
          if (dateColumn.value) {
            try {
              const value = JSON.parse(dateColumn.value)
              if (value?.date) {
                return value.date
              } else if (dateColumn.text) {
                // Fallback: try parsing the text if it's a valid date
                const parsedDate = new Date(dateColumn.text)
                if (!isNaN(parsedDate.getTime())) {
                  return parsedDate.toISOString().split('T')[0]
                }
              }
            } catch {
              // If parsing fails, try using text directly
              if (dateColumn.text) {
                const parsedDate = new Date(dateColumn.text)
                if (!isNaN(parsedDate.getTime())) {
                  return parsedDate.toISOString().split('T')[0]
                }
              }
            }
          } else if (dateColumn.text) {
            // Try parsing text directly
            const parsedDate = new Date(dateColumn.text)
            if (!isNaN(parsedDate.getTime())) {
              return parsedDate.toISOString().split('T')[0]
            }
          }
        }
        return undefined
      }

      // Extract completed date (use mapped column if available, fallback to date__1 for backwards compatibility)
      let completed_date: string | undefined
      if (completedDateColumnId) {
        completed_date = extractDateFromColumn(completedDateColumnId)
      }
      // Fallback to hardcoded date__1 if no mapping found (backwards compatibility)
      if (!completed_date) {
        completed_date = extractDateFromColumn('date__1')
      }

      // Extract due date for active projects
      let due_date: string | undefined
      if (dueDateColumnId) {
        due_date = extractDateFromColumn(dueDateColumnId)
      }

      // Extract quote_value from column values using the mapped column
      let quote_value: number | undefined
      if (item.column_values && quoteValueColumnId) {
        const quoteValueColumn = item.column_values.find((cv) => cv.id === quoteValueColumnId)
        if (quoteValueColumn) {
          // Number/currency columns in Monday.com have the value in the value field
          if (quoteValueColumn.value) {
            try {
              const value = JSON.parse(quoteValueColumn.value)
              // Monday.com numbers/currency can be stored as a number directly or in an object
              if (typeof value === 'number') {
                quote_value = value
              } else if (value?.value !== null && value?.value !== undefined) {
                const numValue = typeof value.value === 'number' 
                  ? value.value 
                  : typeof value.value === 'string' 
                    ? parseFloat(value.value) 
                    : parseFloat(String(value.value))
                if (!isNaN(numValue)) {
                  quote_value = numValue
                }
              }
            } catch {
              // If parsing fails, try using text directly
              if (quoteValueColumn.text) {
                const numValue = parseFloat(quoteValueColumn.text.replace(/[£,$,\s]/g, ''))
                if (!isNaN(numValue)) {
                  quote_value = numValue
                }
              }
            }
          } else if (quoteValueColumn.text) {
            // Fallback: try parsing the text if value is not available
            const numValue = parseFloat(quoteValueColumn.text.replace(/[£,$,\s]/g, ''))
            if (!isNaN(numValue)) {
              quote_value = numValue
            }
          }
        }
      }

      // Convert column_values to a more usable format
      const column_values: Record<string, any> = {}
      item.column_values?.forEach((cv) => {
        column_values[cv.id] = {
          text: cv.text,
          value: cv.value ? JSON.parse(cv.value) : null,
          type: cv.type,
        }
      })

      activeItemIds.add(item.id)
      projects.push({
        id: item.id,
        name: item.name,
        board_id: board.id,
        client_name,
        agency,
        completed_date,
        due_date,
        quote_value,
        board_name: board.name,
        column_values,
      })
    }
  }

  // Paginate through boards with more than 500 items (cursor valid 60 min)
  while (cursorQueue.length > 0) {
    const { board, cursor } = cursorQueue.shift()!
    const nextData = await mondayRequest<{ next_items_page: { cursor?: string; items: BoardItem[] } }>(
      accessToken,
      nextPageQuery,
      { cursor }
    )
    const page = nextData.next_items_page
    if (!page?.items?.length) continue
    const clientColumnId = getColumnId(board.id, 'client', board.name)
    const agencyColumnId = getColumnId(board.id, 'agency', board.name)
    const isCompletedBoard = completedBoardIds.has(board.id)
    const quoteValueColumnId = getColumnId(board.id, 'quote_value', board.name, isCompletedBoard)
    const dueDateColumnId = getColumnId(board.id, 'due_date', board.name)
    const completedDateColumnId = getColumnId(board.id, 'completed_date', board.name)
    for (const item of page.items) {
      const extractDateFromColumn = (columnId: string | undefined): string | undefined => {
        if (!columnId || !item.column_values) return undefined
        const dateColumn = item.column_values.find((cv) => cv.id === columnId)
        if (!dateColumn) return undefined
        if (dateColumn.value) {
          try {
            const value = JSON.parse(dateColumn.value)
            if (value?.date) return value.date
            if (dateColumn.text) {
              const d = new Date(dateColumn.text)
              return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : undefined
            }
          } catch {
            if (dateColumn.text) {
              const d = new Date(dateColumn.text)
              return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : undefined
            }
          }
        }
        if (dateColumn.text) {
          const d = new Date(dateColumn.text)
          return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : undefined
        }
        return undefined
      }
      let client_name: string | undefined
      if (clientColumnId) {
        const col = item.column_values?.find((cv) => cv.id === clientColumnId)
        if (col?.text) client_name = col.text
      }
      let agency: string | undefined
      if (agencyColumnId) {
        const col = item.column_values?.find((cv) => cv.id === agencyColumnId)
        if (col?.text) agency = col.text
      }
      let completed_date = completedDateColumnId ? extractDateFromColumn(completedDateColumnId) : undefined
      if (!completed_date) completed_date = extractDateFromColumn('date__1')
      const due_date = dueDateColumnId ? extractDateFromColumn(dueDateColumnId) : undefined
      let quote_value: number | undefined
      if (quoteValueColumnId) {
        const col = item.column_values?.find((cv) => cv.id === quoteValueColumnId)
        if (col) {
          if (col.value) {
            try {
              const v = JSON.parse(col.value)
              quote_value = typeof v === 'number' ? v : parseFloat(String(v?.value ?? v))
              if (isNaN(quote_value!)) quote_value = col.text ? parseFloat(col.text.replace(/[£,$,\s]/g, '')) : undefined
            } catch {
              if (col.text) quote_value = parseFloat(col.text.replace(/[£,$,\s]/g, ''))
            }
          } else if (col.text) quote_value = parseFloat(col.text.replace(/[£,$,\s]/g, ''))
        }
      }
      const column_values: Record<string, any> = {}
      item.column_values?.forEach((cv) => {
        column_values[cv.id] = { text: cv.text, value: cv.value ? JSON.parse(cv.value) : null, type: cv.type }
      })
      activeItemIds.add(item.id)
      projects.push({
        id: item.id,
        name: item.name,
        board_id: board.id,
        client_name,
        agency,
        completed_date,
        due_date,
        quote_value,
        board_name: board.name,
        column_values,
      })
    }
    if (page.cursor) cursorQueue.push({ board, cursor: page.cursor })
  }

  // Fetch completed-board items by ID only when not doing full resync (avoids scanning full completed boards)
  const itemsToFetchById = new Set(completedItemIds)
  if (includeCompletedBoards && !syncAllBoards) {
    const { data: activeDbProjects } = await supabase
      .from('monday_projects')
      .select('monday_item_id')
      .in('status', ['active', 'lead'])
    const possiblyMovedIds = (activeDbProjects || [])
      .map(p => p.monday_item_id)
      .filter((id): id is string => !!id && !activeItemIds.has(id))
    possiblyMovedIds.forEach(id => itemsToFetchById.add(id))
  }

  if (itemsToFetchById.size > 0) {
    const idsToFetch = Array.from(itemsToFetchById)
    const BATCH_SIZE = 100
    for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
      const batch = idsToFetch.slice(i, i + BATCH_SIZE)
      const itemsData = await mondayRequest<{ items: Array<BoardItem & { board: { id: string; name?: string } }> }>(
        accessToken,
        `query($itemIds: [ID!]) {
          items(ids: $itemIds) {
            id
            name
            column_values { id text value type }
            board { id name }
          }
        }`,
        { itemIds: batch }
      )
      for (const item of itemsData.items || []) {
        const boardId = item.board?.id != null ? String(item.board.id) : ''
        const boardName = item.board?.name || ''
        if (!boardId || !allCompletedBoardIds.has(boardId)) continue
        const clientColumnId = getColumnId(boardId, 'client', boardName)
        const agencyColumnId = getColumnId(boardId, 'agency', boardName)
        const isCompletedBoard = true
        const quoteValueColumnId = getColumnId(boardId, 'quote_value', boardName, isCompletedBoard)
        const dueDateColumnId = getColumnId(boardId, 'due_date', boardName)
        const completedDateColumnId = getColumnId(boardId, 'completed_date', boardName)
        const extractDateFromColumn = (columnId: string | undefined): string | undefined => {
          if (!columnId || !item.column_values) return undefined
          const dateColumn = item.column_values.find((cv) => cv.id === columnId)
          if (!dateColumn) return undefined
          if (dateColumn.value) {
            try {
              const value = JSON.parse(dateColumn.value)
              if (value?.date) return value.date
              if (dateColumn.text) {
                const d = new Date(dateColumn.text)
                return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : undefined
              }
            } catch {
              if (dateColumn.text) {
                const d = new Date(dateColumn.text)
                return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : undefined
              }
            }
          }
          if (dateColumn.text) {
            const d = new Date(dateColumn.text)
            return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : undefined
          }
          return undefined
        }
        let client_name: string | undefined
        if (clientColumnId) {
          const col = item.column_values?.find((cv) => cv.id === clientColumnId)
          if (col?.text) client_name = col.text
        }
        let agency: string | undefined
        if (agencyColumnId) {
          const col = item.column_values?.find((cv) => cv.id === agencyColumnId)
          if (col?.text) agency = col.text
        }
        let completed_date = completedDateColumnId ? extractDateFromColumn(completedDateColumnId) : undefined
        if (!completed_date) completed_date = extractDateFromColumn('date__1')
        const due_date = dueDateColumnId ? extractDateFromColumn(dueDateColumnId) : undefined
        let quote_value: number | undefined
        if (quoteValueColumnId) {
          const col = item.column_values?.find((cv) => cv.id === quoteValueColumnId)
          if (col) {
            if (col.value) {
              try {
                const v = JSON.parse(col.value)
                quote_value = typeof v === 'number' ? v : parseFloat(String(v?.value ?? v))
                if (isNaN(quote_value!)) quote_value = col.text ? parseFloat(col.text.replace(/[£,$,\s]/g, '')) : undefined
              } catch {
                if (col.text) quote_value = parseFloat(col.text.replace(/[£,$,\s]/g, ''))
              }
            } else if (col.text) {
              quote_value = parseFloat(col.text.replace(/[£,$,\s]/g, ''))
            }
          }
        }
        const column_values: Record<string, any> = {}
        item.column_values?.forEach((cv) => {
          column_values[cv.id] = { text: cv.text, value: cv.value ? JSON.parse(cv.value) : null, type: cv.type }
        })
        projects.push({
          id: item.id,
          name: item.name,
          board_id: boardId,
          client_name,
          agency,
          completed_date,
          due_date,
          quote_value,
          board_name: boardName || undefined,
          column_values,
        })
      }
    }
  }

  return projects
}

/**
 * Get tasks (subitems) for a specific project
 */
export async function getMondayTasks(
  accessToken: string,
  projectId: string,
  boardId?: string,
  boardName?: string
): Promise<MondayTask[]> {
  // Get column mappings for subtasks (quoted_hours, timeline)
  const supabase = await createClient()
  const { data: allMappings } = await supabase
    .from('monday_column_mappings')
    .select('monday_column_id, column_type, board_id')
    .in('column_type', ['quoted_hours', 'timeline'])
  
  // Build mappings map (board-specific or global)
  let quotedHoursColumnId: string | undefined
  let timelineColumnId: string | undefined
  
  if (boardId && allMappings) {
    // Find board-specific mappings first
    const boardMappings = allMappings.filter(m => m.board_id === boardId)
    if (boardMappings.length > 0) {
      quotedHoursColumnId = boardMappings.find(m => m.column_type === 'quoted_hours')?.monday_column_id
      timelineColumnId = boardMappings.find(m => m.column_type === 'timeline')?.monday_column_id
    }
  }
  
  // If no board-specific mapping and this is a Flexi-Design board, try to inherit from other Flexi-Design boards
  if ((!quotedHoursColumnId || !timelineColumnId) && boardName?.toLowerCase().includes('flexi')) {
    // Find mappings from any other Flexi-Design board that has mappings
    for (const mapping of allMappings || []) {
      if (mapping.board_id && mapping.board_id !== boardId) {
        // If we find a mapping from another board, use it (assuming Flexi-Design boards share structure)
        if (!quotedHoursColumnId && mapping.column_type === 'quoted_hours') {
          quotedHoursColumnId = mapping.monday_column_id
        }
        if (!timelineColumnId && mapping.column_type === 'timeline') {
          timelineColumnId = mapping.monday_column_id
        }
        if (quotedHoursColumnId && timelineColumnId) break
      }
    }
  }
  
  // Fallback to global mappings if no board-specific ones found
  if (!quotedHoursColumnId || !timelineColumnId) {
    const globalMappings = allMappings?.filter(m => !m.board_id) || []
    if (!quotedHoursColumnId) {
      quotedHoursColumnId = globalMappings.find(m => m.column_type === 'quoted_hours')?.monday_column_id
    }
    if (!timelineColumnId) {
      timelineColumnId = globalMappings.find(m => m.column_type === 'timeline')?.monday_column_id
    }
  }

  const query = `
    query($itemId: [ID!]) {
      items(ids: $itemId) {
        id
        name
        board {
          id
        }
        subitems {
          id
          name
          column_values {
            id
            text
            value
            type
          }
        }
      }
    }
  `

  const data = await mondayRequest<{
    items: Array<{
      id: string
      name: string
      board: {
        id: string
      }
      subitems: Array<{
        id: string
        name: string
        column_values: Array<{
          id: string
          text?: string
          value?: string
          type: string
        }>
      }>
    }>
  }>(accessToken, query, { itemId: [projectId] })

  const tasks: MondayTask[] = []

  for (const item of data.items || []) {
    // Use board ID from item if not provided
    const itemBoardId = item.board.id || boardId
    
    // Get mappings for this board if we have it
    let taskQuotedHoursColumnId = quotedHoursColumnId
    let taskTimelineColumnId = timelineColumnId
    
    if (itemBoardId && allMappings) {
      const boardMappings = allMappings.filter(m => m.board_id === itemBoardId)
      if (boardMappings.length > 0) {
        taskQuotedHoursColumnId = boardMappings.find(m => m.column_type === 'quoted_hours')?.monday_column_id || taskQuotedHoursColumnId
        taskTimelineColumnId = boardMappings.find(m => m.column_type === 'timeline')?.monday_column_id || taskTimelineColumnId
      }
    }
    
    for (const subitem of item.subitems || []) {
      let quoted_hours: number | undefined
      let timeline_start: string | undefined
      let timeline_end: string | undefined
      let assigned_user_ids: string[] | undefined

      if (subitem.column_values) {
        // Find quoted hours using mapped column
        if (taskQuotedHoursColumnId) {
          const quotedHoursColumn = subitem.column_values.find((cv) => cv.id === taskQuotedHoursColumnId)
          if (quotedHoursColumn) {
            // Handle different number column types
            if (quotedHoursColumn.text) {
              const numValue = parseFloat(quotedHoursColumn.text)
              if (!isNaN(numValue) && numValue > 0) {
                quoted_hours = numValue
              }
            } else if (quotedHoursColumn.value) {
              try {
                const value = JSON.parse(quotedHoursColumn.value)
                const numValue = typeof value === 'number' ? value : parseFloat(value?.toString() || '0')
                if (!isNaN(numValue) && numValue > 0) {
                  quoted_hours = numValue
                }
              } catch {
                // Ignore parsing errors
              }
            }
          }
        }

        // Find timeline using mapped column
        if (taskTimelineColumnId) {
          const timelineColumn = subitem.column_values.find((cv) => cv.id === taskTimelineColumnId)
          if (timelineColumn?.value) {
            try {
              const value = JSON.parse(timelineColumn.value)
              if (value) {
                if (value.from) timeline_start = value.from
                if (value.to) timeline_end = value.to
                // Handle different timeline formats
                if (!timeline_start && value.start) timeline_start = value.start
                if (!timeline_end && value.end) timeline_end = value.end
              }
            } catch {
              // Ignore parsing errors
            }
          }
        }

        // Try to find assigned users (people column)
        for (const col of subitem.column_values) {
          if (col.type === 'people' && col.value) {
            try {
              const value = JSON.parse(col.value)
              if (Array.isArray(value.personIds)) {
                assigned_user_ids = value.personIds
              } else if (Array.isArray(value)) {
                assigned_user_ids = value.map((v: any) => v.personId || v.id || v).filter(Boolean)
              }
            } catch {
              // Ignore parsing errors
            }
          }
        }
      }

      const column_values: Record<string, any> = {}
      subitem.column_values?.forEach((cv) => {
        column_values[cv.id] = {
          text: cv.text,
          value: cv.value ? JSON.parse(cv.value) : null,
          type: cv.type,
        }
      })

      tasks.push({
        id: subitem.id,
        name: subitem.name,
        parent_item_id: projectId,
        assigned_user_ids: assigned_user_ids?.length ? [...new Set(assigned_user_ids)] : undefined,
        quoted_hours,
        timeline_start,
        timeline_end,
        column_values,
      })
    }
  }

  return tasks
}

export type SyncProgressEvent =
  | { phase: 'fetching'; message: string; progress: number }
  | { phase: 'checking'; message: string; progress: number }
  | { phase: 'syncing'; message: string; projectIndex: number; totalProjects: number; projectName: string; progress: number }
  | { phase: 'complete'; message: string; progress: number; projectsSynced: number; archived: number; deleted: number }
  | { phase: 'error'; message: string }

/**
 * Sync projects and tasks from Monday.com to Supabase
 * This should be called periodically or via webhook
 *
 * Returns the number of projects synced.
 * Optionally accepts onProgress callback for streaming progress updates.
 */
export async function syncMondayData(
  accessToken: string,
  onProgress?: (event: SyncProgressEvent) => void,
  syncAllBoards: boolean = false,
  avoidDeletion: boolean = true
): Promise<{ projectsSynced: number; archived: number; deleted: number }> {
  const supabase = await createClient()
  const report = (e: SyncProgressEvent) => onProgress?.(e)

  try {
    report({
      phase: 'fetching',
      message: syncAllBoards ? 'Fetching all boards from Monday.com...' : 'Fetching projects from Monday.com...',
      progress: 0,
    })

    // 1. Fetch projects from Monday.com (active + completed; syncAllBoards = full scan of all boards)
    const mondayProjects = await getMondayProjects(accessToken, true, syncAllBoards)

    report({ phase: 'checking', message: 'Checking for removed projects...', progress: 0.05 })

    // Get completed board IDs
    const { data: completedBoards } = await supabase
      .from('monday_completed_boards')
      .select('monday_board_id')
    
    const completedBoardIds = new Set(completedBoards?.map(cb => cb.monday_board_id) || [])
    
    // Get leads board ID
    const { data: leadsBoard } = await supabase
      .from('monday_leads_board')
      .select('monday_board_id')
      .maybeSingle()
    
    const leadsBoardId = leadsBoard?.monday_board_id || null
    
    // Get Flexi-Design completed board ID
    const { data: flexiDesignCompletedBoard } = await supabase
      .from('flexi_design_completed_board')
      .select('monday_board_id')
      .maybeSingle()
    
    const flexiDesignCompletedBoardId = flexiDesignCompletedBoard?.monday_board_id || null
    
    // Boards we treat as "completed" - never archive/delete projects on these (safeguard if fetch-by-ID missed them)
    const completedBoardIdsForSafeguard = new Set(completedBoardIds)
    if (flexiDesignCompletedBoardId) completedBoardIdsForSafeguard.add(flexiDesignCompletedBoardId)
    
    // Get column mappings to determine active boards
    const { data: allMappings } = await supabase
      .from('monday_column_mappings')
      .select('board_id')
      .not('board_id', 'is', null)
    
    const activeBoardIds = new Set(allMappings?.map(m => m.board_id) || [])

    // Track projects found in Monday (by monday_item_id)
    const mondayProjectIds = new Set(mondayProjects.map(p => p.id))
    
    // Get all existing projects from Supabase
    const { data: existingProjects } = await supabase
      .from('monday_projects')
      .select('id, monday_item_id, status, monday_board_id')

    let archived = 0
    let deleted = 0

    // 2. Check existing projects - archive or delete if not found in Monday (unless avoidDeletion is set)
    if (existingProjects && !avoidDeletion) {
      for (const existingProject of existingProjects) {
        // Skip if project still exists in Monday
        if (mondayProjectIds.has(existingProject.monday_item_id)) {
          continue
        }
        
        // Safeguard: never archive or delete projects on completed boards (Flexi completed, monday_completed_boards).
        // Quick sync only fetches completed items by ID; if that list was incomplete or API failed, we must not remove them.
        const projectBoardId = existingProject.monday_board_id != null ? String(existingProject.monday_board_id) : ''
        if (projectBoardId && completedBoardIdsForSafeguard.has(projectBoardId)) {
          continue
        }
        // Also never remove projects we've marked as locked (completed) - preserves history if board ID was missing
        if (existingProject.status === 'locked') {
          continue
        }
        
        // Project no longer exists in Monday.com (and is not on a completed board) - handle deletion/archival
        // Check if project has time tracking data
        const { data: timeEntries } = await supabase
          .from('time_entries')
          .select('id')
          .eq('project_id', existingProject.id)
          .limit(1)
        
        const hasTimeEntries = timeEntries && timeEntries.length > 0
        
        if (hasTimeEntries) {
          // Archive if it has time entries (preserve data for reporting)
          // This applies to both active and locked/completed projects
          if (existingProject.status !== 'archived') {
            await supabase
              .from('monday_projects')
              .update({ status: 'archived' })
              .eq('id', existingProject.id)
            archived++
          }
        } else {
          // Delete if no time entries (no data to preserve, safe to remove)
          // This applies even to locked/completed projects that have been deleted from Monday
          await supabase
            .from('monday_projects')
            .delete()
            .eq('id', existingProject.id)
          deleted++
        }
      }
    }

    const totalProjects = mondayProjects.length

    // 3. Sync projects to Supabase
    for (let i = 0; i < mondayProjects.length; i++) {
      const project = mondayProjects[i]
      const progress = 0.1 + 0.85 * (i / Math.max(1, totalProjects))
      report({
        phase: 'syncing',
        message: `Syncing ${project.name}`,
        projectIndex: i + 1,
        totalProjects,
        projectName: project.name,
        progress,
      })
      // Determine status based on board
      const isActive = activeBoardIds.has(project.board_id)
      const isCompleted = completedBoardIds.has(project.board_id)
      const isFlexiDesignCompleted = flexiDesignCompletedBoardId && project.board_id === flexiDesignCompletedBoardId
      const isLead = leadsBoardId && project.board_id === leadsBoardId
      
      // Projects on completed boards should be locked (not just archived)
      // Projects on Flexi-Design completed board should also be locked
      // Projects on leads board should be marked as 'lead'
      let projectStatus: 'active' | 'archived' | 'locked' | 'lead'
      if (isLead) {
        projectStatus = 'lead'
      } else if (isActive) {
        projectStatus = 'active'
      } else if (isCompleted || isFlexiDesignCompleted) {
        projectStatus = 'locked'
      } else {
        projectStatus = 'archived'
      }
      
      // Check if project exists - get full record to preserve quoted_hours and quote_value for locked projects
      const { data: existing } = await supabase
        .from('monday_projects')
        .select('id, status, quoted_hours, quote_value, monday_data')
        .eq('monday_item_id', project.id)
        .single()

      // For locked/completed projects, preserve existing quoted_hours if Monday doesn't provide it
      // This ensures historical budget data is maintained for reflection
      const preserveQuotedHours = existing?.status === 'locked' && (!project.quoted_hours || project.quoted_hours === 0)
      const finalQuotedHours = preserveQuotedHours 
        ? (existing.quoted_hours || project.quoted_hours || null)
        : (project.quoted_hours || null)

      // Handle quote_value - try to extract if not provided, preserve for locked projects if still missing
      let finalQuoteValue = project.quote_value || null
      
      // Helper function to extract quote_value from monday_data/column_values
      const extractQuoteValue = (data: Record<string, any> | undefined, columnId: string | null | undefined): number | null => {
        if (!data || !columnId || !data[columnId]) return null
        
        const valueColumn = data[columnId]
        if (valueColumn.value !== null && valueColumn.value !== undefined) {
          try {
            let parsedValue: number
            if (typeof valueColumn.value === 'number') {
              parsedValue = valueColumn.value
            } else if (typeof valueColumn.value === 'object' && valueColumn.value?.value !== undefined) {
              parsedValue = typeof valueColumn.value.value === 'number' 
                ? valueColumn.value.value 
                : parseFloat(String(valueColumn.value.value))
            } else {
              parsedValue = parseFloat(String(valueColumn.value))
            }
            if (!isNaN(parsedValue)) {
              return parsedValue
            }
          } catch {
            // Ignore parsing errors
          }
        }
        
        if (valueColumn.text) {
          const numValue = parseFloat(valueColumn.text.replace(/[£,$,\s]/g, ''))
          if (!isNaN(numValue)) {
            return numValue
          }
        }
        
        return null
      }

      // Get quote_value column mapping for this board
      const { data: quoteValueMapping } = await supabase
        .from('monday_column_mappings')
        .select('monday_column_id')
        .eq('column_type', 'quote_value')
        .or(`board_id.eq.${project.board_id},board_id.is.null`)
        .order('board_id', { ascending: true, nullsFirst: false }) // Prefer board-specific
        .maybeSingle()
      
      const quoteValueColumnId = quoteValueMapping?.monday_column_id || null
      
      // If quote_value wasn't extracted but we have column_values, try to extract it now (auto-backfill)
      if (!finalQuoteValue && project.column_values && quoteValueColumnId) {
        finalQuoteValue = extractQuoteValue(project.column_values, quoteValueColumnId)
      }

      // For locked projects, preserve existing quote_value if we couldn't extract a new one
      // This ensures historical data is maintained
      if (existing?.status === 'locked' && (!finalQuoteValue || finalQuoteValue === 0)) {
        finalQuoteValue = existing.quote_value || null
        
        // If still no value and we have existing monday_data, try extracting from that
        if (!finalQuoteValue && existing.monday_data && quoteValueColumnId) {
          finalQuoteValue = extractQuoteValue(existing.monday_data, quoteValueColumnId)
        }
      }

      // Handle status transitions
      // - Leads can move to active, but once active/completed they shouldn't go back to lead
      // - Locked projects stay locked (preserve time tracking data)
      // - If project was previously a lead and is now on leads board, keep it as lead
      // - If project was previously a lead and moved to active board, change to active
      let finalStatus = projectStatus
      if (existing) {
        if (existing.status === 'locked') {
          // Once locked, stay locked (preserve time tracking data)
          finalStatus = 'locked'
        } else if (existing.status === 'lead' && !isLead) {
          // Lead moved to active/completed board, update status accordingly
          finalStatus = projectStatus
        } else if (isLead) {
          // On leads board, should be 'lead' status
          finalStatus = 'lead'
        } else if (isCompleted) {
          // On completed board, should be 'locked'
          finalStatus = 'locked'
        }
      }

      const projectData = {
        monday_item_id: project.id,
        monday_board_id: project.board_id,
        name: project.name,
        client_name: project.client_name || null,
        agency: project.agency || null,
        completed_date: project.completed_date || null,
        due_date: project.due_date || null,
        quoted_hours: finalQuotedHours,
        quote_value: finalQuoteValue,
        monday_data: project.column_values,
        status: finalStatus,
        updated_at: new Date().toISOString(),
      }

      if (existing) {
        // Update existing project
        await supabase
          .from('monday_projects')
          .update(projectData)
          .eq('monday_item_id', project.id)
      } else {
        // Insert new project
        await supabase.from('monday_projects').insert(projectData)
      }

      // 3. Fetch and sync tasks for this project
      const { data: projectRecord } = await supabase
        .from('monday_projects')
        .select('id, status')
        .eq('monday_item_id', project.id)
        .single()

      if (projectRecord) {
        const isProjectLocked = projectRecord.status === 'locked'
        const mondayTasks = await getMondayTasks(accessToken, project.id, project.board_id, project.board_name)

        // Get existing tasks to preserve quoted_hours for locked projects
        const { data: existingTasks } = await supabase
          .from('monday_tasks')
          .select('id, monday_item_id, quoted_hours')
          .eq('project_id', projectRecord.id)

        // Track total quoted hours from tasks
        let totalTaskQuotedHours = 0

        for (const task of mondayTasks) {
          // For locked projects, preserve existing quoted_hours if Monday doesn't provide it
          const existingTask = existingTasks?.find(t => t.monday_item_id === task.id)
          const preserveTaskQuotedHours = isProjectLocked && existingTask && (!task.quoted_hours || task.quoted_hours === 0)
          const finalTaskQuotedHours = preserveTaskQuotedHours
            ? (existingTask.quoted_hours || task.quoted_hours || null)
            : (task.quoted_hours || null)

          // Add to total (use 0 if null)
          if (finalTaskQuotedHours) {
            totalTaskQuotedHours += finalTaskQuotedHours
          }

          const taskData = {
            monday_item_id: task.id,
            project_id: projectRecord.id,
            name: task.name,
            is_subtask: true,
            parent_task_id: null, // Can be set if there are nested subtasks
            assigned_user_ids: task.assigned_user_ids || null,
            quoted_hours: finalTaskQuotedHours,
            timeline_start: task.timeline_start || null,
            timeline_end: task.timeline_end || null,
            monday_data: task.column_values,
            updated_at: new Date().toISOString(),
          }

          // Check if task exists
          const { data: existingTaskRecord } = await supabase
            .from('monday_tasks')
            .select('id')
            .eq('monday_item_id', task.id)
            .single()

          if (existingTaskRecord) {
            await supabase
              .from('monday_tasks')
              .update(taskData)
              .eq('monday_item_id', task.id)
          } else {
            await supabase.from('monday_tasks').insert(taskData)
          }
        }

        // Update project's quoted_hours as sum of all task quoted_hours
        // For locked projects: only update if new total is greater than 0, or if existing is 0/null
        // This preserves historical budget data while still allowing updates when tasks are synced
        const shouldUpdateQuotedHours = !isProjectLocked || 
          totalTaskQuotedHours > 0 || 
          !existing?.quoted_hours || 
          existing.quoted_hours === 0
        
        if (shouldUpdateQuotedHours) {
          const updatedQuotedHours = totalTaskQuotedHours > 0 ? totalTaskQuotedHours : (existing?.quoted_hours || null)
          await supabase
            .from('monday_projects')
            .update({ 
              quoted_hours: updatedQuotedHours,
              updated_at: new Date().toISOString()
            })
            .eq('id', projectRecord.id)
        }

        // Clean up orphaned tasks (tasks that exist in DB but not in Monday.com)
        // Track which Monday task IDs we just synced
        const syncedMondayTaskIds = new Set(mondayTasks.map(t => t.id))
        
        // Find tasks in DB that weren't in the sync (orphaned tasks)
        if (existingTasks) {
          for (const dbTask of existingTasks) {
            // Skip if this task was just synced
            if (syncedMondayTaskIds.has(dbTask.monday_item_id)) {
              continue
            }
            
            // Task exists in DB but not in Monday.com - check if it can be deleted
            // Check if task has any time entries (on delete restrict prevents deletion if it does)
            const { data: taskTimeEntries } = await supabase
              .from('time_entries')
              .select('id')
              .eq('task_id', dbTask.id)
              .limit(1)
            
            const hasTimeEntries = taskTimeEntries && taskTimeEntries.length > 0
            
            if (!hasTimeEntries) {
              // Safe to delete - no time entries referencing it
              await supabase
                .from('monday_tasks')
                .delete()
                .eq('id', dbTask.id)
            }
            // If has time entries, we keep it (can't delete due to foreign key constraint)
            // This preserves historical time tracking data
          }
        }
      }
    }

    const result = {
      projectsSynced: mondayProjects.length,
      archived,
      deleted,
    }
    report({
      phase: 'complete',
      message: 'Sync complete',
      progress: 1,
      ...result,
    })
    return result
  } catch (error) {
    console.error('Error syncing Monday.com data:', error)
    report({
      phase: 'error',
      message: error instanceof Error ? error.message : 'Sync failed',
    })
    throw error
  }
}


