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
    // Get quote_value column mapping for leads board
    const { data: quoteValueMappings } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, board_id')
      .eq('column_type', 'quote_value')

    // Get leads board ID
    const { data: leadsBoard } = await supabase
      .from('monday_leads_board')
      .select('monday_board_id')
      .maybeSingle()

    const leadsBoardId = leadsBoard?.monday_board_id || null

    // Find the quote_value column ID to look for in monday_data
    let quoteValueColumnId: string | null = null
    if (quoteValueMappings && leadsBoardId) {
      // Try board-specific mapping first
      const boardMapping = quoteValueMappings.find(m => m.board_id === leadsBoardId)
      if (boardMapping) {
        quoteValueColumnId = boardMapping.monday_column_id
      } else {
        // Try global mapping (board_id is null)
        const globalMapping = quoteValueMappings.find(m => !m.board_id)
        if (globalMapping) {
          quoteValueColumnId = globalMapping.monday_column_id
        } else if (quoteValueMappings.length > 0) {
          // Fallback to any mapping
          quoteValueColumnId = quoteValueMappings[0].monday_column_id
        }
      }
    }

    // Get all leads (projects with status 'lead')
    const { data: leads, error: leadsError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, quoted_hours, quote_value, monday_data, monday_board_id')
      .eq('status', 'lead')
      .order('name', { ascending: true })

    if (leadsError) throw leadsError

    // Extract timeline and quote_value from monday_data if available
    const leadsWithData: Lead[] = (leads || []).map((lead: any) => {
      let timeline_start: string | null = null
      let timeline_end: string | null = null
      let quote_value: number | null = null

      // Use quote_value from database column if available, otherwise extract from monday_data
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

        // Fallback: Extract quote_value from monday_data if column is not set (backward compatibility)
        if (!quote_value && quoteValueColumnId && lead.monday_data[quoteValueColumnId]) {
          const valueColumn = lead.monday_data[quoteValueColumnId]
          // Monday.com number columns store value in different formats
          // Try to extract the numeric value
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
            // Fallback to text value
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
      }
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

