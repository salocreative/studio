/**
 * Monday.com API integration (server-side only)
 * This will be used to sync projects and tasks from Monday.com
 */

import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  extractLikelihoodFromMondayData,
  extractLikelihoodFromRaw,
  extractMondayStatusFromMondayData,
  extractMondayStatusFromRaw,
} from '@/lib/monday/column-extract'
import { findMappingColumnId, type ColumnMappingRow } from '@/lib/monday/mapping-resolver'
import { getTaskCompletionFromStatus } from '@/lib/monday/task-completion'

const MONDAY_API_URL = 'https://api.monday.com/v2'

/**
 * Monday caps an `items(ids:)` query at its `limit` argument, which defaults to 25: ids beyond the
 * limit are dropped from the response, not paginated into a second page. Every `items(ids:)` query
 * therefore passes an explicit limit, and id batches are sized to match it. 100 is Monday's maximum.
 */
const MONDAY_ITEMS_BY_ID_LIMIT = 100

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

/**
 * Monday reports a spent rate limit or complexity budget two ways: an HTTP 429, or a 200 whose
 * `errors` say so. Both are worth waiting out - the budget resets on a timer - rather than failing
 * the sync, which is what used to happen.
 */
const MONDAY_RATE_LIMIT_PATTERN = /complexity budget exhausted|rate limit|too many requests|minute limit/i
const MONDAY_RESET_PATTERN = /reset in (\d+) seconds?/i
const MONDAY_MAX_RATE_LIMIT_WAIT_MS = 60_000

/** Exponential backoff for retry number `attempt`. */
function backoffMs(attempt: number): number {
  return MONDAY_RETRY_DELAY_MS * Math.pow(2, attempt)
}

/**
 * Clamp a wait Monday asked for to something a sync can afford to sit through, falling back to the
 * standard backoff when it named no time at all.
 */
function clampRateLimitWait(ms: number, fallbackMs: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return fallbackMs
  return Math.min(ms, MONDAY_MAX_RATE_LIMIT_WAIT_MS)
}

/** Wait for a 429, from `Retry-After` (seconds) when Monday sends one. */
function retryAfterWaitMs(header: string | null, attempt: number): number {
  const seconds = Number(header)
  return clampRateLimitWait(Number.isFinite(seconds) ? seconds * 1_000 : NaN, backoffMs(attempt))
}

/** Wait for a 200-with-errors rate limit, from the "reset in N seconds" the message carries. */
function rateLimitWaitMsFromMessage(message: string, attempt: number): number | null {
  if (!MONDAY_RATE_LIMIT_PATTERN.test(message)) return null
  const reset = MONDAY_RESET_PATTERN.exec(message)
  return clampRateLimitWait(reset ? Number(reset[1]) * 1_000 : NaN, backoffMs(attempt))
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
  monday_status?: string
  likelihood?: number
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
 * Retries on transient network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff, and
 * on a spent rate limit or complexity budget after waiting however long Monday asks for.
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
        const error = new Error(`Monday.com API error: ${response.statusText}`)
        if ((response.status === 429 || response.status === 503) && attempt < MONDAY_MAX_RETRIES) {
          lastError = error
          await sleep(retryAfterWaitMs(response.headers.get('retry-after'), attempt))
          continue
        }
        throw error
      }

      const result: MondayApiResponse<T> = await response.json()

      if (result.errors && result.errors.length > 0) {
        const message = result.errors.map((e) => e.message).join(', ')
        const error = new Error(`Monday.com API errors: ${message}`)
        const rateLimitWait = rateLimitWaitMsFromMessage(message, attempt)
        if (rateLimitWait !== null && attempt < MONDAY_MAX_RETRIES) {
          lastError = error
          await sleep(rateLimitWait)
          continue
        }
        throw error
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

      await sleep(backoffMs(attempt))
    }
  }

  throw lastError
}

/**
 * Get projects (items) from Monday.com boards.
 * When syncAllBoards is true, all boards (active + completed) are scanned fully; use for full resync.
 */
