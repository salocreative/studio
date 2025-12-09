'use server'

import { createClient } from '@/lib/supabase/server'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'

interface FlexiDesignClient {
  id: string
  client_name: string
  remaining_hours: number
  total_projects: number
  hours_used: number // logged hours for internal tracking
  quoted_hours_used?: number // quoted hours for credit deduction
}

interface FlexiDesignProject {
  id: string
  name: string
  status: 'active' | 'archived' | 'locked'
  total_logged_hours: number
  quoted_hours?: number | null
  created_at: string
}

interface ClientDetail {
  id: string
  client_name: string
  remaining_hours: number
  hours_used: number
  total_projects: number
  projects: FlexiDesignProject[]
}

/**
 * Get all Flexi-Design clients with their credit and stats
 */
export async function getFlexiDesignClients() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Get Flexi-Design board IDs
    const flexiDesignBoardIds = await getFlexiDesignBoardIds()
    
    if (flexiDesignBoardIds.size === 0) {
      return { success: true, clients: [] }
    }

    // Get all Flexi-Design projects with quoted_hours
    const { data: allProjects, error: projectsError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, status, created_at, quoted_hours')
      .in('monday_board_id', Array.from(flexiDesignBoardIds))
      .in('status', ['active', 'archived', 'locked'])
      .order('created_at', { ascending: false })

    if (projectsError) throw projectsError

    // Get all time entries for Flexi-Design projects
    const projectIds = (allProjects || []).map(p => p.id)
    let timeEntriesByProject: Record<string, number> = {}
    
    if (projectIds.length > 0) {
      const { data: timeEntries, error: timeEntriesError } = await supabase
        .from('time_entries')
        .select('project_id, hours')
        .in('project_id', projectIds)

      if (timeEntriesError) throw timeEntriesError

      // Aggregate hours by project
      if (timeEntries) {
        timeEntries.forEach((entry: any) => {
          timeEntriesByProject[entry.project_id] = 
            (timeEntriesByProject[entry.project_id] || 0) + Number(entry.hours)
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
      projects: typeof allProjects
      hoursUsed: number // logged hours for tracking
      quotedHoursUsed: number // quoted hours for credit deduction
    }>()

    allProjects?.forEach((project: any) => {
      if (!project.client_name) return
      
      if (!clientsMap.has(project.client_name)) {
        clientsMap.set(project.client_name, {
          projects: [],
          hoursUsed: 0,
          quotedHoursUsed: 0,
        })
      }

      const client = clientsMap.get(project.client_name)!
      client.projects.push(project)
      client.hoursUsed += timeEntriesByProject[project.id] || 0
      // Use quoted_hours for credit deduction
      const quotedHours = project.quoted_hours ? Number(project.quoted_hours) : 0
      client.quotedHoursUsed += quotedHours
    })

    // Get credit transactions to calculate total deposited
    let creditTransactions: Record<string, number> = {}
    if (clientsData && clientsData.length > 0) {
      const clientIds = clientsData.map((c: any) => c.id)
      const { data: transactions } = await supabase
        .from('flexi_design_credit_transactions')
        .select('client_id, hours')
        .in('client_id', clientIds)
      
      if (transactions) {
        transactions.forEach((tx: any) => {
          const client = clientsData.find((c: any) => c.id === tx.client_id)
          if (client) {
            creditTransactions[client.client_name] = 
              (creditTransactions[client.client_name] || 0) + Number(tx.hours)
          }
        })
      }
    }

    // Build client list with stats
    const clients: FlexiDesignClient[] = []

    // Add clients from database (they might not have projects yet)
    clientsData?.forEach((client: any) => {
      const clientProjects = clientsMap.get(client.client_name)
      const hoursUsed = clientProjects?.hoursUsed || 0
      const quotedHoursUsed = clientProjects?.quotedHoursUsed || 0
      const totalProjects = clientProjects?.projects.length || 0
      const totalDeposited = creditTransactions[client.client_name] || 0
      
      // Calculate remaining hours: total deposited - total quoted hours
      const remainingHours = totalDeposited - quotedHoursUsed

      clients.push({
        id: client.id,
        client_name: client.client_name,
        remaining_hours: remainingHours,
        total_projects: totalProjects,
        hours_used: hoursUsed, // logged hours for internal tracking
        quoted_hours_used: quotedHoursUsed, // quoted hours for credit deduction
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
          total_projects: data.projects.length,
          hours_used: data.hoursUsed, // logged hours for internal tracking
          quoted_hours_used: data.quotedHoursUsed, // quoted hours for credit deduction
        })
      }
    })

    // Sort by client name
    clients.sort((a, b) => a.client_name.localeCompare(b.client_name))

    return { success: true, clients }
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

    // Get all projects for this client from Flexi-Design boards with quoted_hours
    const { data: projects, error: projectsError } = await supabase
      .from('monday_projects')
      .select('id, name, status, created_at, quoted_hours')
      .in('monday_board_id', Array.from(flexiDesignBoardIds))
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

    // Calculate total quoted hours for credit deduction
    if (projects) {
      projects.forEach((project: any) => {
        const quotedHours = project.quoted_hours ? Number(project.quoted_hours) : 0
        totalQuotedHours += quotedHours
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
    }))

    // Calculate remaining hours: total deposited - total quoted hours
    const remainingHours = totalDeposited - totalQuotedHours

    const clientDetail: ClientDetail = {
      id: clientData?.id || '',
      client_name: clientName,
      remaining_hours: remainingHours,
      hours_used: totalHoursUsed, // logged hours for internal tracking
      quoted_hours_used: totalQuotedHours, // quoted hours for credit deduction
      total_projects: projectsWithHours.length,
      projects: projectsWithHours,
    }

    // Get credit transactions for this client
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

    const clientDetail: ClientDetail = {
      id: clientData?.id || '',
      client_name: clientName,
      remaining_hours: remainingHours,
      hours_used: totalHoursUsed, // logged hours for internal tracking
      quoted_hours_used: totalQuotedHours, // quoted hours for credit deduction
      total_projects: projectsWithHours.length,
      projects: projectsWithHours,
      credit_transactions: creditTransactions,
    }

    return { success: true, client: clientDetail }
  } catch (error) {
    console.error('Error fetching Flexi-Design client detail:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch client detail' }
  }
}

/**
 * Update or create a Flexi-Design client's remaining hours
 */
export async function updateFlexiDesignClientCredit(
  clientName: string,
  additionalHours: number
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
    const { data: existingClient, error: checkError } = await supabase
      .from('flexi_design_clients')
      .select('*')
      .eq('client_name', clientName)
      .maybeSingle()

    if (checkError) throw checkError

    if (existingClient) {
      // Update existing client
      const newRemainingHours = Number(existingClient.remaining_hours) + additionalHours
      
      const { data, error } = await supabase
        .from('flexi_design_clients')
        .update({ remaining_hours: newRemainingHours })
        .eq('id', existingClient.id)
        .select()
        .single()

      if (error) throw error
      return { success: true, client: data }
    } else {
      // Create new client
      const { data, error } = await supabase
        .from('flexi_design_clients')
        .insert({
          client_name: clientName,
          remaining_hours: additionalHours,
        })
        .select()
        .single()

      if (error) throw error
      return { success: true, client: data }
    }
  } catch (error) {
    console.error('Error updating Flexi-Design client credit:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update client credit' }
  }
}

