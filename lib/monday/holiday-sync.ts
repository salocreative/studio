import type { SupabaseClient } from '@supabase/supabase-js'
import { isCapacityReducingStatus } from '@/lib/holidays/working-days'
import { mondayRequest, type SyncProgressEvent } from '@/lib/monday/api'

type MondayColumn = { id: string; title: string; type: string }

type MondayItem = {
  id: string
  name: string
  column_values: Array<{ id: string; text?: string; value?: string; type: string }>
}

type MondayUser = {
  id: string
  name?: string | null
  email?: string | null
  enabled?: boolean | null
  is_guest?: boolean | null
}

type StudioUser = {
  id: string
  email: string
  full_name: string | null
  monday_user_id: string | null
}

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

function resolveHolidayColumnIds(columns: MondayColumn[]) {
  const people = columns.find((column) => column.type === 'people')
  const timeline = columns.find((column) => column.type === 'timeline')
  const days = columns.find((column) => column.type === 'numbers')
  const statusColumns = columns.filter((column) => column.type === 'status')
  const leaveType =
    statusColumns.find((column) => /leave type/i.test(column.title)) || statusColumns[0]
  const approval =
    statusColumns.find((column) => /^status$/i.test(column.title) && column.id !== leaveType?.id) ||
    statusColumns.find((column) => column.id !== leaveType?.id)

  return {
    peopleId: people?.id ?? 'people9',
    timelineId: timeline?.id ?? 'timeline',
    daysId: days?.id ?? 'numbers6',
    leaveTypeId: leaveType?.id ?? 'status',
    statusId: approval?.id ?? 'status4',
  }
}

function parsePerson(value?: string, text?: string): { id: string; name: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as {
      personsAndTeams?: Array<{ id?: number | string; kind?: string }>
    }
    const person = parsed.personsAndTeams?.find((entry) => entry.id != null)
    if (person?.id == null) return null
    return { id: String(person.id), name: text?.trim() || '' }
  } catch {
    return null
  }
}

function parseTimeline(value?: string, text?: string): { from: string; to: string } | null {
  if (value) {
    try {
      const parsed = JSON.parse(value) as { from?: string; to?: string; start?: string; end?: string }
      const from = parsed.from || parsed.start
      const to = parsed.to || parsed.end
      if (from && to) {
        return { from: String(from).slice(0, 10), to: String(to).slice(0, 10) }
      }
    } catch {
      // fall through to text
    }
  }

  const range = text?.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/)
  if (range) return { from: range[1], to: range[2] }
  const single = text?.match(/(\d{4}-\d{2}-\d{2})/)
  if (single) return { from: single[1], to: single[1] }
  return null
}

function parseDays(value?: string, text?: string): number | null {
  const fromText = text?.trim() ? parseFloat(text.replace(/,/g, '')) : NaN
  if (!isNaN(fromText)) return fromText
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    const n = typeof parsed === 'number' ? parsed : parseFloat(String(parsed))
    return isNaN(n) ? null : n
  } catch {
    const n = parseFloat(value)
    return isNaN(n) ? null : n
  }
}

function normalise(value: string): string {
  return value.trim().toLowerCase()
}

function matchStudioUser(
  mondayUserId: string,
  displayName: string,
  mondayUsersById: Map<string, MondayUser>,
  studioUsers: StudioUser[]
): StudioUser | null {
  const linked = studioUsers.find((user) => user.monday_user_id === mondayUserId)
  if (linked) return linked

  const mondayUser = mondayUsersById.get(mondayUserId)
  const email = mondayUser?.email?.trim().toLowerCase()
  if (email) {
    const byEmail = studioUsers.find((user) => user.email.toLowerCase() === email)
    if (byEmail) return byEmail
  }

  const display = displayName.trim()
  if (display.includes('@')) {
    const byDisplayEmail = studioUsers.find((user) => user.email.toLowerCase() === display.toLowerCase())
    if (byDisplayEmail) return byDisplayEmail
  }

  const name = normalise(mondayUser?.name || display)
  if (name) {
    const matches = studioUsers.filter((user) => normalise(user.full_name || '') === name)
    if (matches.length === 1) return matches[0]
  }

  return null
}

async function fetchMondayUsers(accessToken: string): Promise<MondayUser[]> {
  const data = await mondayRequest<{ users: MondayUser[] }>(
    accessToken,
    `query {
      users {
        id
        name
        email
        enabled
        is_guest
      }
    }`
  )
  return (data.users || []).filter((user) => user.enabled !== false && user.is_guest !== true)
}

async function fetchHolidayBoardItems(
  accessToken: string,
  boardId: string
): Promise<{ name: string; columns: MondayColumn[]; items: MondayItem[] }> {
  const boardsQuery = `
    query($boardIds: [ID!]) {
      boards(ids: $boardIds) {
        id
        name
        columns { id title type }
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values { id text value type }
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
        }
      }
    }
  `

  const data = await mondayRequest<{
    boards: Array<{
      id: string
      name: string
      columns: MondayColumn[]
      items_page: { cursor?: string; items: MondayItem[] }
    }>
  }>(accessToken, boardsQuery, { boardIds: [boardId] })

  const board = data.boards?.[0]
  if (!board) {
    return { name: '', columns: [], items: [] }
  }

  const items = [...(board.items_page.items || [])]
  let cursor = board.items_page.cursor
  while (cursor) {
    const next = await mondayRequest<{
      next_items_page: { cursor?: string; items: MondayItem[] }
    }>(accessToken, nextPageQuery, { cursor })
    items.push(...(next.next_items_page.items || []))
    cursor = next.next_items_page.cursor
  }

  return { name: board.name, columns: board.columns || [], items }
}

