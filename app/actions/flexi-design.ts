'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'
import { getFlexiDesignCompletedBoard } from './flexi-design-completed-board'
import crypto from 'crypto'
import { endOfWeek, format, startOfWeek } from 'date-fns'
import { billableQuotedHours, isSpeculativeProject } from '@/lib/flexi-design/speculative'

interface FlexiDesignClient {
  id: string
  client_name: string
  remaining_hours: number
  total_credits: number
  total_projects: number
  active_projects: number
  hours_used: number // logged hours for internal tracking
  quoted_hours_used?: number // quoted hours for credit deduction
  is_hidden?: boolean
  last_credit_hours?: number | null
  last_credit_date?: string | null
  /** Average hours per credit purchase transaction */
  avg_credit_purchase?: number | null
}

export interface FlexiDesignClientsSummary {
  active_projects: number
  completed_projects: number
  credits_used: number
  unused_credits: number
  time_logged_this_week: number
}

interface FlexiDesignProject {
  id: string
  name: string
  status: 'active' | 'archived' | 'locked'
  total_logged_hours: number
  quoted_hours?: number | null
  created_at: string
  completed_date?: string | null
  monday_status?: string | null
  is_speculative?: boolean
}

interface ClientDetail {
  id: string
  client_name: string
  remaining_hours: number
  hours_used: number // logged hours for internal tracking
  quoted_hours_used?: number // quoted hours for credit deduction
  total_projects: number
  projects: FlexiDesignProject[]
  credit_transactions?: Array<{
    id: string
    hours: number
    transaction_date: string
    created_at: string
    created_by: string | null
  }>
  completed_projects?: FlexiDesignProject[]
  completed_quoted_hours?: number
  completed_logged_hours?: number
}

/**
 * Get all Flexi-Design clients with their credit and stats
 */
