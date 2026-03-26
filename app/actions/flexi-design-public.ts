'use server'

import { createAdminClient } from '@/lib/supabase/server'

/**
 * Get Flexi-Design client data for public view (by client name)
 * This version uses admin client to bypass authentication
 */
export async function getFlexiDesignClientDataPublic(clientName: string) {
  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin client not available' }
  }

  try {
    // Resolve Flexi-Design board IDs using service role reads (public share views have no user session).
    const { data: mappings, error: mappingsError } = await adminClient
      .from('monday_column_mappings')
      .select('board_id')
      .not('board_id', 'is', null)

    if (mappingsError) throw mappingsError

    const allMappedBoardIds = Array.from(
      new Set((mappings || []).map((m: any) => m.board_id).filter(Boolean))
    ) as string[]

    const mondayApiToken = process.env.MONDAY_API_TOKEN
    if (!mondayApiToken) {
      return { error: 'Flexi-Design configuration unavailable (Missing MONDAY_API_TOKEN)' }
    }

    let flexiDesignBoardIds = new Set<string>()
    if (allMappedBoardIds.length > 0) {
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
        body: JSON.stringify({ query, variables: { boardIds: allMappedBoardIds } }),
      })

      if (!response.ok) {
        return { error: 'Flexi-Design configuration unavailable (Unable to query Monday boards)' }
      }

      const result = await response.json()
      if (result.errors) {
        return { error: 'Flexi-Design configuration unavailable (Monday API error)' }
      }

      result.data?.boards?.forEach((board: { id: string; name: string }) => {
        if (board.name?.toLowerCase?.().includes('flexi')) {
          flexiDesignBoardIds.add(String(board.id))
        }
      })
    }

    const { data: completedBoardRow, error: completedBoardError } = await adminClient
      .from('flexi_design_completed_board')
      .select('monday_board_id')
      .maybeSingle()

    if (completedBoardError) throw completedBoardError
    const completedBoardId = completedBoardRow?.monday_board_id || null
    
    // Get client from database
    let clientData: any = null
    const { data, error: clientError } = await adminClient
      .from('flexi_design_clients')
      .select('*')
      .eq('client_name', clientName)
      .maybeSingle()

    if (clientError && !clientError.message.includes('does not exist')) {
      throw clientError
    }

    clientData = data

    if (flexiDesignBoardIds.size === 0) {
      return { error: 'No Flexi-Design boards configured' }
    }

    // Filter out completed board from active board IDs
    const activeBoardIds = Array.from(flexiDesignBoardIds).filter(
      (boardId) => !completedBoardId || boardId !== completedBoardId
    )

    // Get all active projects for this client, scoped to Flexi-Design boards only.
    let projectsQuery = adminClient
      .from('monday_projects')
      .select('id, name, status, created_at, quoted_hours')
      .eq('client_name', clientName)
      .in('status', ['active', 'archived', 'locked'])
      .order('created_at', { ascending: false })

    if (activeBoardIds.length > 0) {
      projectsQuery = projectsQuery.in('monday_board_id', activeBoardIds)
    } else {
      // Only completed board exists; no active boards → return no active projects
      projectsQuery = projectsQuery.in('monday_board_id', ['__none__'])
    }

    const { data: projects, error: projectsError } = await projectsQuery

    if (projectsError) throw projectsError

    // Calculate total quoted hours for active projects
    let totalQuotedHours = 0
    if (projects) {
      projects.forEach((project: any) => {
        const quotedHours = project.quoted_hours ? Number(project.quoted_hours) : 0
        totalQuotedHours += quotedHours
      })
    }

    // Get completed projects from the completed board
    let completedProjects: any[] = []
    let totalCompletedQuotedHours = 0
    
    if (completedBoardId) {
      const { data: completed, error: completedError } = await adminClient
        .from('monday_projects')
        .select('id, name, status, created_at, quoted_hours, completed_date')
        .eq('monday_board_id', completedBoardId)
        .eq('client_name', clientName)
        .in('status', ['active', 'archived', 'locked'])
        .order('completed_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (!completedError && completed) {
        completedProjects = completed
        completed.forEach((project: any) => {
          const quotedHours = project.quoted_hours ? Number(project.quoted_hours) : 0
          totalCompletedQuotedHours += quotedHours
        })
      }
    }

    // Get total deposited from credit transactions
    let totalDeposited = 0
    if (clientData) {
      const { data: transactions } = await adminClient
        .from('flexi_design_credit_transactions')
        .select('hours')
        .eq('client_id', clientData.id)
      
      if (transactions) {
        totalDeposited = transactions.reduce((sum, tx: any) => sum + Number(tx.hours), 0)
      }
    }

    // Calculate remaining hours: total deposited - total quoted hours (active + completed)
    const totalEstimatedHours = totalQuotedHours + totalCompletedQuotedHours
    const remainingHours = totalDeposited - totalEstimatedHours

    // Calculate average hours per month
    // Use the first transaction date or first project date as start date
    let startDate: Date | null = null
    if (clientData) {
      const { data: firstTransaction } = await adminClient
        .from('flexi_design_credit_transactions')
        .select('transaction_date')
        .eq('client_id', clientData.id)
        .order('transaction_date', { ascending: true })
        .limit(1)
        .maybeSingle()
      
      if (firstTransaction?.transaction_date) {
        startDate = new Date(firstTransaction.transaction_date)
      }
    }
    
    // Fallback to first project date if no transactions
    if (!startDate && projects && projects.length > 0) {
      const firstProject = projects[projects.length - 1] // oldest project
      startDate = new Date(firstProject.created_at)
    }

    let avgHoursPerMonth = 0
    if (startDate && totalDeposited > 0) {
      const monthsSinceStart = Math.max(1, Math.ceil((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)))
      avgHoursPerMonth = totalDeposited / monthsSinceStart
    }

    return {
      success: true,
      client: {
        id: clientData?.id || '',
        client_name: clientName,
        remaining_hours: remainingHours,
        total_hours_used: totalEstimatedHours, // total quoted hours used (for credits)
        completed_projects_count: completedProjects.length,
        active_projects_count: projects?.length || 0,
        avg_hours_per_month: avgHoursPerMonth,
      },
      activeProjects: (projects || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        quoted_hours: p.quoted_hours ? Number(p.quoted_hours) : null,
        created_at: p.created_at,
      })),
      completedProjects: completedProjects.map((p: any) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        quoted_hours: p.quoted_hours ? Number(p.quoted_hours) : null,
        created_at: p.created_at,
        completed_date: p.completed_date,
      })),
    }
  } catch (error) {
    console.error('Error fetching Flexi-Design client data:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch client data' }
  }
}
