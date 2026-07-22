'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getLeadsBoard } from './leads-board'
import type { SowDocument, SowLineItem } from './sow'

const MONDAY_API_URL = 'https://api.monday.com/v2'

const SOW_APPROVED_STATUS_LABEL = 'Client approved'
const SOW_DECLINED_STATUS_LABEL = 'Client declined'

async function mondayRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const mondayApiToken = process.env.MONDAY_API_TOKEN
  if (!mondayApiToken) {
    throw new Error('Monday.com API token not configured')
  }

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: mondayApiToken,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.statusText}`)
  }

  const data = await response.json()
  if (data.errors?.length) {
    throw new Error(data.errors.map((e: { message: string }) => e.message).join(', '))
  }

  return data.data as T
}

async function requireTeamMemberForMonday() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (
    !userProfile ||
    (userProfile.role !== 'admin' &&
      userProfile.role !== 'designer' &&
      userProfile.role !== 'manager')
  ) {
    return { error: 'Unauthorized' as const }
  }

  return { supabase, error: null as null }
}

async function getLeadsColumnMapping(
  supabase: Awaited<ReturnType<typeof createClient>>,
  columnType: string,
  leadsBoardId: string
): Promise<string | undefined> {
  const { data: allMappings } = await supabase
    .from('monday_column_mappings')
    .select('monday_column_id, column_type, board_id')
    .eq('column_type', columnType)

  if (!allMappings?.length) return undefined

  const boardSpecific = allMappings.find((m) => m.board_id === leadsBoardId)
  if (boardSpecific) return boardSpecific.monday_column_id

  const global = allMappings.find((m) => !m.board_id)
  if (global) return global.monday_column_id

  return allMappings[0].monday_column_id
}

async function loadSowForMonday(sowId: string) {
  const adminClient = await createAdminClient()
  if (!adminClient) return { error: 'Service unavailable' as const }

  const { data: document, error: docError } = await adminClient
    .from('sow_documents')
    .select('*')
    .eq('id', sowId)
    .single()

  if (docError || !document) return { error: 'Statement of work not found' as const }

  const { data: lineItems, error: itemsError } = await adminClient
    .from('sow_line_items')
    .select('*')
    .eq('sow_id', sowId)
    .order('sort_order', { ascending: true })

  if (itemsError) throw itemsError

  return {
    document: document as SowDocument,
    lineItems: (lineItems || []) as SowLineItem[],
    adminClient,
  }
}

function formatDropdownLabelError(error: unknown, fieldLabel: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (
    lower.includes('permission') ||
    lower.includes('not allowed') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('board structure') ||
    lower.includes('insufficient')
  ) {
    return new Error(
      `Could not add ${fieldLabel} to Monday: the API token needs permission to change board structure (add dropdown labels) on the Leads board.`
    )
  }

  if (lower.includes('does not exist') && lower.includes('label')) {
    return new Error(
      `Could not set ${fieldLabel} on Monday (${message}). Ensure the Monday API token can create dropdown labels on the Leads board.`
    )
  }

  return error instanceof Error ? error : new Error(message)
}

async function setDropdownLabelWithAutoCreate(params: {
  itemId: string
  boardId: string
  columnId: string
  label: string
  fieldLabel: string
}) {
  try {
    await mondayRequest(
      `
        mutation($itemId: ID!, $boardId: ID!, $columnId: String!, $value: String!) {
          change_simple_column_value(
            item_id: $itemId
            board_id: $boardId
            column_id: $columnId
            value: $value
            create_labels_if_missing: true
          ) {
            id
          }
        }
      `,
      {
        itemId: params.itemId,
        boardId: params.boardId,
        columnId: params.columnId,
        value: params.label,
      }
    )
  } catch (error) {
    throw formatDropdownLabelError(error, params.fieldLabel)
  }
}

function buildSubitemColumnValues(
  item: SowLineItem,
  quotedHoursColumnId: string,
  timelineColumnId?: string
): Record<string, unknown> {
  const columnValuesObj: Record<string, unknown> = {
    [quotedHoursColumnId]: Number(item.hours).toString(),
  }

  if (timelineColumnId && item.timeline_start && item.timeline_end) {
    columnValuesObj[timelineColumnId] = {
      from: item.timeline_start,
      to: item.timeline_end,
    }
  } else if (timelineColumnId && (item.timeline_start || item.timeline_end)) {
    const day = item.timeline_start || item.timeline_end
    columnValuesObj[timelineColumnId] = { from: day, to: day }
  }

  return columnValuesObj
}

async function createSowSubitems(params: {
  parentItemId: string
  lineItems: SowLineItem[]
  quotedHoursColumnId: string
  timelineColumnId?: string
}) {
  for (const item of params.lineItems) {
    const columnValuesObj = buildSubitemColumnValues(
      item,
      params.quotedHoursColumnId,
      params.timelineColumnId
    )

    try {
      await mondayRequest(
        `
          mutation($parentItemId: ID!, $itemName: String!, $columnValues: JSON!) {
            create_subitem(
              parent_item_id: $parentItemId,
              item_name: $itemName,
              column_values: $columnValues
            ) {
              id
            }
          }
        `,
        {
          parentItemId: params.parentItemId,
          itemName: item.title,
          columnValues: JSON.stringify(columnValuesObj),
        }
      )
    } catch (subitemError) {
      console.error(`Failed to create subitem "${item.title}":`, subitemError)
    }
  }
}

async function syncParentDropdowns(params: {
  itemId: string
  boardId: string
  document: SowDocument
  clientColumnId?: string
  agencyColumnId?: string
}) {
  if (params.clientColumnId && params.document.client_name) {
    await setDropdownLabelWithAutoCreate({
      itemId: params.itemId,
      boardId: params.boardId,
      columnId: params.clientColumnId,
      label: params.document.client_name,
      fieldLabel: `client "${params.document.client_name}"`,
    })
  }

  if (params.agencyColumnId && params.document.agency_name) {
    await setDropdownLabelWithAutoCreate({
      itemId: params.itemId,
      boardId: params.boardId,
      columnId: params.agencyColumnId,
      label: params.document.agency_name,
      fieldLabel: `agency "${params.document.agency_name}"`,
    })
  }
}

async function replaceMondaySubitems(params: {
  parentItemId: string
  lineItems: SowLineItem[]
  quotedHoursColumnId: string
  timelineColumnId?: string
}) {
  const existing = await mondayRequest<{
    items: Array<{ subitems?: Array<{ id: string }> | null }>
  }>(
    `
      query($itemIds: [ID!]!) {
        items(ids: $itemIds) {
          subitems {
            id
          }
        }
      }
    `,
    { itemIds: [params.parentItemId] }
  )

  const subitems = existing.items?.[0]?.subitems || []
  for (const sub of subitems) {
    try {
      await mondayRequest(
        `
          mutation($itemId: ID!) {
            delete_item(item_id: $itemId) {
              id
            }
          }
        `,
        { itemId: sub.id }
      )
    } catch (error) {
      console.error(`Failed to delete Monday subitem ${sub.id}:`, error)
    }
  }

  await createSowSubitems(params)
}

export async function pushSowToMonday(sowId: string) {
  const auth = await requireTeamMemberForMonday()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }
  const { supabase } = auth

  try {
    const loaded = await loadSowForMonday(sowId)
    if ('error' in loaded && loaded.error) return { error: loaded.error }

    const { document, lineItems, adminClient } = loaded

    if (document.monday_project_id || document.monday_item_id) {
      return { error: 'This SoW is already linked to a leads board item' }
    }

    const leadsBoardResult = await getLeadsBoard()
    if (leadsBoardResult.error || !leadsBoardResult.board) {
      return {
        error:
          'Leads board not configured. Set it up in Settings → Monday.com Configuration → Leads Board.',
      }
    }

    const leadsBoardId = leadsBoardResult.board.monday_board_id

    const quotedHoursColumnId = await getLeadsColumnMapping(supabase, 'quoted_hours', leadsBoardId)
    if (!quotedHoursColumnId) {
      return {
        error:
          'Quoted hours column not mapped. Configure it in Settings → Monday.com Configuration.',
      }
    }

    const quoteValueColumnId = await getLeadsColumnMapping(supabase, 'quote_value', leadsBoardId)
    const clientColumnId = await getLeadsColumnMapping(supabase, 'client', leadsBoardId)
    const agencyColumnId = await getLeadsColumnMapping(supabase, 'agency', leadsBoardId)
    const dueDateColumnId = await getLeadsColumnMapping(supabase, 'due_date', leadsBoardId)
    const timelineColumnId = await getLeadsColumnMapping(supabase, 'timeline', leadsBoardId)

    const mainItemColumnValues: Record<string, unknown> = {}

    if (quoteValueColumnId) {
      mainItemColumnValues[quoteValueColumnId] = Number(document.subtotal_gbp).toFixed(2)
    }
    if (dueDateColumnId && document.end_date) {
      mainItemColumnValues[dueDateColumnId] = { date: document.end_date }
    }

    const createItemData = await mondayRequest<{
      create_item: { id: string; name: string }
    }>(
      `
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
      `,
      {
        boardId: leadsBoardId,
        itemName: document.title,
        columnValues: JSON.stringify(mainItemColumnValues),
      }
    )

    const itemId = createItemData.create_item?.id
    if (!itemId) throw new Error('Monday.com did not return an item ID')

    await syncParentDropdowns({
      itemId,
      boardId: leadsBoardId,
      document,
      clientColumnId,
      agencyColumnId,
    })

    await createSowSubitems({
      parentItemId: itemId,
      lineItems,
      quotedHoursColumnId,
      timelineColumnId,
    })

    const pushedAt = new Date().toISOString()
    const { error: updateError } = await adminClient
      .from('sow_documents')
      .update({
        monday_item_id: itemId,
        monday_board_id: leadsBoardId,
        pushed_to_monday_at: pushedAt,
      })
      .eq('id', sowId)

    if (updateError) throw updateError

    const { data: existingProject } = await adminClient
      .from('monday_projects')
      .select('id')
      .eq('monday_item_id', itemId)
      .maybeSingle()

    if (existingProject) {
      await adminClient
        .from('sow_documents')
        .update({ monday_project_id: existingProject.id })
        .eq('id', sowId)
    }

    return {
      success: true,
      itemId,
      message: `SoW pushed to Leads board as "${document.title}"`,
    }
  } catch (error) {
    console.error('Error pushing SoW to Monday:', error)
    return { error: error instanceof Error ? error.message : 'Failed to push to Monday.com' }
  }
}

/**
 * Update an already-linked Monday Leads item from the current SoW.
 * Replaces subitems with the current line items so deliverables stay in sync.
 */
export async function updateSowOnMonday(sowId: string) {
  const auth = await requireTeamMemberForMonday()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }
  const { supabase } = auth

  try {
    const loaded = await loadSowForMonday(sowId)
    if ('error' in loaded && loaded.error) return { error: loaded.error }

    const { document, lineItems, adminClient } = loaded

    const itemId = document.monday_item_id
    if (!itemId) {
      return { error: 'This SoW is not linked to a Monday item yet. Push it first.' }
    }

    let boardId = document.monday_board_id
    if (!boardId) {
      const leadsBoardResult = await getLeadsBoard()
      if (leadsBoardResult.error || !leadsBoardResult.board) {
        return {
          error:
            'Leads board not configured. Set it up in Settings → Monday.com Configuration → Leads Board.',
        }
      }
      boardId = leadsBoardResult.board.monday_board_id
    }

    const quotedHoursColumnId = await getLeadsColumnMapping(supabase, 'quoted_hours', boardId)
    if (!quotedHoursColumnId) {
      return {
        error:
          'Quoted hours column not mapped. Configure it in Settings → Monday.com Configuration.',
      }
    }

    const quoteValueColumnId = await getLeadsColumnMapping(supabase, 'quote_value', boardId)
    const clientColumnId = await getLeadsColumnMapping(supabase, 'client', boardId)
    const agencyColumnId = await getLeadsColumnMapping(supabase, 'agency', boardId)
    const dueDateColumnId = await getLeadsColumnMapping(supabase, 'due_date', boardId)
    const timelineColumnId = await getLeadsColumnMapping(supabase, 'timeline', boardId)

    const columnValues: Record<string, unknown> = {
      name: document.title,
    }
    if (quoteValueColumnId) {
      columnValues[quoteValueColumnId] = Number(document.subtotal_gbp).toFixed(2)
    }
    if (dueDateColumnId) {
      columnValues[dueDateColumnId] = document.end_date
        ? { date: document.end_date }
        : null
    }

    await mondayRequest(
      `
        mutation($itemId: ID!, $boardId: ID!, $columnValues: JSON!) {
          change_multiple_column_values(
            item_id: $itemId
            board_id: $boardId
            column_values: $columnValues
          ) {
            id
          }
        }
      `,
      {
        itemId,
        boardId,
        columnValues: JSON.stringify(columnValues),
      }
    )

    await syncParentDropdowns({
      itemId,
      boardId,
      document,
      clientColumnId,
      agencyColumnId,
    })

    await replaceMondaySubitems({
      parentItemId: itemId,
      lineItems,
      quotedHoursColumnId,
      timelineColumnId,
    })

    const pushedAt = new Date().toISOString()
    await adminClient
      .from('sow_documents')
      .update({
        monday_board_id: boardId,
        pushed_to_monday_at: pushedAt,
      })
      .eq('id', sowId)

    return {
      success: true,
      itemId,
      message: `Monday item updated for "${document.title}"`,
    }
  } catch (error) {
    console.error('Error updating SoW on Monday:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update Monday.com item' }
  }
}

export async function syncSowApprovalToMonday(
  sowId: string,
  approval: 'approved' | 'rejected'
) {
  try {
    const loaded = await loadSowForMonday(sowId)
    if ('error' in loaded && loaded.error) return

    const { document } = loaded
    const mondayItemId = document.monday_item_id
    const mondayBoardId = document.monday_board_id
    if (!mondayItemId || !mondayBoardId) return

    const adminClient = await createAdminClient()
    if (!adminClient) return

    const statusColumnId = await getLeadsColumnMapping(
      adminClient,
      'status',
      mondayBoardId
    )
    if (!statusColumnId) return

    const statusLabel =
      approval === 'approved' ? SOW_APPROVED_STATUS_LABEL : SOW_DECLINED_STATUS_LABEL

    await mondayRequest(
      `
        mutation($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
          change_column_value(
            item_id: $itemId,
            board_id: $boardId,
            column_id: $columnId,
            value: $value
          ) {
            id
          }
        }
      `,
      {
        itemId: mondayItemId,
        boardId: mondayBoardId,
        columnId: statusColumnId,
        value: JSON.stringify({ label: statusLabel }),
      }
    )
  } catch (error) {
    console.error('Error syncing SoW approval to Monday:', error)
  }
}
