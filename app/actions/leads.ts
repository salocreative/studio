'use server'

import { createClient } from '@/lib/supabase/server'
import {
  extractLikelihoodFromMondayData,
  extractMondayStatusFromMondayData,
} from '@/lib/monday/column-extract'
import { findMappingColumnId } from '@/lib/monday/mapping-resolver'

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
  likelihood: number | null
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
    const { data: allMappings } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, board_id, column_type')
      .in('column_type', ['quote_value', 'due_date', 'status', 'likelihood'])

    const { data: leadsBoard } = await supabase
      .from('monday_leads_board')
      .select('monday_board_id')
      .maybeSingle()

    const leadsBoardId = leadsBoard?.monday_board_id || null

    const quoteValueColumnId = findMappingColumnId(allMappings, 'quote_value', leadsBoardId)
    const dueDateColumnId = findMappingColumnId(allMappings, 'due_date', leadsBoardId)
    const statusColumnId = findMappingColumnId(allMappings, 'status', leadsBoardId)
    const likelihoodColumnId = findMappingColumnId(allMappings, 'likelihood', leadsBoardId)

    const { data: leads, error: leadsError } = await supabase
      .from('monday_projects')
      .select(
        'id, name, client_name, quoted_hours, quote_value, due_date, monday_status, likelihood, monday_data, monday_board_id'
      )
      .eq('status', 'lead')
      .order('name', { ascending: true })

    if (leadsError) throw leadsError

    const { getLeadsStatusConfig } = await import('./leads-status-config')
    const statusConfig = await getLeadsStatusConfig()
    const includedStatuses = statusConfig.success ? statusConfig.includedStatuses : []
    const excludedStatuses = statusConfig.success ? statusConfig.excludedStatuses : []

    const leadsWithData: Lead[] = (leads || [])
      .map((lead) => {
        let timeline_start: string | null = null
        let timeline_end: string | null = null
        let quote_value: number | null = null
        let due_date: string | null = lead.due_date || null
        let status: string | null = lead.monday_status ?? null
        let likelihood: number | null =
          lead.likelihood != null ? Number(lead.likelihood) : null

        if (lead.quote_value !== null && lead.quote_value !== undefined) {
          const parsedValue =
            typeof lead.quote_value === 'number'
              ? lead.quote_value
              : parseFloat(String(lead.quote_value))

          if (!isNaN(parsedValue)) {
            quote_value = parsedValue
          }
        }

        const mondayData = lead.monday_data as Record<
          string,
          { text?: string; value?: unknown; type?: string }
        > | null

        if (mondayData) {
          const timelineColumn = Object.values(mondayData).find(
            (cv) => cv?.type === 'timeline' || cv?.type === 'date-range'
          )
          if (timelineColumn?.value && typeof timelineColumn.value === 'object') {
            const tv = timelineColumn.value as { from?: string; to?: string }
            timeline_start = tv.from || null
            timeline_end = tv.to || null
          }

          if (!due_date && dueDateColumnId && mondayData[dueDateColumnId]) {
            const dateColumn = mondayData[dueDateColumnId]
            if (typeof dateColumn.value === 'object' && dateColumn.value !== null) {
              const dv = dateColumn.value as { date?: string }
              due_date = dv.date || null
            } else if (dateColumn.text) {
              due_date = dateColumn.text
            }
          }

          if (!status) {
            status = extractMondayStatusFromMondayData(mondayData, statusColumnId)
          }

          if (likelihood == null) {
            likelihood = extractLikelihoodFromMondayData(mondayData, likelihoodColumnId)
          }

          if (!quote_value && quoteValueColumnId && mondayData[quoteValueColumnId]) {
            const valueColumn = mondayData[quoteValueColumnId]
            if (valueColumn.value !== null && valueColumn.value !== undefined) {
              const numValue =
                typeof valueColumn.value === 'number'
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
          likelihood,
        }
      })
      .filter((lead: Lead) => {
        if (!lead.status) return true

        if (includedStatuses.length > 0) {
          return includedStatuses.includes(lead.status)
        }

        if (excludedStatuses.length > 0) {
          return !excludedStatuses.includes(lead.status)
        }

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
export async function getLeadsCapacity(startDate: string, endDate: string) {
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
