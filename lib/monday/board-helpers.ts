import { cache } from 'react'
import { revalidateTag, unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, createClient } from '@/lib/supabase/server'

/**
 * Cache tag for the Monday board-name lookup. Bust with `revalidateTag` if a board is
 * renamed in Monday and the change needs to land before the TTL expires.
 */
export const MONDAY_BOARDS_CACHE_TAG = 'monday-boards'

/**
 * Cache tag for the board classification (which boards are Main, Flexi, completed, leads).
 * Every Settings action that changes those tables revalidates it — see
 * `revalidateMondayBoardConfig`.
 */
export const MONDAY_BOARD_CONFIG_CACHE_TAG = 'monday-board-config'

/**
 * Board classification is read on nearly every page in the app and used to cost five
 * queries — in two sequential rounds — per request. It changes only when someone edits
 * Settings, so it is cached across requests and busted on those mutations. The TTL is only
 * a backstop in case a mutation path forgets to revalidate.
 */
const MONDAY_BOARD_CONFIG_TTL_SECONDS = 600

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

async function loadFlexiDesignBoardIdsFromDb(
  supabase: SupabaseClient
): Promise<FlexiBoardDbResult> {
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

/** Board IDs that have column mappings configured. */
async function loadMappedBoardIds(supabase: SupabaseClient): Promise<string[]> {
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
}

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
async function resolveFlexiDesignBoardIds(
  supabase: SupabaseClient,
  mappedBoardIds: string[]
): Promise<Set<string>> {
  // Sorted so the cache key is stable regardless of row order.
  const sortedBoardIds = [...mappedBoardIds].sort()

  const [fromDb, legacyIds] = await Promise.all([
    loadFlexiDesignBoardIdsFromDb(supabase),
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
 * Everything needed to classify a Monday board, resolved in one go.
 *
 * `mainBoardIds` are the boards behind the Main timesheet and projects list: boards with
 * column mappings, minus Flexi boards, completed archives, the Flexi completed board and
 * the leads board. Aligns with Settings → Column Mappings.
 */
export type MondayBoardConfig = {
  mappedBoardIds: string[]
  flexiBoardIds: string[]
  completedBoardIds: string[]
  leadsBoardId: string | null
  flexiCompletedBoardId: string | null
  mainBoardIds: string[]
}

async function loadFlexiCompletedBoardId(supabase: SupabaseClient): Promise<string | null> {
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
}

async function resolveBoardConfig(supabase: SupabaseClient): Promise<MondayBoardConfig> {
  const mappedBoardIds = await loadMappedBoardIds(supabase)

  if (mappedBoardIds.length === 0) {
    // Still resolve the singletons: callers ask for the Flexi completed board on its own.
    const flexiCompletedBoardId = await loadFlexiCompletedBoardId(supabase)
    return {
      mappedBoardIds: [],
      flexiBoardIds: [],
      completedBoardIds: [],
      leadsBoardId: null,
      flexiCompletedBoardId,
      mainBoardIds: [],
    }
  }

  // Everything below depends only on the mapped board list, so resolve it concurrently.
  const [flexiIds, completedBoardsResult, leadsResult, flexiCompletedBoardId] = await Promise.all([
    resolveFlexiDesignBoardIds(supabase, mappedBoardIds),
    supabase.from('monday_completed_boards').select('monday_board_id'),
    supabase.from('monday_leads_board').select('monday_board_id').maybeSingle(),
    loadFlexiCompletedBoardId(supabase),
  ])

  const completedIds = new Set(
    (completedBoardsResult.data ?? []).map((b: { monday_board_id: string }) => b.monday_board_id)
  )
  const leadsBoardId = leadsResult.data?.monday_board_id ?? null

  const mainBoardIds: string[] = []
  for (const bid of mappedBoardIds) {
    if (flexiIds.has(bid)) continue
    if (completedIds.has(bid)) continue
    if (leadsBoardId && bid === leadsBoardId) continue
    if (flexiCompletedBoardId && bid === flexiCompletedBoardId) continue
    mainBoardIds.push(bid)
  }

  return {
    mappedBoardIds,
    flexiBoardIds: Array.from(flexiIds),
    completedBoardIds: Array.from(completedIds),
    leadsBoardId,
    flexiCompletedBoardId,
    mainBoardIds,
  }
}

/**
 * Cross-request cache. Uses the service-role client because `unstable_cache` callbacks may
 * not read cookies, and because the result is identical for every signed-in user — these
 * are deployment-wide settings, not per-user data. Only board IDs are cached.
 */
const loadBoardConfigCached = unstable_cache(
  async (): Promise<MondayBoardConfig> => {
    const admin = await createAdminClient()
    if (!admin) {
      // Guarded by the caller, so this only fires if the key disappears mid-flight.
      throw new Error('Admin client unavailable')
    }
    return resolveBoardConfig(admin)
  },
  ['monday-board-config'],
  {
    revalidate: MONDAY_BOARD_CONFIG_TTL_SECONDS,
    tags: [MONDAY_BOARD_CONFIG_CACHE_TAG, MONDAY_BOARDS_CACHE_TAG],
  }
)

/**
 * Drop the cached board classification. Call from every Settings action that changes
 * `monday_column_mappings`, `flexi_design_boards`, `monday_completed_boards`,
 * `monday_leads_board` or `flexi_design_completed_board`, otherwise the change won't show
 * up on the timesheet or projects list until the TTL expires.
 */
export function revalidateMondayBoardConfig() {
  // `{ expire: 0 }` rather than a named profile: a named profile is stale-while-revalidate,
  // which would stop the admin who just changed the setting from seeing their own write.
  revalidateTag(MONDAY_BOARD_CONFIG_CACHE_TAG, { expire: 0 })
}

/** Board classification, cached across requests and deduped within one. */
export const getMondayBoardConfig = cache(async (): Promise<MondayBoardConfig> => {
  const admin = await createAdminClient()

  if (admin) {
    try {
      return await loadBoardConfigCached()
    } catch (error) {
      console.error('Monday board config (cached):', error)
    }
  }

  // No service-role key, or the cached read failed: resolve per request as the user.
  return resolveBoardConfig(await createClient())
})

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
  const { flexiBoardIds } = await getMondayBoardConfig()
  return new Set(flexiBoardIds)
}

/** Monday board ID of the configured Flexi-Design completed board, or null. */
export async function getFlexiDesignCompletedBoardId(): Promise<string | null> {
  const { flexiCompletedBoardId } = await getMondayBoardConfig()
  return flexiCompletedBoardId
}

/**
 * Monday board IDs used for the Main projects surface (timesheet, projects list):
 * boards that have column mappings, excluding Flexi boards, completed archives, Flexi completed, and leads.
 * Aligns with Settings → Column Mappings classification for Main vs other board types.
 */
export async function getMainTimesheetBoardIds(): Promise<Set<string>> {
  const { mainBoardIds } = await getMondayBoardConfig()
  return new Set(mainBoardIds)
}

/**
 * Monday board IDs for the Completed Projects page (ad-hoc work only):
 * `mainBoardIds ∪ completedBoardIds`, minus Flexi-Design boards and the Flexi completed archive.
 */
export async function getCompletedProjectsBoardIds(): Promise<Set<string>> {
  const { mainBoardIds, completedBoardIds, flexiBoardIds, flexiCompletedBoardId } =
    await getMondayBoardConfig()
  const flexiIds = new Set(flexiBoardIds)
  if (flexiCompletedBoardId) flexiIds.add(flexiCompletedBoardId)
  return new Set([...mainBoardIds, ...completedBoardIds].filter((id) => !flexiIds.has(id)))
}

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