export async function getMondayProjects(
  accessToken: string,
  includeCompletedBoards: boolean = false,
  syncAllBoards: boolean = false,
  /** Service-role client for sync (bypasses RLS); defaults to user-scoped client */
  dbClient?: SupabaseClient
): Promise<MondayProject[]> {
  // Get column mappings from Supabase to determine which boards to sync
  const supabase = dbClient ?? (await createClient())
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
  
  // The Flexi-Design completed board, read once: it counts as a completed board for column
  // mapping fallbacks, and is always excluded from the boards that get a full scan.
  const { data: flexiCompletedBoard } = await supabase
    .from('flexi_design_completed_board')
    .select('monday_board_id')
    .maybeSingle()
  const flexiCompletedBoardId: string | null = flexiCompletedBoard?.monday_board_id ?? null

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
    if (flexiCompletedBoardId) {
      mappedBoardIds.add(flexiCompletedBoardId)
      completedBoardIds.add(flexiCompletedBoardId)
      // Column mappings: use own mappings if present; otherwise getColumnId will inherit from other Flexi boards
    }
  }
  
  // If no board-specific mappings, we can't sync (need at least one board mapped)
  if (mappedBoardIds.size === 0) {
    return []
  }

  const allBoardIds = Array.from(mappedBoardIds)

  // Split into active boards (full scan) vs completed boards (fetch by ID only)
  const allCompletedBoardIds = new Set(completedBoardIds)
  if (flexiCompletedBoardId) {
    allCompletedBoardIds.add(flexiCompletedBoardId)
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
    group?: { id: string; title: string }
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
            group { id title }
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
          group { id title }
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
    const statusColumnId = getColumnId(board.id, 'status', board.name)
    const likelihoodColumnId = getColumnId(board.id, 'likelihood', board.name)

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

      const monday_status = extractMondayStatusFromRaw(item.column_values, statusColumnId) ?? undefined
      const likelihood = extractLikelihoodFromRaw(item.column_values, likelihoodColumnId) ?? undefined

      // Convert column_values to a more usable format
      const column_values: Record<string, any> = {}
      item.column_values?.forEach((cv) => {
        column_values[cv.id] = {
          text: cv.text,
          value: cv.value ? JSON.parse(cv.value) : null,
          type: cv.type,
        }
      })
      if (item.group?.id || item.group?.title) {
        const gid = item.group?.id != null ? String(item.group.id) : ''
        const gtitle = item.group?.title != null ? String(item.group.title) : ''
        if (gid) column_values._group_id = gid
        if (gtitle) column_values._group_title = gtitle
        column_values.__monday_group = { id: gid, title: gtitle }
      }

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
        monday_status,
        likelihood,
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
    const statusColumnId = getColumnId(board.id, 'status', board.name)
    const likelihoodColumnId = getColumnId(board.id, 'likelihood', board.name)
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
      const monday_status = extractMondayStatusFromRaw(item.column_values, statusColumnId) ?? undefined
      const likelihood = extractLikelihoodFromRaw(item.column_values, likelihoodColumnId) ?? undefined
      const column_values: Record<string, any> = {}
      item.column_values?.forEach((cv) => {
        column_values[cv.id] = { text: cv.text, value: cv.value ? JSON.parse(cv.value) : null, type: cv.type }
      })
      if (item.group?.id || item.group?.title) {
        const gid = item.group?.id != null ? String(item.group.id) : ''
        const gtitle = item.group?.title != null ? String(item.group.title) : ''
        if (gid) column_values._group_id = gid
        if (gtitle) column_values._group_title = gtitle
        column_values.__monday_group = { id: gid, title: gtitle }
      }
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
        monday_status,
        likelihood,
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
    for (let i = 0; i < idsToFetch.length; i += MONDAY_ITEMS_BY_ID_LIMIT) {
      const batch = idsToFetch.slice(i, i + MONDAY_ITEMS_BY_ID_LIMIT)
      const itemsData = await mondayRequest<{ items: Array<BoardItem & { board: { id: string; name?: string } }> }>(
        accessToken,
        `query($itemIds: [ID!], $limit: Int!) {
          items(ids: $itemIds, limit: $limit) {
            id
            name
            column_values { id text value type }
            board { id name }
            group { id title }
          }
        }`,
        { itemIds: batch, limit: MONDAY_ITEMS_BY_ID_LIMIT }
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
        const statusColumnId = getColumnId(boardId, 'status', boardName)
        const likelihoodColumnId = getColumnId(boardId, 'likelihood', boardName)
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
        const monday_status = extractMondayStatusFromRaw(item.column_values, statusColumnId) ?? undefined
        const likelihood = extractLikelihoodFromRaw(item.column_values, likelihoodColumnId) ?? undefined
        const column_values: Record<string, any> = {}
        item.column_values?.forEach((cv) => {
          column_values[cv.id] = { text: cv.text, value: cv.value ? JSON.parse(cv.value) : null, type: cv.type }
        })
        if (item.group?.id || item.group?.title) {
          const gid = item.group?.id != null ? String(item.group.id) : ''
          const gtitle = item.group?.title != null ? String(item.group.title) : ''
          if (gid) column_values._group_id = gid
          if (gtitle) column_values._group_title = gtitle
          column_values.__monday_group = { id: gid, title: gtitle }
        }
        projects.push({
          id: item.id,
          name: item.name,
          board_id: boardId,
          client_name,
          agency,
          completed_date,
          due_date,
          quote_value,
          monday_status,
          likelihood,
          board_name: boardName || undefined,
          column_values,
        })
      }
    }
  }

  return projects
}