export async function getFlexiDesignClients(options?: { includeHidden?: boolean }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const includeHidden = options?.includeHidden === true

  try {
    // Get Flexi-Design board IDs
    const flexiDesignBoardIds = await getFlexiDesignBoardIds()
    
    // Get Flexi-Design completed board ID to exclude it from active projects
    const completedBoardResult = await getFlexiDesignCompletedBoard()
    const completedBoardId = completedBoardResult.success && completedBoardResult.board 
      ? completedBoardResult.board.monday_board_id 
      : null
    
    if (flexiDesignBoardIds.size === 0) {
      return {
        success: true,
        clients: [],
        summary: {
          active_projects: 0,
          completed_projects: 0,
          credits_used: 0,
          unused_credits: 0,
          time_logged_this_week: 0,
        } satisfies FlexiDesignClientsSummary,
      }
    }

    // Filter out completed board from active board IDs
    const activeBoardIds = Array.from(flexiDesignBoardIds).filter(
      boardId => !completedBoardId || boardId !== completedBoardId
    )

    // Get all Flexi-Design projects with quoted_hours (from active boards, excluding completed board)
    const { data: allProjects, error: projectsError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, status, created_at, quoted_hours, monday_status')
      .in('monday_board_id', activeBoardIds)
      .in('status', ['active', 'archived', 'locked'])
      .order('created_at', { ascending: false })

    if (projectsError) throw projectsError

    // Get completed projects from the completed board
    let completedProjects: any[] = []
    if (completedBoardId) {
      const { data: completed, error: completedError } = await supabase
        .from('monday_projects')
        .select('id, name, client_name, status, created_at, quoted_hours, monday_status')
        .eq('monday_board_id', completedBoardId)
        .in('status', ['active', 'archived', 'locked'])

      if (!completedError && completed) {
        completedProjects = completed
      }
    }

    // Combine all projects (active + completed)
    const allProjectsIncludingCompleted = [...(allProjects || []), ...completedProjects]

    // Get all time entries for Flexi-Design projects (active + completed)
    const projectIds = allProjectsIncludingCompleted.map(p => p.id)
    const projectClientById = new Map<string, string>()
    for (const project of allProjectsIncludingCompleted) {
      if (project.id && project.client_name) {
        projectClientById.set(String(project.id), String(project.client_name))
      }
    }

    let timeEntriesByProject: Record<string, number> = {}
    const hoursThisWeekByClient: Record<string, number> = {}
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    
    if (projectIds.length > 0) {
      const { data: timeEntries, error: timeEntriesError } = await supabase
        .from('time_entries')
        .select('project_id, hours, date')
        .in('project_id', projectIds)

      if (timeEntriesError) throw timeEntriesError

      // Aggregate hours by project (all time) and by client for the current week
      if (timeEntries) {
        timeEntries.forEach((entry: any) => {
          const projectId = String(entry.project_id)
          const hours = Number(entry.hours) || 0
          timeEntriesByProject[projectId] = (timeEntriesByProject[projectId] || 0) + hours

          const entryDate = String(entry.date || '')
          if (entryDate >= weekStart && entryDate <= weekEnd) {
            const clientName = projectClientById.get(projectId)
            if (clientName) {
              hoursThisWeekByClient[clientName] =
                (hoursThisWeekByClient[clientName] || 0) + hours
            }
          }
        })
      }
    }

    // Get all Flexi-Design clients from the database
    // Handle gracefully if table doesn't exist yet (migration not run)
    let clientsData: any[] | null = null
    const { data, error: clientsError } = await supabase
      .from('flexi_design_clients')
      .select('*')
      .order('client_name', { ascending: true })

    if (clientsError) {
      // Check if table doesn't exist (common error codes)
      const errorMsg = clientsError.message || ''
      const errorCode = clientsError.code || ''
      
      if (
        errorCode === 'PGRST116' || 
        errorCode === '42P01' ||
        errorMsg.includes('does not exist') || 
        errorMsg.includes('relation') || 
        errorMsg.includes('table')
      ) {
        console.warn('flexi_design_clients table does not exist yet. Continuing with clients from projects only. Please run migration 004_add_flexi_design_clients.sql')
        // Continue without client credit data - we'll show clients from projects only
        clientsData = null
      } else {
        throw clientsError
      }
    } else {
      clientsData = data
    }

    // Group projects by client and calculate stats
    const clientsMap = new Map<string, {
      activeCount: number
      totalCount: number
      hoursUsed: number // logged hours for tracking
      quotedHoursUsed: number // quoted hours for credit deduction
    }>()

    function ensureClientStats(clientName: string) {
      if (!clientsMap.has(clientName)) {
        clientsMap.set(clientName, {
          activeCount: 0,
          totalCount: 0,
          hoursUsed: 0,
          quotedHoursUsed: 0,
        })
      }
      return clientsMap.get(clientName)!
    }

    // Active Flexi board projects
    ;(allProjects || []).forEach((project: any) => {
      if (!project.client_name) return
      const client = ensureClientStats(project.client_name)
      client.activeCount += 1
      client.totalCount += 1
      client.hoursUsed += timeEntriesByProject[project.id] || 0
      client.quotedHoursUsed += billableQuotedHours(project)
    })

    // Completed board projects count toward totals / credits used, not active
    completedProjects.forEach((project: any) => {
      if (!project.client_name) return
      const client = ensureClientStats(project.client_name)
      client.totalCount += 1
      client.hoursUsed += timeEntriesByProject[project.id] || 0
      client.quotedHoursUsed += billableQuotedHours(project)
    })

    // Get credit transactions to calculate total deposited and last credit added
    const creditTotalsByClientId: Record<string, number> = {}
    const creditPurchaseCountsByClientId: Record<string, number> = {}
    const lastCreditByClientId: Record<
      string,
      { hours: number; transaction_date: string; created_at: string }
    > = {}

    if (clientsData && clientsData.length > 0) {
      const clientIds = clientsData.map((c: any) => String(c.id))
      const pageSize = 1000
      const allTransactions: Array<{
        client_id: string
        hours: number | string
        transaction_date: string
        created_at: string
      }> = []

      // Chunk `.in()` filters to avoid request URL limits with many client IDs
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
            console.error('Error loading Flexi credit transactions for client list:', transactionsError)
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
        creditPurchaseCountsByClientId[clientId] =
          (creditPurchaseCountsByClientId[clientId] || 0) + 1

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
    }

    // Build client list with stats
    const clients: FlexiDesignClient[] = []

    // Add clients from database (they might not have projects yet)
    clientsData?.forEach((client: any) => {
      const clientId = String(client.id)
      const clientProjects = clientsMap.get(client.client_name)
      const hoursUsed = clientProjects?.hoursUsed || 0
      const quotedHoursUsed = clientProjects?.quotedHoursUsed || 0
      const totalProjects = clientProjects?.totalCount || 0
      const activeProjects = clientProjects?.activeCount || 0
      const totalDeposited = creditTotalsByClientId[clientId] || 0
      const purchaseCount = creditPurchaseCountsByClientId[clientId] || 0
      const lastCredit = lastCreditByClientId[clientId]
      
      // Calculate remaining hours: Total Hours Credited - Total Hours Estimated (quoted)
      // This includes both active and completed projects' quoted hours
      const remainingHours = totalDeposited - quotedHoursUsed

      clients.push({
        id: client.id,
        client_name: client.client_name,
        remaining_hours: remainingHours,
        total_credits: totalDeposited,
        total_projects: totalProjects,
        active_projects: activeProjects,
        hours_used: hoursUsed, // logged hours for internal tracking
        quoted_hours_used: quotedHoursUsed, // quoted hours for credit deduction
        is_hidden: Boolean(client.is_hidden),
        last_credit_hours: lastCredit ? lastCredit.hours : null,
        last_credit_date: lastCredit?.transaction_date || null,
        avg_credit_purchase: purchaseCount > 0 ? totalDeposited / purchaseCount : null,
      })
    })

    // Add clients that have projects but aren't in the database yet
    clientsMap.forEach((data, clientName) => {
      const exists = clients.find(c => c.client_name === clientName)
      if (!exists) {
        clients.push({
          id: '', // Will be created when they get their first credit
          client_name: clientName,
          remaining_hours: 0 - data.quotedHoursUsed, // Negative if they have quoted hours but no credit
          total_credits: 0,
          total_projects: data.totalCount,
          active_projects: data.activeCount,
          hours_used: data.hoursUsed, // logged hours for internal tracking
          quoted_hours_used: data.quotedHoursUsed, // quoted hours for credit deduction
          is_hidden: false,
          last_credit_hours: null,
          last_credit_date: null,
          avg_credit_purchase: null,
        })
      }
    })

    // Sort by client name
    clients.sort((a, b) => a.client_name.localeCompare(b.client_name))

    const visibleClients = includeHidden
      ? clients
      : clients.filter((client) => !client.is_hidden)

    const summary: FlexiDesignClientsSummary = {
      active_projects: visibleClients.reduce((sum, c) => sum + (c.active_projects || 0), 0),
      completed_projects: visibleClients.reduce(
        (sum, c) => sum + Math.max(0, (c.total_projects || 0) - (c.active_projects || 0)),
        0
      ),
      credits_used: visibleClients.reduce((sum, c) => sum + (c.quoted_hours_used || 0), 0),
      unused_credits: visibleClients.reduce((sum, c) => sum + c.remaining_hours, 0),
      time_logged_this_week: visibleClients.reduce(
        (sum, c) => sum + (hoursThisWeekByClient[c.client_name] || 0),
        0
      ),
    }

    return { success: true, clients: visibleClients, summary }
  } catch (error) {
    console.error('Error fetching Flexi-Design clients:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch clients'
    
    // Provide more specific error messages
    if (errorMessage.includes('does not exist') || errorMessage.includes('relation') || errorMessage.includes('table')) {
      return { 
        error: 'Database table not found. Please run migration 004_add_flexi_design_clients.sql in Supabase. See the migrations folder for details.' 
      }
    }
    
    return { error: errorMessage }
  }
}

/**
 * Get detailed information for a specific Flexi-Design client
 */
export async function getFlexiDesignClientDetail(clientName: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Get Flexi-Design board IDs
    const flexiDesignBoardIds = await getFlexiDesignBoardIds()
    
    // Get Flexi-Design completed board ID to exclude it from active projects
    const completedBoardResult = await getFlexiDesignCompletedBoard()
    const completedBoardId = completedBoardResult.success && completedBoardResult.board 
      ? completedBoardResult.board.monday_board_id 
      : null
    
    if (flexiDesignBoardIds.size === 0) {
      return { error: 'No Flexi-Design boards configured' }
    }

    // Get client from database
    // Handle gracefully if table doesn't exist yet
    let clientData: any = null
    const { data, error: clientError } = await supabase
      .from('flexi_design_clients')
      .select('*')
      .eq('client_name', clientName)
      .maybeSingle()

    if (clientError) {
      // Check if table doesn't exist
      const errorMsg = clientError.message || ''
      const errorCode = clientError.code || ''
      
      if (
        errorCode === 'PGRST116' || 
        errorCode === '42P01' ||
        errorMsg.includes('does not exist') || 
        errorMsg.includes('relation') || 
        errorMsg.includes('table')
      ) {
        // Table doesn't exist - continue with default values
        console.warn('flexi_design_clients table does not exist yet. Using default values.')
        clientData = null
      } else {
        throw clientError
      }
    } else {
      clientData = data
    }

    // Filter out completed board from active board IDs
    const activeBoardIds = Array.from(flexiDesignBoardIds).filter(
      boardId => !completedBoardId || boardId !== completedBoardId
    )

    // Get all projects for this client from active Flexi-Design boards (excluding completed board)
    const { data: projects, error: projectsError } = await supabase
      .from('monday_projects')
      .select('id, name, status, created_at, quoted_hours, monday_status')
      .in('monday_board_id', activeBoardIds)
      .eq('client_name', clientName)
      .in('status', ['active', 'archived', 'locked'])
      .order('created_at', { ascending: false })

    if (projectsError) throw projectsError

    // Get time entries for these projects (for internal tracking display)
    const projectIds = (projects || []).map(p => p.id)
    let timeEntriesByProject: Record<string, number> = {}
    let totalHoursUsed = 0
    let totalQuotedHours = 0

    if (projectIds.length > 0) {
      const { data: timeEntries, error: timeEntriesError } = await supabase
        .from('time_entries')
        .select('project_id, hours')
        .in('project_id', projectIds)

      if (timeEntriesError) throw timeEntriesError

      if (timeEntries) {
        timeEntries.forEach((entry: any) => {
          const hours = Number(entry.hours)
          timeEntriesByProject[entry.project_id] = 
            (timeEntriesByProject[entry.project_id] || 0) + hours
          totalHoursUsed += hours
        })
      }
    }

    // Calculate total billable quoted hours for credit deduction (exclude speculative)
    if (projects) {
      projects.forEach((project: any) => {
        totalQuotedHours += billableQuotedHours(project)
      })
    }

    // Get total deposited from credit transactions
    let totalDeposited = 0
    if (clientData) {
      const { data: transactions } = await supabase
        .from('flexi_design_credit_transactions')
        .select('hours')
        .eq('client_id', clientData.id)
      
      if (transactions) {
        totalDeposited = transactions.reduce((sum, tx: any) => sum + Number(tx.hours), 0)
      }
    }

    // Build projects with hours
    const projectsWithHours: FlexiDesignProject[] = (projects || []).map((project: any) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      total_logged_hours: timeEntriesByProject[project.id] || 0,
      quoted_hours: project.quoted_hours ? Number(project.quoted_hours) : null,
      created_at: project.created_at,
      monday_status: project.monday_status || null,
      is_speculative: isSpeculativeProject(project),
    }))

    // Get credit transactions for this client (needed before calculating remaining hours)
    let creditTransactions: Array<{
      id: string
      hours: number
      transaction_date: string
      created_at: string
      created_by: string | null
    }> = []
    
    if (clientData) {
      const { data: transactions, error: transactionsError } = await supabase
        .from('flexi_design_credit_transactions')
        .select('id, hours, transaction_date, created_at, created_by')
        .eq('client_id', clientData.id)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
      
      if (transactionsError) {
        // If table doesn't exist yet, just continue without transactions
        if (!transactionsError.message.includes('does not exist') && 
            !transactionsError.message.includes('relation')) {
          throw transactionsError
        }
      } else if (transactions) {
        creditTransactions = transactions.map((tx: any) => ({
          id: tx.id,
          hours: Number(tx.hours),
          transaction_date: tx.transaction_date,
          created_at: tx.created_at,
          created_by: tx.created_by,
        }))
      }
    }

    // Get completed projects from the completed board
    let completedProjectsWithHours: FlexiDesignProject[] = []
    let totalCompletedQuotedHours = 0
    let totalCompletedLoggedHours = 0
    
    if (completedBoardId) {
      // Get completed projects for this client from the completed board
      const { data: completedProjects, error: completedProjectsError } = await supabase
        .from('monday_projects')
        .select('id, name, status, created_at, quoted_hours, completed_date, monday_status')
        .eq('monday_board_id', completedBoardId)
        .eq('client_name', clientName)
        .in('status', ['active', 'archived', 'locked'])
        .order('completed_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (!completedProjectsError && completedProjects && completedProjects.length > 0) {
        // Get time entries for completed projects
        const completedProjectIds = completedProjects.map(p => p.id)
        let completedTimeEntriesByProject: Record<string, number> = {}
        
        if (completedProjectIds.length > 0) {
          const { data: completedTimeEntries, error: completedTimeEntriesError } = await supabase
            .from('time_entries')
            .select('project_id, hours')
            .in('project_id', completedProjectIds)

          if (!completedTimeEntriesError && completedTimeEntries) {
            completedTimeEntries.forEach((entry: any) => {
              const hours = Number(entry.hours)
              completedTimeEntriesByProject[entry.project_id] = 
                (completedTimeEntriesByProject[entry.project_id] || 0) + hours
              totalCompletedLoggedHours += hours
            })
          }
        }

        // Billable quoted hours for completed projects (exclude speculative)
        completedProjects.forEach((project: any) => {
          totalCompletedQuotedHours += billableQuotedHours(project)
        })

        // Build completed projects with hours
        completedProjectsWithHours = completedProjects.map((project: any) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          total_logged_hours: completedTimeEntriesByProject[project.id] || 0,
          quoted_hours: project.quoted_hours ? Number(project.quoted_hours) : null,
          created_at: project.created_at,
          completed_date: project.completed_date,
          monday_status: project.monday_status || null,
          is_speculative: isSpeculativeProject(project),
        }))
      }
    }

    // Calculate remaining hours: total deposited (credited) - total quoted hours (estimated)
    // Include both active and completed projects in the quoted hours total
    const totalEstimatedHours = totalQuotedHours + totalCompletedQuotedHours
    const remainingHours = totalDeposited - totalEstimatedHours

    const clientDetail: ClientDetail = {
      id: clientData?.id || '',
      client_name: clientName,
      remaining_hours: remainingHours,
      hours_used: totalHoursUsed, // logged hours on active Flexi boards only (sum of time_entries)
      // Sum of quoted_hours on active + completed Flexi projects — do not add completed_quoted_hours again in UI
      quoted_hours_used: totalEstimatedHours,
      total_projects: projectsWithHours.length,
      projects: projectsWithHours,
      credit_transactions: creditTransactions,
      completed_projects: completedProjectsWithHours,
      completed_quoted_hours: totalCompletedQuotedHours,
      completed_logged_hours: totalCompletedLoggedHours,
    }

    return { success: true, client: clientDetail }
  } catch (error) {
    console.error('Error fetching Flexi-Design client detail:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch client detail' }
  }
}