/**
 * Sync the configured Annual Leave board into `holiday_requests`.
 * Skips quietly when the board is not configured or the tables are not migrated yet.
 */
export async function syncHolidayRequests(
  accessToken: string,
  supabase: SupabaseClient,
  onProgress?: (event: SyncProgressEvent) => void
): Promise<{ holidaysSynced: number }> {
  const { data: boardRow, error: boardError } = await supabase
    .from('monday_holidays_board')
    .select('monday_board_id, board_name')
    .maybeSingle()

  if (boardError) {
    if (!isMissingTableError(boardError)) {
      console.error('monday_holidays_board:', boardError)
    }
    return { holidaysSynced: 0 }
  }

  const boardId = boardRow?.monday_board_id
  if (!boardId) return { holidaysSynced: 0 }

  onProgress?.({
    phase: 'fetching',
    message: 'Fetching holiday requests from Monday.com...',
    progress: 0.92,
  })

  const [board, mondayUsers, studioUsersResult] = await Promise.all([
    fetchHolidayBoardItems(accessToken, boardId),
    fetchMondayUsers(accessToken),
    supabase.from('users').select('id, email, full_name, monday_user_id'),
  ])

  if (studioUsersResult.error) {
    console.error('holiday sync users:', studioUsersResult.error)
    throw new Error('Failed to load Studio users for holiday sync')
  }

  const studioUsers = (studioUsersResult.data || []) as StudioUser[]
  const mondayUsersById = new Map(mondayUsers.map((user) => [String(user.id), user]))
  const columnIds = resolveHolidayColumnIds(board.columns)
  const autoLinked = new Map<string, string>()

  const rows = []
  const seenItemIds: string[] = []

  for (const item of board.items) {
    seenItemIds.push(item.id)
    const byId = new Map(item.column_values.map((column) => [column.id, column]))
    const peopleCol = byId.get(columnIds.peopleId)
    const timelineCol = byId.get(columnIds.timelineId)
    const daysCol = byId.get(columnIds.daysId)
    const leaveTypeCol = byId.get(columnIds.leaveTypeId)
    const statusCol = byId.get(columnIds.statusId)

    const person = parsePerson(peopleCol?.value, peopleCol?.text)
    const timeline = parseTimeline(timelineCol?.value, timelineCol?.text)
    const status = statusCol?.text?.trim() || null
    const leaveType = leaveTypeCol?.text?.trim() || null
    const days = parseDays(daysCol?.value, daysCol?.text)

    let userId: string | null = null
    if (person) {
      const matched = matchStudioUser(person.id, person.name, mondayUsersById, studioUsers)
      if (matched) {
        userId = matched.id
        if (!matched.monday_user_id) {
          autoLinked.set(matched.id, person.id)
          matched.monday_user_id = person.id
        }
      }
    }

    const mondayData: Record<string, { text?: string; value?: string; type?: string }> = {}
    for (const column of item.column_values) {
      mondayData[column.id] = { text: column.text, value: column.value, type: column.type }
    }

    rows.push({
      monday_item_id: item.id,
      monday_board_id: boardId,
      name: item.name,
      user_id: userId,
      monday_user_id: person?.id ?? null,
      leave_type: leaveType,
      status,
      start_date: timeline?.from ?? null,
      end_date: timeline?.to ?? null,
      days,
      reduces_capacity: isCapacityReducingStatus(status),
      monday_data: mondayData,
    })
  }

  for (const [userId, mondayUserId] of autoLinked) {
    const { error } = await supabase
      .from('users')
      .update({ monday_user_id: mondayUserId })
      .eq('id', userId)
      .is('monday_user_id', null)
    if (error) {
      console.error(`Failed to link Monday user ${mondayUserId} to ${userId}:`, error.message)
    }
  }

  const unmatched = rows.filter((row) => row.monday_user_id && !row.user_id)
  if (unmatched.length > 0) {
    const names = Array.from(new Set(unmatched.map((row) => row.name))).slice(0, 8)
    console.warn(
      `Holiday sync: ${unmatched.length} item(s) have no Studio user. Link Monday accounts in Settings. Examples: ${names.join(', ')}`
    )
  }

  const chunkSize = 100
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from('holiday_requests').upsert(chunk, { onConflict: 'monday_item_id' })
    if (error) {
      if (isMissingTableError(error)) return { holidaysSynced: 0 }
      throw new Error(`Holiday sync failed: ${error.message}`)
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from('holiday_requests')
    .select('id, monday_item_id')
    .eq('monday_board_id', boardId)

  if (existingError) {
    if (!isMissingTableError(existingError)) {
      console.error('holiday_requests existing:', existingError)
    }
  } else {
    const seen = new Set(seenItemIds)
    const orphanIds = (existing || [])
      .filter((row) => !seen.has(row.monday_item_id))
      .map((row) => row.id)
    if (orphanIds.length > 0) {
      const { error: deleteError } = await supabase.from('holiday_requests').delete().in('id', orphanIds)
      if (deleteError) {
        console.error('Failed to prune removed holiday requests:', deleteError.message)
      }
    }
  }

  if (board.name && board.name !== boardRow?.board_name) {
    await supabase.from('monday_holidays_board').update({ board_name: board.name }).eq('monday_board_id', boardId)
  }

  return { holidaysSynced: rows.length }
}