type MondaySubitemsItem = {
  id: string
  name: string
  board: { id: string }
  subitems: Array<{
    id: string
    name: string
    column_values: Array<{ id: string; text?: string; value?: string; type: string }>
  }>
}

/** Resolve quoted_hours and timeline column IDs for a board, with Flexi inheritance and global fallback. */
function resolveSubitemColumnIds(
  mappings: ColumnMappingRow[],
  boardId: string | undefined,
  boardName: string | undefined
): { quotedHoursColumnId?: string; timelineColumnId?: string } {
  const relevant = mappings.filter((m) => m.column_type === 'quoted_hours' || m.column_type === 'timeline')
  let quotedHoursColumnId: string | undefined
  let timelineColumnId: string | undefined

  if (boardId) {
    const boardMappings = relevant.filter((m) => m.board_id === boardId)
    quotedHoursColumnId = boardMappings.find((m) => m.column_type === 'quoted_hours')?.monday_column_id
    timelineColumnId = boardMappings.find((m) => m.column_type === 'timeline')?.monday_column_id
  }

  if ((!quotedHoursColumnId || !timelineColumnId) && boardName?.toLowerCase().includes('flexi')) {
    for (const mapping of relevant) {
      if (mapping.board_id && mapping.board_id !== boardId) {
        if (!quotedHoursColumnId && mapping.column_type === 'quoted_hours') quotedHoursColumnId = mapping.monday_column_id
        if (!timelineColumnId && mapping.column_type === 'timeline') timelineColumnId = mapping.monday_column_id
        if (quotedHoursColumnId && timelineColumnId) break
      }
    }
  }

  if (!quotedHoursColumnId || !timelineColumnId) {
    const globalMappings = relevant.filter((m) => !m.board_id)
    if (!quotedHoursColumnId) quotedHoursColumnId = globalMappings.find((m) => m.column_type === 'quoted_hours')?.monday_column_id
    if (!timelineColumnId) timelineColumnId = globalMappings.find((m) => m.column_type === 'timeline')?.monday_column_id
  }

  return { quotedHoursColumnId, timelineColumnId }
}