/**
 * Hide or unhide a Flexi-Design client from the default Clients list.
 * Creates a flexi_design_clients row if the client only exists via Monday projects.
 */
export async function setFlexiDesignClientHidden(clientName: string, isHidden: boolean) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  const trimmedName = clientName.trim()
  if (!trimmedName) {
    return { error: 'Client name is required' }
  }

  try {
    const { data: existingClient, error: checkError } = await supabase
      .from('flexi_design_clients')
      .select('id, is_hidden')
      .eq('client_name', trimmedName)
      .maybeSingle()

    if (checkError) {
      const errorMsg = checkError.message || ''
      if (errorMsg.includes('does not exist') || errorMsg.includes('relation')) {
        return {
          error:
            'Database column/table not found. Please run migration 069_flexi_design_clients_hidden.sql in Supabase.',
        }
      }
      throw checkError
    }

    if (existingClient) {
      const { error: updateError } = await supabase
        .from('flexi_design_clients')
        .update({ is_hidden: isHidden })
        .eq('id', existingClient.id)

      if (updateError) throw updateError
    } else {
      const { error: createError } = await supabase.from('flexi_design_clients').insert({
        client_name: trimmedName,
        remaining_hours: 0,
        is_hidden: isHidden,
      })

      if (createError) throw createError
    }

    return { success: true }
  } catch (error) {
    console.error('Error updating Flexi-Design client hidden status:', error)
    return {
      error:
        error instanceof Error ? error.message : 'Failed to update client visibility',
    }
  }
}

