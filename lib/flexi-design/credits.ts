import type { SupabaseClient } from '@supabase/supabase-js'
import { billableQuotedHours } from '@/lib/flexi-design/speculative'
import {
  getFlexiDesignBoardIds,
  getFlexiDesignCompletedBoardId,
} from '@/lib/monday/board-helpers'

export type FlexiCreditsQueryClient = SupabaseClient

export type FlexiProjectForCredits = {
  id: string
  name?: string | null
  client_name: string | null
  status?: string | null
  created_at?: string | null
  quoted_hours?: number | string | null
  monday_status?: string | null
}

export type FlexiDesignClientRow = {
  id: string
  client_name: string
  is_hidden?: boolean | null
}

export type LastCredit = {
  hours: number
  transaction_date: string
  created_at: string
}

export type FlexiDesignCreditSources = {
  flexiBoardIds: Set<string>
  completedBoardId: string | null
  activeBoardIds: string[]
  activeProjects: FlexiProjectForCredits[]
  completedProjects: FlexiProjectForCredits[]
  clientsData: FlexiDesignClientRow[] | null
  creditTotalsByClientId: Record<string, number>
  creditPurchaseCountsByClientId: Record<string, number>
  lastCreditByClientId: Record<string, LastCredit>
}

export type FlexiDesignCreditBalance = {
  id: string
  client_name: string
  is_hidden: boolean
  total_credits: number
  credits_used: number
  remaining_credits: number
  last_credit_hours: number | null
  last_credit_date: string | null
  avg_credit_purchase: number | null
}

function isMissingRelationError(error: { message?: string; code?: string } | null | undefined) {
  const errorMsg = error?.message || ''
  const errorCode = error?.code || ''
  return (
    errorCode === 'PGRST116' ||
    errorCode === '42P01' ||
    errorMsg.includes('does not exist') ||
    errorMsg.includes('relation') ||
    errorMsg.includes('table') ||
    errorMsg.includes('schema cache')
  )
}

const PROJECT_SELECT = 'id, name, client_name, status, created_at, quoted_hours, monday_status'
const PROJECT_STATUSES = ['active', 'archived', 'locked'] as const

async function loadCreditTransactions(
  supabase: FlexiCreditsQueryClient,
  clientIds: string[]
): Promise<{
  creditTotalsByClientId: Record<string, number>
  creditPurchaseCountsByClientId: Record<string, number>
  lastCreditByClientId: Record<string, LastCredit>
}> {
  const creditTotalsByClientId: Record<string, number> = {}
  const creditPurchaseCountsByClientId: Record<string, number> = {}
  const lastCreditByClientId: Record<string, LastCredit> = {}

  if (clientIds.length === 0) {
    return { creditTotalsByClientId, creditPurchaseCountsByClientId, lastCreditByClientId }
  }

  const pageSize = 1000
  const allTransactions: Array<{
    client_id: string
    hours: number | string
    transaction_date: string
    created_at: string
  }> = []

  for (let i = 0; i < clientIds.length; i += 100) {
    const idChunk = clientIds.slice(i, i + 100)
    let from = 0

    while (true) {
      const { data: transactions, error: transactionsError } = await supabase
        .from('flexi_design_credit_transactions')
        .select('client_id, hours, transaction_date, created_at')
        .in('client_id', idChunk)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1)

      if (transactionsError) {
        if (!isMissingRelationError(transactionsError)) {
          console.error('Error loading Flexi credit transactions:', transactionsError)
        }
        break
      }

      if (!transactions?.length) break
      allTransactions.push(...transactions)
      if (transactions.length < pageSize) break
      from += pageSize
    }
  }

  for (const tx of allTransactions) {
    const clientId = String(tx.client_id)
    const hours = Number(tx.hours) || 0
    creditTotalsByClientId[clientId] = (creditTotalsByClientId[clientId] || 0) + hours
    creditPurchaseCountsByClientId[clientId] = (creditPurchaseCountsByClientId[clientId] || 0) + 1

    const txDate = String(tx.transaction_date || '').slice(0, 10)

    // Rows are ordered newest-first, so the first time we see a client is their latest credit
    if (!lastCreditByClientId[clientId]) {
      lastCreditByClientId[clientId] = {
        hours,
        transaction_date: txDate,
        created_at: String(tx.created_at || ''),
      }
    }
  }

  return { creditTotalsByClientId, creditPurchaseCountsByClientId, lastCreditByClientId }
}

/**
 * Load the inputs for Flexi credit balances: boards, projects, client rows, deposits.
 * remaining = sum(deposits) − sum(billable quoted hours on Flexi boards, excluding speculative).
 */
