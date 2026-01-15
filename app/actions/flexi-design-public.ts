'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'
import { getFlexiDesignCompletedBoard } from './flexi-design-completed-board'

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
    // Get Flexi-Design board IDs
    const flexiDesignBoardIds = await getFlexiDesignBoardIds()
    
    // Get Flexi-Design completed board ID
    const completedBoardResult = await getFlexiDesignCompletedBoard()
    const completedBoardId = completedBoardResult.success && completedBoardResult.board 
      ? completedBoardResult.board.monday_board_id 
      : null
    
    if (flexiDesignBoardIds.size === 0) {
      return { error: 'No Flexi-Design boards configured' }
    }

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

    // Filter out completed board from active board IDs
    const activeBoardIds = Array.from(flexiDesignBoardIds).filter(
      boardId => !completedBoardId || boardId !== completedBoardId
    )

    // Get all active projects for this client
    const { data: projects, error: projectsError } = await adminClient
      .from('monday_projects')
      .select('id, name, status, created_at, quoted_hours')
      .in('monday_board_id', activeBoardIds)
      .eq('client_name', clientName)
      .in('status', ['active', 'archived', 'locked'])
      .order('created_at', { ascending: false })

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