/**
 * Update or create a Flexi-Design client's credit by adding a transaction
 */
export async function updateFlexiDesignClientCredit(
  clientName: string,
  additionalHours: number,
  transactionDate?: string
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if user is admin
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Check if client exists
    let clientId: string
    const { data: existingClient, error: checkError } = await supabase
      .from('flexi_design_clients')
      .select('id')
      .eq('client_name', clientName)
      .maybeSingle()

    if (checkError) {
      // If table doesn't exist yet, provide helpful error
      const errorMsg = checkError.message || ''
      if (errorMsg.includes('does not exist') || errorMsg.includes('relation')) {
        return { 
          error: 'Database table not found. Please run migration 004_add_flexi_design_clients.sql in Supabase.' 
        }
      }
      throw checkError
    }

    if (existingClient) {
      clientId = existingClient.id
    } else {
      // Create new client first
      const { data: newClient, error: createError } = await supabase
        .from('flexi_design_clients')
        .insert({
          client_name: clientName,
          remaining_hours: 0, // Will be calculated from transactions - quoted hours
        })
        .select('id')
        .single()

      if (createError) {
        console.error('Error creating client:', createError)
        throw createError
      }
      clientId = newClient.id
    }

    // Add credit transaction with date
    const dateToUse = transactionDate || new Date().toISOString().split('T')[0]
    
    const { data: transaction, error: transactionError } = await supabase
      .from('flexi_design_credit_transactions')
      .insert({
        client_id: clientId,
        hours: additionalHours,
        transaction_date: dateToUse,
        created_by: user.id,
      })
      .select()
      .single()

    if (transactionError) {
      // If transactions table doesn't exist yet, provide helpful error
      const errorMsg = transactionError.message || ''
      if (errorMsg.includes('does not exist') || errorMsg.includes('relation')) {
        return { 
          error: 'Credit transactions table not found. Please run migration 013_add_flexi_design_credit_transactions.sql in Supabase.' 
        }
      }
      console.error('Error creating credit transaction:', transactionError)
      throw transactionError
    }

    // Get updated client data (remaining_hours will be calculated on read)
    const { data: updatedClient, error: fetchError } = await supabase
      .from('flexi_design_clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (fetchError) {
      console.error('Error fetching updated client:', fetchError)
      throw fetchError
    }

    console.log(`Successfully added ${additionalHours} hours to ${clientName} (transaction ID: ${transaction.id})`)
    
    return { success: true, client: updatedClient, transaction }
  } catch (error) {
    console.error('Error updating Flexi-Design client credit:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update client credit' }
  }
}

