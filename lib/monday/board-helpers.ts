'use server'

import { createClient } from '@/lib/supabase/server'

type FlexiBoardDbResult =
  | { ok: true; ids: string[] }
  | { ok: false; reason: 'missing_table' | 'error' }

async function loadFlexiDesignBoardIdsFromDb(): Promise<FlexiBoardDbResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.from('flexi_design_boards').select('monday_board_id')

  if (error) {
    const code = error.code ?? ''
    const msg = error.message ?? ''
    if (
      code === '42P01' ||
      code === 'PGRST116' ||
      msg.includes('does not exist') ||
      msg.includes('relation') ||
      msg.includes('schema cache')
    ) {
      return { ok: false, reason: 'missing_table' }
    }
    console.error('flexi_design_boards:', error)
    return { ok: false, reason: 'error' }
  }

  const ids = (data ?? []).map((r: { monday_board_id: string }) => r.monday_board_id).filter(Boolean)
  return { ok: true, ids }
}

/**
 * Legacy: infer Flexi boards by fetching Monday board names (contains "flexi").
 * Merged with `flexi_design_boards` for Main vs Flexi filtering.
 */
async function loadFlexiDesignBoardIdsLegacy(): Promise<Set<string>> {
  const supabase = await createClient()

  try {
    const { data: mappings } = await supabase
      .from('monday_column_mappings')
      .select('board_id')
      .not('board_id', 'is', null)

    if (!mappings || mappings.length === 0) {
      return new Set()
    }

    const mondayApiToken = process.env.MONDAY_API_TOKEN
    if (!mondayApiToken) {
      return new Set()
    }

    const boardIds = Array.from(new Set(mappings.map((m: { board_id: string | null }) => m.board_id).filter(Boolean)))

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

    const flexiDesignBoardIds = new Set<string>()
    result.data?.boards?.forEach((board: { id: string; name: string }) => {
      if (board.name.toLowerCase().includes('flexi')) {
        flexiDesignBoardIds.add(board.id)
      }
    })

    return flexiDesignBoardIds
  } catch (error) {
    console.error('Error identifying Flexi-Design boards (legacy):', error)
    return new Set()
  }
}

/**
 * Monday board IDs classified as Flexi-Design for Main vs Flexi filtering.
 *
 * Returns the **union** of:
 * - All `monday_board_id` values from `flexi_design_boards` (when the table exists and the query succeeds)
 * - Legacy detection: boards referenced in `monday_column_mappings` whose Monday name contains "flexi"
 *
 * Merging avoids Flexi projects leaking into the Main timesheet when the DB list is partial, and keeps
 * behavior stable when the table is empty (legacy-only) or Monday token is unavailable (DB-only).
 */
export async function getFlexiDesignBoardIds(): Promise<Set<string>> {
  const fromDb = await loadFlexiDesignBoardIdsFromDb()
  const legacy = await loadFlexiDesignBoardIdsLegacy()

  const merged = new Set<string>()
  if (fromDb.ok) {
    for (const id of fromDb.ids) {
      merged.add(id)
    }
  }
  for (const id of legacy) {
    merged.add(id)
  }

  return merged
}

/**
 * Monday board IDs used for the Main projects surface (timesheet, projects list):
 * boards that have column mappings, excluding Flexi boards, completed archives, Flexi completed, and leads.
 * Aligns with Settings → Column Mappings classification for Main vs other board types.
 */
export async function getMainTimesheetBoardIds(): Promise<Set<string>> {
  const supabase = await createClient()

  const { data: mappings, error: mapErr } = await supabase
    .from('monday_column_mappings')
    .select('board_id')
    .not('board_id', 'is', null)

  if (mapErr) {
    console.error('getMainTimesheetBoardIds mappings:', mapErr)
    return new Set()
  }

  const mappedBoardIds = Array.from(
    new Set((mappings ?? []).map((m: { board_id: string | null }) => m.board_id).filter(Boolean))
  ) as string[]

  if (mappedBoardIds.length === 0) {
    return new Set()
  }

  const flexiIds = await getFlexiDesignBoardIds()

  const { data: completedBoards } = await supabase.from('monday_completed_boards').select('monday_board_id')
  const completedIds = new Set(
    (completedBoards ?? []).map((b: { monday_board_id: string }) => b.monday_board_id)
  )

  const { data: leadsRow } = await supabase.from('monday_leads_board').select('monday_board_id').maybeSingle()
  const leadsId = leadsRow?.monday_board_id ?? null

  const { getFlexiDesignCompletedBoard } = await import('@/app/actions/flexi-design-completed-board')
  const flexiCompletedResult = await getFlexiDesignCompletedBoard()
  const flexiCompletedId =
    flexiCompletedResult.success && flexiCompletedResult.board?.monday_board_id
      ? flexiCompletedResult.board.monday_board_id
      : null

  const main = new Set<string>()
  for (const bid of mappedBoardIds) {
    if (flexiIds.has(bid)) continue
    if (completedIds.has(bid)) continue
    if (leadsId && bid === leadsId) continue
    if (flexiCompletedId && bid === flexiCompletedId) continue
    main.add(bid)
  }

  return main
}

/**
 * Get the leads board ID
 * Returns the board ID if configured, null otherwise
 */
export async function getLeadsBoardId(): Promise<string | null> {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase.from('monday_leads_board').select('monday_board_id').maybeSingle()

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