/** Parse one Monday item's subitems into MondayTask rows. Pure; no I/O. */
function parseSubitemsForItem(
  item: MondaySubitemsItem,
  boardId: string | undefined,
  boardName: string | undefined,
  mappings: ColumnMappingRow[]
): MondayTask[] {
  const itemBoardId = item.board?.id || boardId
  const { quotedHoursColumnId, timelineColumnId } = resolveSubitemColumnIds(mappings, itemBoardId, boardName)
  const tasks: MondayTask[] = []

  for (const subitem of item.subitems || []) {
    let quoted_hours: number | undefined
    let timeline_start: string | undefined
    let timeline_end: string | undefined
    let assigned_user_ids: string[] | undefined

    if (subitem.column_values) {
      // Find quoted hours using mapped column
      if (quotedHoursColumnId) {
        const quotedHoursColumn = subitem.column_values.find((cv) => cv.id === quotedHoursColumnId)
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
      if (timelineColumnId) {
        const timelineColumn = subitem.column_values.find((cv) => cv.id === timelineColumnId)
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
      parent_item_id: item.id,
      assigned_user_ids: assigned_user_ids?.length ? [...new Set(assigned_user_ids)] : undefined,
      quoted_hours,
      timeline_start,
      timeline_end,
      column_values,
    })
  }

  return tasks
}

/**
 * Projects per subitem request, which is also the chunk size for writing projects and tasks back.
 * Matches `MONDAY_ITEMS_BY_ID_LIMIT` because the request is an `items(ids:)` lookup: measured against
 * our boards, 100 ids per request costs ~26ms per item against ~60ms at 25, and ~22k complexity
 * against a 10M/minute budget.
 */
const SUBITEM_FETCH_BATCH_SIZE = MONDAY_ITEMS_BY_ID_LIMIT

/**
 * Fetch subitems for many parent items in batches. Returns tasks keyed by parent item id;
 * only items Monday actually returned get an entry (empty array when that item has no
 * subitems). An id missing from the map means Monday omitted it from the response, which
 * callers must not treat as "no subitems".
 */
export async function getMondayTasksForItems(
  accessToken: string,
  items: Array<{ id: string; board_id: string; board_name?: string }>,
  mappings: ColumnMappingRow[]
): Promise<Map<string, MondayTask[]>> {
  const result = new Map<string, MondayTask[]>()
  if (items.length === 0) return result
  const byId = new Map(items.map((it) => [it.id, it]))

  const query = `
    query($itemIds: [ID!], $limit: Int!) {
      items(ids: $itemIds, limit: $limit) {
        id
        name
        board { id }
        subitems {
          id
          name
          column_values { id text value type }
        }
      }
    }
  `

  for (let i = 0; i < items.length; i += SUBITEM_FETCH_BATCH_SIZE) {
    const batch = items.slice(i, i + SUBITEM_FETCH_BATCH_SIZE)
    const data = await mondayRequest<{ items: MondaySubitemsItem[] }>(accessToken, query, {
      itemIds: batch.map((b) => b.id),
      limit: MONDAY_ITEMS_BY_ID_LIMIT,
    })
    for (const item of data.items || []) {
      const requested = byId.get(item.id)
      result.set(item.id, parseSubitemsForItem(item, requested?.board_id, requested?.board_name, mappings))
    }
  }

  return result
}

const SNAPSHOT_PAGE_SIZE = 1000

/** Read every row of a table in pages, so PostgREST's max-rows cap cannot silently truncate the snapshot. */
async function selectAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += SNAPSHOT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(from, from + SNAPSHOT_PAGE_SIZE - 1)
    if (error) throw new Error(`Failed to load ${table}: ${error.message}`)
    const page = (data || []) as T[]
    rows.push(...page)
    if (page.length < SNAPSHOT_PAGE_SIZE) break
  }
  return rows
}

type ProjectUpsertRow = Record<string, unknown> & { monday_item_id: string; name: string }
type TaskUpsertRow = Record<string, unknown> & { monday_item_id: string; name: string }