export async function updateFlexiDesignCreditTransaction(
  transactionId: string,
  updates: { hours?: number; transaction_date?: string }
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  const payload: Record<string, any> = {}
  if (typeof updates.hours === 'number') payload.hours = updates.hours
  if (typeof updates.transaction_date === 'string') payload.transaction_date = updates.transaction_date
  if (Object.keys(payload).length === 0) return { error: 'No updates provided' }

  try {
    const { data, error } = await supabase
      .from('flexi_design_credit_transactions')
      .update(payload)
      .eq('id', transactionId)
      .select('id, client_id, hours, transaction_date, created_at, created_by')
      .single()

    if (error) throw error
    return { success: true, transaction: data }
  } catch (error) {
    console.error('Error updating credit transaction:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update credit transaction' }
  }
}

export async function deleteFlexiDesignCreditTransaction(transactionId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { error } = await supabase
      .from('flexi_design_credit_transactions')
      .delete()
      .eq('id', transactionId)

    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error deleting credit transaction:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete credit transaction' }
  }
}

export interface FlexiDesignShareLink {
  id: string
  flexi_design_client_id: string
  share_token: string
  created_by: string | null
  created_at: string
  expires_at: string | null
  is_active: boolean
}

/**
 * Create a public share link for a Flexi-Design client (admin only)
 */