export async function loadFlexiDesignCreditSources(
  supabase: FlexiCreditsQueryClient
): Promise<FlexiDesignCreditSources> {
  const [flexiBoardIds, completedBoardId] = await Promise.all([
    getFlexiDesignBoardIds(),
    getFlexiDesignCompletedBoardId(),
  ])
  const activeBoardIds = Array.from(flexiBoardIds).filter(
    (boardId) => !completedBoardId || boardId !== completedBoardId
  )

  let activeProjects: FlexiProjectForCredits[] = []
  if (flexiBoardIds.size > 0 && activeBoardIds.length > 0) {
    const { data, error } = await supabase
      .from('monday_projects')
      .select(PROJECT_SELECT)
      .in('monday_board_id', activeBoardIds)
      .in('status', PROJECT_STATUSES)
      .order('created_at', { ascending: false })

    if (error) throw error
    activeProjects = data || []
  }

  let completedProjects: FlexiProjectForCredits[] = []
  if (completedBoardId) {
    const { data, error } = await supabase
      .from('monday_projects')
      .select(PROJECT_SELECT)
      .eq('monday_board_id', completedBoardId)
      .in('status', PROJECT_STATUSES)

    if (!error && data) {
      completedProjects = data
    }
  }

  let clientsData: FlexiDesignClientRow[] | null = null
  const { data, error: clientsError } = await supabase
    .from('flexi_design_clients')
    .select('id, client_name, is_hidden')
    .order('client_name', { ascending: true })

  if (clientsError) {
    if (isMissingRelationError(clientsError)) {
      console.warn(
        'flexi_design_clients table does not exist yet. Continuing with clients from projects only.'
      )
      clientsData = null
    } else {
      throw clientsError
    }
  } else {
    clientsData = data
  }

  const deposits = await loadCreditTransactions(
    supabase,
    (clientsData || []).map((c) => String(c.id))
  )

  return {
    flexiBoardIds,
    completedBoardId,
    activeBoardIds,
    activeProjects,
    completedProjects,
    clientsData,
    ...deposits,
  }
}

function quotedHoursUsedByClientName(sources: FlexiDesignCreditSources): Map<string, number> {
  const quotedHoursUsed = new Map<string, number>()

  function add(project: FlexiProjectForCredits) {
    if (!project.client_name) return
    const hours = billableQuotedHours(project)
    quotedHoursUsed.set(project.client_name, (quotedHoursUsed.get(project.client_name) || 0) + hours)
  }

  sources.activeProjects.forEach(add)
  sources.completedProjects.forEach(add)
  return quotedHoursUsed
}

/** remaining_credits = total deposits − billable quoted hours (active + completed Flexi, not speculative). */
export function buildFlexiDesignCreditBalances(
  sources: FlexiDesignCreditSources
): FlexiDesignCreditBalance[] {
  const quotedHoursUsed = quotedHoursUsedByClientName(sources)
  const clients: FlexiDesignCreditBalance[] = []
  const seen = new Set<string>()

  for (const client of sources.clientsData || []) {
    const clientId = String(client.id)
    const totalDeposited = sources.creditTotalsByClientId[clientId] || 0
    const creditsUsed = quotedHoursUsed.get(client.client_name) || 0
    const purchaseCount = sources.creditPurchaseCountsByClientId[clientId] || 0
    const lastCredit = sources.lastCreditByClientId[clientId]

    seen.add(client.client_name)
    clients.push({
      id: client.id,
      client_name: client.client_name,
      is_hidden: Boolean(client.is_hidden),
      total_credits: totalDeposited,
      credits_used: creditsUsed,
      remaining_credits: totalDeposited - creditsUsed,
      last_credit_hours: lastCredit ? lastCredit.hours : null,
      last_credit_date: lastCredit?.transaction_date || null,
      avg_credit_purchase: purchaseCount > 0 ? totalDeposited / purchaseCount : null,
    })
  }

  quotedHoursUsed.forEach((creditsUsed, clientName) => {
    if (seen.has(clientName)) return
    clients.push({
      id: '',
      client_name: clientName,
      is_hidden: false,
      total_credits: 0,
      credits_used: creditsUsed,
      remaining_credits: 0 - creditsUsed,
      last_credit_hours: null,
      last_credit_date: null,
      avg_credit_purchase: null,
    })
  })

  clients.sort((a, b) => a.client_name.localeCompare(b.client_name))
  return clients
}

export async function getFlexiDesignCreditBalances(
  supabase: FlexiCreditsQueryClient,
  options?: { includeHidden?: boolean; clientName?: string }
): Promise<{ success: true; clients: FlexiDesignCreditBalance[] } | { error: string }> {
  try {
    const sources = await loadFlexiDesignCreditSources(supabase)
    let clients = buildFlexiDesignCreditBalances(sources)

    if (options?.includeHidden !== true) {
      clients = clients.filter((client) => !client.is_hidden)
    }

    const clientName = options?.clientName?.trim()
    if (clientName) {
      const needle = clientName.toLowerCase()
      clients = clients.filter((client) => client.client_name.toLowerCase() === needle)
    }

    return { success: true, clients }
  } catch (error) {
    console.error('Error loading Flexi-Design credit balances:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to load credit balances'
    return { error: errorMessage }
  }
}
