'use server'

import { createClient } from '@/lib/supabase/server'
import { startOfMonth, format, subMonths } from 'date-fns'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'
import { getFlexiDesignCompletedBoard } from './flexi-design-completed-board'

interface MonthlySummaryData {
  month: string // YYYY-MM
  totalValue: number
  totalQuotedHours: number
  projectCount: number
  clientBreakdown: Array<{
    clientName: string
    value: number
  }>
}

/**
 * Get monthly summary data for completed projects
 * Returns aggregated data: total value, quoted hours, project count per month
 */
export async function getMonthlySummary(
  numberOfMonths: number = 12
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if user is admin, designer, or manager
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userProfile || (userProfile.role !== 'admin' && userProfile.role !== 'designer' && userProfile.role !== 'manager')) {
    return { error: 'Unauthorized: Admin, Designer, or Manager access required' }
  }

  try {
    // Get quote_value column mapping
    const { data: quoteValueMappings } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, board_id')
      .eq('column_type', 'quote_value')

    // Find quote_value column ID (try to use any mapping as fallback)
    let quoteValueColumnId: string | null = null
    if (quoteValueMappings && quoteValueMappings.length > 0) {
      const globalMapping = quoteValueMappings.find(m => !m.board_id)
      quoteValueColumnId = globalMapping?.monday_column_id || quoteValueMappings[0].monday_column_id
    }

    // Get Flexi-Design board IDs to exclude
    const flexiDesignBoardIds = await getFlexiDesignBoardIds()
    
    // Also get Flexi-Design completed board ID to exclude
    let flexiDesignCompletedBoardId: string | null = null
    const completedBoardResult = await getFlexiDesignCompletedBoard()
    if (completedBoardResult.success && completedBoardResult.board) {
      flexiDesignCompletedBoardId = completedBoardResult.board.monday_board_id
    }
    
    // Build set of board IDs to exclude
    const boardIdsToExclude = new Set(Array.from(flexiDesignBoardIds))
    if (flexiDesignCompletedBoardId) {
      boardIdsToExclude.add(flexiDesignCompletedBoardId)
    }

    // Calculate date range
    const endDate = new Date()
    const startDate = subMonths(endDate, numberOfMonths - 1)
    const startDateStr = format(startOfMonth(startDate), 'yyyy-MM-dd')

    // Get all completed projects (status = 'locked')
    const { data: allCompletedProjects, error: projectsError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, quoted_hours, completed_date, quote_value, monday_data, monday_board_id')
      .eq('status', 'locked')
      .order('completed_date', { ascending: false, nullsFirst: false })

    if (projectsError) throw projectsError

    // Filter out Flexi-Design projects
    const filteredProjects = boardIdsToExclude.size > 0
      ? (allCompletedProjects || []).filter(
          (project: any) => !boardIdsToExclude.has(project.monday_board_id)
        )
      : (allCompletedProjects || [])

    // Group by month
    const monthlyData: Record<string, {
      totalValue: number
      totalQuotedHours: number
      projectCount: number
      clientBreakdown: Record<string, number> // clientName -> total value
    }> = {}

    if (filteredProjects && filteredProjects.length > 0) {
      filteredProjects.forEach((project: any) => {
        // Skip projects without completed_date
        if (!project.completed_date) return

        // Extract quote_value
        let projectValue: number | null = null

        // First, try the direct quote_value column
        if (project.quote_value !== null && project.quote_value !== undefined) {
          const parsedValue = typeof project.quote_value === 'number' 
            ? project.quote_value 
            : parseFloat(String(project.quote_value))
          
          if (!isNaN(parsedValue)) {
            projectValue = parsedValue
          }
        }

        // Fallback to extracting from monday_data
        if (!projectValue && project.monday_data && quoteValueColumnId && project.monday_data[quoteValueColumnId]) {
          const valueColumn = project.monday_data[quoteValueColumnId]
          if (valueColumn.value !== null && valueColumn.value !== undefined) {
            const numValue = typeof valueColumn.value === 'number' 
              ? valueColumn.value 
              : typeof valueColumn.value === 'string' 
                ? parseFloat(valueColumn.value) 
                : parseFloat(String(valueColumn.value))
            
            if (!isNaN(numValue)) {
              projectValue = numValue
            }
          } else if (valueColumn.text) {
            const numValue = parseFloat(valueColumn.text.replace(/[£,$,\s]/g, ''))
            if (!isNaN(numValue)) {
              projectValue = numValue
            }
          }
        }

        // Skip projects without quote_value
        if (!projectValue || isNaN(projectValue)) {
          return
        }

        const dateForGrouping = new Date(project.completed_date)
        const dateStr = format(dateForGrouping, 'yyyy-MM-dd')
        
        // Only include projects within the date range
        if (dateStr < startDateStr || dateForGrouping > endDate) return

        const monthKey = format(startOfMonth(dateForGrouping), 'yyyy-MM')
        const clientName = project.client_name || 'Unknown'

        // Initialize month if not exists
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = {
            totalValue: 0,
            totalQuotedHours: 0,
            projectCount: 0,
            clientBreakdown: {},
          }
        }

        // Add to monthly totals
        monthlyData[monthKey].totalValue += projectValue
        monthlyData[monthKey].totalQuotedHours += (project.quoted_hours || 0)
        monthlyData[monthKey].projectCount += 1

        // Add to client breakdown
        if (!monthlyData[monthKey].clientBreakdown[clientName]) {
          monthlyData[monthKey].clientBreakdown[clientName] = 0
        }
        monthlyData[monthKey].clientBreakdown[clientName] += projectValue
      })
    }

    // Generate list of months to display
    const months: string[] = []
    for (let i = 0; i < numberOfMonths; i++) {
      const monthDate = subMonths(endDate, numberOfMonths - 1 - i)
      months.push(format(startOfMonth(monthDate), 'yyyy-MM'))
    }

    // Convert to array format with sorted client breakdown
    const summaryArray: MonthlySummaryData[] = months.map((month) => {
      const data = monthlyData[month] || {
        totalValue: 0,
        totalQuotedHours: 0,
        projectCount: 0,
        clientBreakdown: {},
      }

      // Convert client breakdown to array and sort by value (descending)
      const clientBreakdown = Object.entries(data.clientBreakdown)
        .map(([clientName, value]) => ({
          clientName,
          value: Number(value.toFixed(2)),
        }))
        .sort((a, b) => b.value - a.value)

      return {
        month,
        totalValue: Number(data.totalValue.toFixed(2)),
        totalQuotedHours: Number(data.totalQuotedHours.toFixed(1)),
        projectCount: data.projectCount,
        clientBreakdown,
      }
    })

    return {
      success: true,
      months: summaryArray,
    }
  } catch (error) {
    console.error('Error fetching monthly summary data:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch monthly summary data' }
  }
}