export async function createFlexiDesignShareLink(clientName: string, expiresAt?: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Ensure the client exists in flexi_design_clients so we have an id to reference.
    // Some clients can appear via Monday projects before any credit has been added.
    const { data: existingClient, error: existingClientError } = await supabase
      .from('flexi_design_clients')
      .select('id')
      .eq('client_name', clientName)
      .maybeSingle()

    if (existingClientError) throw existingClientError

    let flexiDesignClientId = existingClient?.id as string | undefined
    if (!flexiDesignClientId) {
      const { data: createdClient, error: createdClientError } = await supabase
        .from('flexi_design_clients')
        .insert({ client_name: clientName, remaining_hours: 0 })
        .select('id')
        .single()
      if (createdClientError) throw createdClientError
      flexiDesignClientId = createdClient.id as string
    }

    // Generate a unique token
    const shareToken = crypto.randomBytes(32).toString('hex')

    const { data, error } = await supabase
      .from('flexi_design_share_links')
      .insert({
        flexi_design_client_id: flexiDesignClientId,
        share_token: shareToken,
        created_by: user.id,
        expires_at: expiresAt || null,
        is_active: true,
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, shareLink: data as FlexiDesignShareLink }
  } catch (error) {
    console.error('Error creating share link:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create share link' }
  }
}

