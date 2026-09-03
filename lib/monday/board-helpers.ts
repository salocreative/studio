import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Cache tag for the Monday board-name lookup. Bust with `revalidateTag` if a board is
 * renamed in Monday and the change needs to land before the TTL expires.
 */
export const MONDAY_BOARDS_CACHE_TAG = 'monday-boards'

/** Board names change rarely; this lookup used to run on every timesheet page load. */
const MONDAY_BOARD_NAMES_TTL_SECONDS = 3600

/** Never let a slow Monday response hold up a page render. */
const MONDAY_BOARD_NAMES_TIMEOUT_MS = 8000

/** Postgres/PostgREST codes and messages that mean "this table hasn't been migrated yet". */
function isMissingTableError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return (
    code === '42P01' ||
    code === 'PGRST116' ||
    msg.includes('does not exist') ||
    msg.includes('relation') ||
    msg.includes('schema cache')
  )
}

type FlexiBoardDbResult =
  | { ok: true; ids: string[] }
  | { ok: false; reason: 'missing_table' | 'error' }

async function loadFlexiDesignBoardIdsFromDb(): Promise<FlexiBoardDbResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.from('flexi_design_boards').select('monday_board_id')

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, reason: 'missing_table' }
    }
    console.error('flexi_design_boards:', error)
    return { ok: false, reason: 'error' }
  }

  const ids = (data ?? []).map((r: { monday_board_id: string }) => r.monday_board_id).filter(Boolean)
  return { ok: true, ids }
}

/**
 * Board IDs that have column mappings configured. Deduped per request — both
 * `getFlexiDesignBoardIds` and `getMainTimesheetBoardIds` need it.
 */
const loadMappedBoardIds = cache(async (): Promise<string[]> => {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('monday_column_mappings')
    .select('board_id')
    .not('board_id', 'is', null)

  if (error) {
    console.error('monday_column_mappings:', error)
    return []
  }

  return Array.from(
    new Set((data ?? []).map((m: { board_id: string | null }) => m.board_id).filter(Boolean))
  ) as string[]
})

/**
 * Legacy: infer Flexi boards by asking Monday for board names and matching "flexi".
 *
 * This is an external network call, so it is cached across requests. The cache key includes
 * the board IDs, so configuring a mapping for a new board takes effect immediately; only a
 * board *rename* inside Monday waits for the TTL.
 */
const fetchFlexiBoardIdsFromMonday = unstable_cache(
  async (boardIds: string[]): Promise<string[]> => {
    const mondayApiToken = process.env.MONDAY_API_TOKEN
    if (!mondayApiToken || boardIds.length === 0) {
      return []
    }

    const query = `
      query($boardIds: [ID!]) {
        boards(ids: $boardIds) {
          id
          name
        }
      }
    `

    try {
      const response = await fetch('https://api.monday.com/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: mondayApiToken,
        },
        body: JSON.stringify({ query, variables: { boardIds } }),
        signal: AbortSignal.timeout(MONDAY_BOARD_NAMES_TIMEOUT_MS),
      })

      if (!response.ok) {
        return []
      }

      const result = await response.json()
      if (result.errors) {
        return []
      }

      return (result.data?.boards ?? [])
        .filter((board: { name: string }) => board.name.toLowerCase().includes('flexi'))
        .map((board: { id: string }) => board.id)
    } catch (error) {
      console.error('Error identifying Flexi-Design boards (legacy):', error)
      return []
    }
  },
  ['monday-flexi-board-ids'],
  { revalidate: MONDAY_BOARD_NAMES_TTL_SECONDS, tags: [MONDAY_BOARDS_CACHE_TAG] }
)

/** Shared by both public helpers so the mapped-board query isn't run twice. */
async function resolveFlexiDesignBoardIds(mappedBoardIds: string[]): Promise<Set<string>> {
  // Sorted so the cache key is stable regardless of row order.
  const sortedBoardIds = [...mappedBoardIds].sort()

  const [fromDb, legacyIds] = await Promise.all([
    loadFlexiDesignBoardIdsFromDb(),
    fetchFlexiBoardIdsFromMonday(sortedBoardIds),
  ])

  const merged = new Set<string>()
  if (fromDb.ok) {
    for (const id of fromDb.ids) {
      merged.add(id)
    }
  }
  for (const id of legacyIds) {
    merged.add(id)
  }

  return merged
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
export const getFlexiDesignBoardIds = cache(async (): Promise<Set<string>> => {
  const mappedBoardIds = await loadMappedBoardIds()
  return resolveFlexiDesignBoardIds(mappedBoardIds)
})

/**
 * Monday board ID of the configured Flexi-Design completed board, or null.
 *
 * Reads the table directly rather than going through `getFlexiDesignCompletedBoard`, which
 * re-authenticates on every call. Tolerates the table not existing yet (migration 014).
 */
export const getFlexiDesignCompletedBoardId = cache(async (): Promise<string | null> => {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('flexi_design_completed_board')
    .select('monday_board_id')
    .maybeSingle()

  if (error) {
    if (!isMissingTableError(error)) {
      console.error('flexi_design_completed_board:', error)
    }
    return null
  }

  return data?.monday_board_id ?? null
})

/**
 * Monday board IDs used for the Main projects surface (timesheet, projects list):
 * boards that have column mappings, excluding Flexi boards, completed archives, Flexi completed, and leads.
 * Aligns with Settings → Column Mappings classification for Main vs other board types.
 */
export const getMainTimesheetBoardIds = cache(async (): Promise<Set<string>> => {
  const supabase = await createClient()

  const mappedBoardIds = await loadMappedBoardIds()

  if (mappedBoardIds.length === 0) {
    return new Set()
  }

  // Everything below depends only on the mapped board list, so resolve it concurrently.
  const [flexiIds, completedBoardsResult, leadsResult, flexiCompletedId] = await Promise.all([
    resolveFlexiDesignBoardIds(mappedBoardIds),
    supabase.from('monday_completed_boards').select('monday_board_id'),
    supabase.from('monday_leads_board').select('monday_board_id').maybeSingle(),
    getFlexiDesignCompletedBoardId(),
  ])

  const completedIds = new Set(
    (completedBoardsResult.data ?? []).map((b: { monday_board_id: string }) => b.monday_board_id)
  )
  const leadsId = leadsResult.data?.monday_board_id ?? null

  const main = new Set<string>()
  for (const bid of mappedBoardIds) {
    if (flexiIds.has(bid)) continue
    if (completedIds.has(bid)) continue
    if (leadsId && bid === leadsId) continue
    if (flexiCompletedId && bid === flexiCompletedId) continue
    main.add(bid)
  }

  return main
})

/**
 * Get the leads board ID
 * Returns the board ID if configured, null otherwise
 */
export const getLeadsBoardId = cache(async (): Promise<string | null> => {
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
})