/**
 * Upsert project rows in one request, falling back to row by row if the batch is rejected, so a
 * single bad row cannot cost the whole chunk. Returns the written id for each `monday_item_id`;
 * an item missing from the map failed to write and its tasks must be skipped.
 *
 * Every row must carry the same keys: PostgREST rejects a batch whose objects differ ("all object
 * keys must match"), so write `null` rather than leaving a field off one row.
 */
async function upsertProjectRows(
  supabase: SupabaseClient,
  rows: ProjectUpsertRow[]
): Promise<Map<string, string>> {
  const idByItemId = new Map<string, string>()
  if (rows.length === 0) return idByItemId

  const collect = (written: Array<{ id: string; monday_item_id: string }> | null) => {
    for (const row of written || []) idByItemId.set(String(row.monday_item_id), String(row.id))
  }

  const { data, error } = await supabase
    .from('monday_projects')
    .upsert(rows, { onConflict: 'monday_item_id' })
    .select('id, monday_item_id')

  if (!error) {
    collect(data as Array<{ id: string; monday_item_id: string }> | null)
    return idByItemId
  }

  console.error(
    `Bulk upsert of ${rows.length} Monday projects failed (${error.message}); retrying row by row`
  )
  for (const row of rows) {
    const { data: single, error: rowError } = await supabase
      .from('monday_projects')
      .upsert(row, { onConflict: 'monday_item_id' })
      .select('id, monday_item_id')
      .single()
    if (rowError || !single) {
      console.error(
        `Error upserting Monday project "${row.name}":`,
        rowError?.message ?? 'no row returned'
      )
      continue
    }
    collect([single as { id: string; monday_item_id: string }])
  }
  return idByItemId
}

/**
 * Upsert task rows in one request, falling back to row by row if the batch is rejected.
 * Rows must carry a uniform key set, for the same reason as `upsertProjectRows`.
 */