/**
 * Get Flexi-Design client by share token (public access)
 */
export async function getFlexiDesignClientByToken(shareToken: string) {
  const supabase = await createAdminClient()

  if (!supabase) {
    return { error: 'Admin client not available' }
  }

  try {
    const { data, error } = await supabase
      .from('flexi_design_share_links')
      .select(`
        *,
        flexi_design_client:flexi_design_clients(*)
      `)
      .eq('share_token', shareToken)
      .eq('is_active', true)
      .single()

    if (error) throw error

    if (!data) {
      return { error: 'Share link not found or inactive' }
    }

    // Check if expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { error: 'Share link has expired' }
    }

    const client = (data as any).flexi_design_client as FlexiDesignClient | null
    if (!client) {
      return { error: 'Client not found' }
    }

    return { success: true, shareLink: data as any, client }
  } catch (error) {
    console.error('Error fetching share link:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch share link' }
  }
}

/**
 * Get all share links for a Flexi-Design client (admin only)
 */
export async function getFlexiDesignShareLinks(flexiDesignClientId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('flexi_design_share_links')
      .select('*')
      .eq('flexi_design_client_id', flexiDesignClientId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return { success: true, shareLinks: (data || []) as FlexiDesignShareLink[] }
  } catch (error) {
    console.error('Error fetching share links:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch share links' }
  }
}

/**
 * Deactivate a share link (admin only)
 */
export async function deactivateFlexiDesignShareLink(shareLinkId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { error } = await supabase
      .from('flexi_design_share_links')
      .update({ is_active: false })
      .eq('id', shareLinkId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error deactivating share link:', error)
    return { error: error instanceof Error ? error.message : 'Failed to deactivate share link' }
  }
}
