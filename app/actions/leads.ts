'use server'

import { createClient } from '@/lib/supabase/server'

interface Lead {
  id: string
  name: string
  client_name: string | null
  quoted_hours: number | null
  quote_value: number | null
  timeline_start: string | null
  timeline_end: string | null
  due_date: string | null
  status: string | null
}

/**
 * Get all leads (projects with status 'lead') for forecasting and capacity planning
 */
export async function getLeads() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Get column mappings for leads board
    const { data: allMappings } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, board_id, column_type')
      .in('column_type', ['quote_value', 'due_date', 'status'])

    // Get leads board ID
    const { data: leadsBoard } = await supabase
      .from('monday_leads_board')
      .select('monday_board_id')
      .maybeSingle()

    const leadsBoardId = leadsBoard?.monday_board_id || null

    // Find column IDs for quote_value, due_date, and status
    const findColumnId = (columnType: string): string | null => {
      const mappings = allMappings?.filter(m => m.column_type === columnType) || []
      if (leadsBoardId) {
        const boardMapping = mappings.find(m => m.board_id === leadsBoardId)
        if (boardMapping) return boardMapping.monday_column_id
        const globalMapping = mappings.find(m => !m.board_id)
        if (globalMapping) return globalMapping.monday_column_id
      }
      return mappings.length > 0 ? mappings[0].monday_column_id : null
    }

    const quoteValueColumnId = findColumnId('quote_value')
    const dueDateColumnId = findColumnId('due_date')
    const statusColumnId = findColumnId('status')

    // Get all leads (projects with status 'lead')
    const { data: leads, error: leadsError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, quoted_hours, quote_value, due_date, monday_data, monday_board_id')
      .eq('status', 'lead')
      .order('name', { ascending: true })

    if (leadsError) throw leadsError

    // Get leads status config to filter by status
    const { getLeadsStatusConfig } = await import('./leads-status-config')
    const statusConfig = await getLeadsStatusConfig()
    const includedStatuses = statusConfig.success ? statusConfig.includedStatuses : []
    const excludedStatuses = statusConfig.success ? statusConfig.excludedStatuses : []

    // Extract data from monday_data
    const leadsWithData: Lead[] = (leads || [])
      .map((lead: any) => {
        let timeline_start: string | null = null
        let timeline_end: string | null = null
        let quote_value: number | null = null
        let due_date: string | null = lead.due_date || null
        let status: string | null = null

        // Use quote_value from database column if available
        if (lead.quote_value !== null && lead.quote_value !== undefined) {
          quote_value = typeof lead.quote_value === 'number' 
            ? lead.quote_value 
            : parseFloat(String(lead.quote_value))
          
          if (isNaN(quote_value)) {
            quote_value = null
          }
        }

        // Extract data from monday_data if available
        if (lead.monday_data) {
          // Extract timeline
          const timelineColumn = Object.values(lead.monday_data).find((cv: any) => 
            cv?.type === 'timeline' || cv?.type === 'date-range'
          ) as any
          if (timelineColumn?.value) {
            timeline_start = timelineColumn.value?.from || null
            timeline_end = timelineColumn.value?.to || null
          }

          // Extract due_date from mapped column
          if (dueDateColumnId && lead.monday_data[dueDateColumnId]) {
            const dateColumn = lead.monday_data[dueDateColumnId]
            if (dateColumn.date) {
              due_date = dateColumn.date
            } else if (dateColumn.value) {
              due_date = dateColumn.value
            }
          }

          // Extract status from mapped column
          if (statusColumnId && lead.monday_data[statusColumnId]) {
            const statusColumn = lead.monday_data[statusColumnId]
            status = statusColumn.text || statusColumn.label || statusColumn.value || null
          }

          // Fallback: Extract quote_value from monday_data if column is not set
          if (!quote_value && quoteValueColumnId && lead.monday_data[quoteValueColumnId]) {
            const valueColumn = lead.monday_data[quoteValueColumnId]
            if (valueColumn.value !== null && valueColumn.value !== undefined) {
              const numValue = typeof valueColumn.value === 'number' 
                ? valueColumn.value 
                : typeof valueColumn.value === 'string' 
                  ? parseFloat(valueColumn.value) 
                  : parseFloat(String(valueColumn.value))
              
              if (!isNaN(numValue)) {
                quote_value = numValue
              }
            } else if (valueColumn.text) {
              const numValue = parseFloat(valueColumn.text.replace(/[£,$,\s]/g, ''))
              if (!isNaN(numValue)) {
                quote_value = numValue
              }
            }
          }
        }

        return {
          id: lead.id,
          name: lead.name,
          client_name: lead.client_name,
          quoted_hours: lead.quoted_hours ? Number(lead.quoted_hours) : null,
          quote_value,
          timeline_start,
          timeline_end,
          due_date,
          status,
        }
      })
      .filter((lead: Lead) => {
        // Filter by status configuration
        if (!lead.status) return true // Include leads without status if config allows

        // If included_statuses is set, only include those statuses
        if (includedStatuses.length > 0) {
          return includedStatuses.includes(lead.status)
        }

        // If excluded_statuses is set, exclude those statuses
        if (excludedStatuses.length > 0) {
          return !excludedStatuses.includes(lead.status)
        }

        // If no config, include all
        return true
      })

    return { success: true, leads: leadsWithData }
  } catch (error) {
    console.error('Error fetching leads:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch leads' }
  }
}

/**
 * Get total quoted hours from leads within a date range
 * Useful for capacity planning
 */
export async function getLeadsCapacity(
  startDate: string,
  endDate: string
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const result = await getLeads()
    if (result.error) {
      return result
    }

    // Filter leads that overlap with the date range
    // For now, we'll include all leads and let the client filter by timeline
    const leads = result.leads || []
    
    const totalQuotedHours = leads.reduce((sum, lead) => {
      return sum + (lead.quoted_hours || 0)
    }, 0)

    return {
      success: true,
      totalQuotedHours,
      leadCount: leads.length,
      leads,
    }
  } catch (error) {
    console.error('Error fetching leads capacity:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch leads capacity' }
  }
}