async function upsertTaskRows(supabase: SupabaseClient, rows: TaskUpsertRow[]): Promise<void> {
  if (rows.length === 0) return

  const { error } = await supabase.from('monday_tasks').upsert(rows, { onConflict: 'monday_item_id' })
  if (!error) return

  console.error(
    `Bulk upsert of ${rows.length} Monday tasks failed (${error.message}); retrying row by row`
  )
  for (const row of rows) {
    const { error: rowError } = await supabase
      .from('monday_tasks')
      .upsert(row, { onConflict: 'monday_item_id' })
    if (rowError) {
      console.error(`Error upserting Monday task "${row.name}":`, rowError.message)
    }
  }
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
  // Use service role so sync can write monday_projects / monday_tasks and read admin-only config tables.
  // RLS only allows admins to mutate projects/tasks; designers' JWT would otherwise fail every upsert.
  const admin = await createAdminClient()
  if (!admin) {
    const err = new Error(
      'Monday sync is not configured: missing SUPABASE_SERVICE_ROLE_KEY on the server'
    )
    onProgress?.({ phase: 'error', message: err.message })
    throw err
  }
  const supabase = admin
  const report = (e: SyncProgressEvent) => onProgress?.(e)

  try {
    report({
      phase: 'fetching',
      message: syncAllBoards ? 'Fetching all boards from Monday.com...' : 'Fetching projects from Monday.com...',
      progress: 0,
    })

    // 1. Fetch projects from Monday.com (active + completed; syncAllBoards = full scan of all boards)
    const mondayProjects = await getMondayProjects(accessToken, true, syncAllBoards, admin)

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
    
    // Get all existing projects from Supabase (one query; reused by the archive pass and the sync loop)
    type ExistingProjectRow = {
      id: string
      monday_item_id: string
      status: string
      monday_board_id: string | null
      quoted_hours: number | null
      quote_value: number | null
      monday_status: string | null
      likelihood: number | null
      monday_data: Record<string, { text?: string; value?: unknown }> | null
    }
    const existingProjects = await selectAllRows<ExistingProjectRow>(
      supabase,
      'monday_projects',
      'id, monday_item_id, status, monday_board_id, quoted_hours, quote_value, monday_status, likelihood, monday_data'
    )
    const existingByItemId = new Map<string, ExistingProjectRow>(
      existingProjects.map((p) => [p.monday_item_id, p])
    )

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

    // All column mappings, loaded once. Used for status, likelihood, quote_value and subitem columns.
    const { data: allColumnMappings } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, board_id, column_type')
    const columnMappings: ColumnMappingRow[] = (allColumnMappings || []) as ColumnMappingRow[]

    // All existing tasks, loaded once and grouped by project.
    type ExistingTaskRow = { id: string; monday_item_id: string; project_id: string; quoted_hours: number | null }
    const allExistingTasks = await selectAllRows<ExistingTaskRow>(
      supabase,
      'monday_tasks',
      'id, monday_item_id, project_id, quoted_hours'
    )
    const existingTasksByProjectId = new Map<string, ExistingTaskRow[]>()
    for (const row of allExistingTasks) {
      const list = existingTasksByProjectId.get(row.project_id)
      if (list) list.push(row)
      else existingTasksByProjectId.set(row.project_id, [row])
    }

    // Task ids that time entries reference, loaded once. An orphaned task with time logged on it
    // must be kept (the FK is `on delete restrict`), so the sync loop tests this set rather than
    // querying `time_entries` once per project.
    const referencedTaskRows = await selectAllRows<{ task_id: string | null }>(
      supabase,
      'time_entries',
      'task_id'
    )
    const taskIdsWithTimeEntries = new Set<string>()
    for (const row of referencedTaskRows) {
      if (row.task_id) taskIdsWithTimeEntries.add(row.task_id)
    }

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

    /** A task row before its project's database id is known. */
    type PreparedTaskRow = {
      monday_item_id: string
      name: string
      is_subtask: true
      parent_task_id: null
      assigned_user_ids: string[] | null
      quoted_hours: number | null
      timeline_start: string | null
      timeline_end: string | null
      monday_data: Record<string, unknown> | undefined
      /** null when the task has no status column, so readers fall back to hours-based completion. */
      is_completed: boolean | null
      updated_at: string
    }

    /** What a chunk still needs after its tasks are resolved but before anything is written. */
    type PendingProject = {
      project: MondayProject
      /** Subitems Monday returned; undefined when this project's task sync is skipped. */
      mondayTasks: MondayTask[] | undefined
      existingTasks: ExistingTaskRow[]
      taskRows: PreparedTaskRow[]
    }

    // 3. Sync projects to Supabase, in chunks so subitems are fetched in one Monday request per
    // chunk and each chunk's projects and tasks are written in one request each.
    for (let chunkStart = 0; chunkStart < mondayProjects.length; chunkStart += SUBITEM_FETCH_BATCH_SIZE) {
      const chunk = mondayProjects.slice(chunkStart, chunkStart + SUBITEM_FETCH_BATCH_SIZE)
      const chunkEnd = chunkStart + chunk.length

      // Phase 1: decide what to write for each project in the chunk (no I/O).
      const prepared = chunk.map((project) => {
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
      
      // Check if project exists - use the pre-loaded record to preserve quoted_hours and quote_value for locked projects
      const existing = existingByItemId.get(project.id) ?? null

      // For locked/completed projects, preserve existing quoted_hours if Monday doesn't provide it
      // This ensures historical budget data is maintained for reflection
      const preserveQuotedHours = existing?.status === 'locked' && (!project.quoted_hours || project.quoted_hours === 0)
      const finalQuotedHours = preserveQuotedHours 
        ? (existing.quoted_hours || project.quoted_hours || null)
        : (project.quoted_hours || null)

      // Handle quote_value - try to extract if not provided, preserve for locked projects if still missing
      let finalQuoteValue = project.quote_value || null

      // Get quote_value column mapping for this board
      const quoteValueColumnId = findMappingColumnId(columnMappings, 'quote_value', project.board_id)
      
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

      const statusColumnId = findMappingColumnId(
        columnMappings,
        'status',
        project.board_id
      )
      const likelihoodColumnId = findMappingColumnId(
        columnMappings,
        'likelihood',
        project.board_id
      )

      let finalMondayStatus = project.monday_status || null
      if (!finalMondayStatus && project.column_values && statusColumnId) {
        finalMondayStatus = extractMondayStatusFromMondayData(
          project.column_values,
          statusColumnId
        )
      }
      if (!finalMondayStatus && existing?.monday_data && statusColumnId) {
        finalMondayStatus = extractMondayStatusFromMondayData(
          existing.monday_data as Record<string, { text?: string; value?: unknown }>,
          statusColumnId
        )
      }

      let finalLikelihood = project.likelihood ?? null
      if (finalLikelihood == null && project.column_values && likelihoodColumnId) {
        finalLikelihood = extractLikelihoodFromMondayData(
          project.column_values,
          likelihoodColumnId
        )
      }
      if (finalLikelihood == null && existing?.monday_data && likelihoodColumnId) {
        finalLikelihood = extractLikelihoodFromMondayData(
          existing.monday_data as Record<string, { text?: string; value?: unknown }>,
          likelihoodColumnId
        )
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
        monday_status: finalMondayStatus,
        likelihood: finalLikelihood,
        monday_data: project.column_values,
        status: finalStatus,
        updated_at: new Date().toISOString(),
      }

      // Locked (completed) projects rarely change. Skip the per-project subitem fetch and task
      // writes unless this is a full resync, or the project has only just become locked this run.
      const wasAlreadyLocked = existing?.status === 'locked'
      const skipTaskSync = wasAlreadyLocked && finalStatus === 'locked' && !syncAllBoards

      return { project, existing, projectData, skipTaskSync, isLocked: finalStatus === 'locked' }
    })

      const chunkLabel = `${chunkStart + 1}-${chunkEnd} of ${totalProjects}`
      const chunkProgress = (fraction: number) =>
        0.1 + 0.85 * ((chunkStart + chunk.length * fraction) / Math.max(1, totalProjects))

      report({
        phase: 'syncing',
        message: `Fetching tasks for projects ${chunkLabel}`,
        projectIndex: chunkEnd,
        totalProjects,
        projectName: chunk[chunk.length - 1]?.name ?? '',
        progress: chunkProgress(0),
      })

      // Phase 2: one Monday request per chunk for the subitems we actually need.
      const tasksByItemId = await getMondayTasksForItems(
        accessToken,
        prepared
          .filter((p) => !p.skipTaskSync)
          .map((p) => ({ id: p.project.id, board_id: p.project.board_id, board_name: p.project.board_name })),
        columnMappings
      )

      report({
        phase: 'syncing',
        message: `Saving projects ${chunkLabel}`,
        projectIndex: chunkEnd,
        totalProjects,
        projectName: chunk[chunk.length - 1]?.name ?? '',
        progress: chunkProgress(0.5),
      })

      // Phase 3: resolve each project's tasks and its quoted-hours total (no I/O), so the total is
      // written by the same upsert as the rest of the project row instead of a second update.
      const projectRowByItemId = new Map<string, ProjectUpsertRow>()
      const pending: PendingProject[] = []

      for (const { project, existing, projectData, skipTaskSync, isLocked } of prepared) {
        // If Monday omitted this item from the subitems response, don't treat it as "no
        // subitems" - skip task sync for this project rather than deleting its tasks as orphans.
        const mondayTasks = skipTaskSync ? undefined : tasksByItemId.get(project.id)
        const existingTasks = existing ? existingTasksByProjectId.get(existing.id) ?? [] : []

        let quotedHours = projectData.quoted_hours
        const taskRows: PreparedTaskRow[] = []

        if (mondayTasks) {
          // Total quoted hours across this project's tasks
          let totalTaskQuotedHours = 0
          const nowIso = new Date().toISOString()

          for (const task of mondayTasks) {
            // For locked projects, preserve existing quoted_hours if Monday doesn't provide it
            const existingTask = existingTasks.find((t) => t.monday_item_id === task.id)
            const preserveTaskQuotedHours = isLocked && existingTask && (!task.quoted_hours || task.quoted_hours === 0)
            const finalTaskQuotedHours = preserveTaskQuotedHours
              ? (existingTask.quoted_hours || task.quoted_hours || null)
              : (task.quoted_hours || null)

            if (finalTaskQuotedHours) {
              totalTaskQuotedHours += finalTaskQuotedHours
            }

            taskRows.push({
              monday_item_id: task.id,
              name: task.name,
              is_subtask: true,
              parent_task_id: null,
              assigned_user_ids: task.assigned_user_ids || null,
              quoted_hours: finalTaskQuotedHours,
              timeline_start: task.timeline_start || null,
              timeline_end: task.timeline_end || null,
              monday_data: task.column_values,
              // Derived here so the timesheet never has to select the raw payload to read it.
              is_completed: getTaskCompletionFromStatus(task.column_values),
              updated_at: nowIso,
            })
          }

          // The project's quoted_hours is the sum of its tasks'.
          // For locked projects: only update if the new total is greater than 0, or if the existing
          // value is 0/null. This preserves historical budget data while still allowing updates
          // when tasks are synced.
          const shouldUpdateQuotedHours = !isLocked ||
            totalTaskQuotedHours > 0 ||
            !existing?.quoted_hours ||
            existing.quoted_hours === 0

          if (shouldUpdateQuotedHours) {
            quotedHours = totalTaskQuotedHours > 0 ? totalTaskQuotedHours : (existing?.quoted_hours || null)
          }
        }

        // Keyed by item id: a duplicate item in one chunk would otherwise make Postgres reject the
        // whole batch ("cannot affect row a second time").
        projectRowByItemId.set(project.id, { ...projectData, quoted_hours: quotedHours })
        pending.push({ project, mondayTasks, existingTasks, taskRows })
      }

      // Phase 4: write the chunk - one upsert for its projects, one for their tasks, one delete for
      // the tasks that have gone from Monday.
      const projectIdByItemId = await upsertProjectRows(
        supabase,
        Array.from(projectRowByItemId.values())
      )

      const taskRowByItemId = new Map<string, TaskUpsertRow>()
      const orphanTaskIds: string[] = []

      for (const { project, mondayTasks, existingTasks, taskRows } of pending) {
        // No id means the project row failed to write; skip its tasks rather than orphan them.
        const projectId = projectIdByItemId.get(project.id)
        if (!projectId || mondayTasks === undefined) continue

        for (const row of taskRows) {
          taskRowByItemId.set(row.monday_item_id, { ...row, project_id: projectId })
        }

        // Tasks in the DB but no longer in Monday, minus any that have time logged against them.
        const syncedMondayTaskIds = new Set(mondayTasks.map((t) => t.id))
        for (const existingTask of existingTasks) {
          if (
            !syncedMondayTaskIds.has(existingTask.monday_item_id) &&
            !taskIdsWithTimeEntries.has(existingTask.id)
          ) {
            orphanTaskIds.push(existingTask.id)
          }
        }
      }

      await upsertTaskRows(supabase, Array.from(taskRowByItemId.values()))

      if (orphanTaskIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('monday_tasks')
          .delete()
          .in('id', orphanTaskIds)
        if (deleteError) {
          // A time entry logged during this sync can still restrict one of these deletes, which
          // would take the whole batch down with it; retry one at a time so the rest go through.
          console.error(
            `Bulk delete of ${orphanTaskIds.length} orphaned Monday tasks failed (${deleteError.message}); retrying one by one`
          )
          for (const id of orphanTaskIds) {
            const { error: rowError } = await supabase.from('monday_tasks').delete().eq('id', id)
            if (rowError) {
              console.error(`Error deleting orphaned Monday task ${id}:`, rowError.message)
            }
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


