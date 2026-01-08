'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { format, startOfWeek, endOfWeek, eachWeekOfInterval, startOfQuarter, endOfQuarter, startOfYear, subWeeks } from 'date-fns'
import { getTimeEntries } from './time-tracking'
import { getLeads } from './leads'
import { fetchXeroFinancialData } from '@/lib/xero/api'

export interface ScorecardCategory {
  id: string
  name: string
  display_order: number
}

export interface ScorecardMetric {
  id: string
  category_id: string
  name: string
  description: string | null
  unit: string | null
  target_value: number | null
  is_automated: boolean
  automation_source: string | null
  automation_config: any
  display_order: number
}

export interface ScorecardEntry {
  id: string
  metric_id: string
  week_start_date: string
  value: number
  target_value: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

/**
 * Get all scorecard categories
 */
export async function getScorecardCategories() {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('scorecard_categories')
      .select('*')
      .order('display_order', { ascending: true })

    if (error) throw error

    return { success: true, categories: data || [] }
  } catch (error) {
    console.error('Error fetching scorecard categories:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch categories' }
  }
}

/**
 * Get all metrics for a category
 */
export async function getScorecardMetrics(categoryId?: string) {
  const supabase = await createClient()

  try {
    let query = supabase
      .from('scorecard_metrics')
      .select('*')
      .order('display_order', { ascending: true })

    if (categoryId) {
      query = query.eq('category_id', categoryId)
    }

    const { data, error } = await query

    if (error) throw error

    return { success: true, metrics: data || [] }
  } catch (error) {
    console.error('Error fetching scorecard metrics:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch metrics' }
  }
}

/**
 * Get scorecard entries for a specific week
 */
export async function getScorecardEntries(weekStartDate: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('scorecard_entries')
      .select(`
        *,
        metric:scorecard_metrics(*)
      `)
      .eq('week_start_date', weekStartDate)
      .order('metric:display_order', { ascending: true })

    if (error) throw error

    return { success: true, entries: data || [] }
  } catch (error) {
    console.error('Error fetching scorecard entries:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch entries' }
  }
}

/**
 * Calculate automated metric value
 */
async function calculateAutomatedMetric(
  metric: ScorecardMetric,
  weekStart: Date,
  weekEnd: Date
): Promise<number | null> {
  const weekStartStr = format(weekStart, 'yyyy-MM-dd')
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd')

  try {
    switch (metric.automation_source) {
      case 'time_tracking':
        // Calculate billable hours for the week
        const timeEntries = await getTimeEntries(weekStartStr, weekEndStr)
        if (timeEntries.error) return null
        const totalHours = (timeEntries.entries || []).reduce((sum, entry) => {
          return sum + (entry.hours || 0)
        }, 0)
        return totalHours

      case 'leads':
        // Count leads based on automation_config
        const leadsResult = await getLeads()
        if (leadsResult.error || !leadsResult.leads) return null
        
        const leads = leadsResult.leads.filter((lead: any) => {
          if (!lead.created_at) return false
          const createdDate = new Date(lead.created_at)
          return createdDate >= weekStart && createdDate <= weekEnd
        })

        const leadType = metric.automation_config?.type || 'all'
        if (leadType === 'new_connections') {
          // New lead connections made - count new leads created this week
          return leads.length
        } else if (leadType === 'intro_calls') {
          // Intro calls completed - would need to check lead status or a custom field
          // For now, count leads with a status that suggests a call happened
          return leads.filter((l: any) => l.status && !['new', 'stuck', 'blocked'].includes(l.status.toLowerCase())).length
        } else if (leadType === 'quotes_submitted') {
          // Quotes/proposals submitted - count leads with quote_value
          return leads.filter((l: any) => l.quote_value && l.quote_value > 0).length
        } else if (leadType === 'inbound') {
          // Inbound leads - would need a field to distinguish inbound vs outbound
          // For now, return all leads
          return leads.length
        }
        return leads.length

      case 'xero':
        // Financial metrics from Xero
        const financialType = metric.automation_config?.type || 'revenue'
        
        if (financialType === 'quarterly_target_billed') {
          // % of Quarterly Target Billed
          const quarterStart = startOfQuarter(weekStart)
          const quarterEnd = endOfQuarter(weekStart)
          const target = metric.target_value || 130000 // Default £130k
          
          const financialData = await fetchXeroFinancialData(
            format(quarterStart, 'yyyy-MM-dd'),
            format(quarterEnd, 'yyyy-MM-dd')
          )
          
          if (financialData.error || !financialData.revenue) return null
          return (financialData.revenue / target) * 100
        } else if (financialType === 'profit_percentage') {
          // % Profit for Quarter to Date
          const quarterStart = startOfQuarter(weekStart)
          const quarterEnd = weekEnd // Up to current week
          
          const financialData = await fetchXeroFinancialData(
            format(quarterStart, 'yyyy-MM-dd'),
            format(quarterEnd, 'yyyy-MM-dd')
          )
          
          if (financialData.error || !financialData.revenue || financialData.revenue === 0) return null
          const profit = financialData.revenue - (financialData.expenses || 0)
          return (profit / financialData.revenue) * 100
        } else if (financialType === 'pipeline_value') {
          // 3 months pipeline value - sum of quote values from leads
          const pipelineEnd = new Date(weekStart)
          pipelineEnd.setMonth(pipelineEnd.getMonth() + 3)
          
          const leadsResult = await getLeads()
          if (leadsResult.error || !leadsResult.leads) return null
          
          const pipelineLeads = leadsResult.leads.filter((lead: any) => {
            const dueDate = lead.due_date ? new Date(lead.due_date) : null
            return dueDate && dueDate <= pipelineEnd && lead.quote_value
          })
          
          return pipelineLeads.reduce((sum: number, lead: any) => {
            return sum + (lead.quote_value || 0)
          }, 0)
        }
        return null

      case 'capacity':
        // Capacity for next 4 weeks
        // This would need more complex logic to calculate available capacity
        // For now, return placeholder
        return null

      default:
        return null
    }
  } catch (error) {
    console.error(`Error calculating automated metric ${metric.name}:`, error)
    return null
  }
}

/**
 * Sync scorecard entries for a specific week (calculate and save automated metrics)
 */
export async function syncScorecardWeek(weekStartDate: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  
  // Use admin client for sync operations (allows service-to-service calls)
  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin API not available' }
  }

  try {
    // Get all automated metrics
    const metricsResult = await getScorecardMetrics()
    if (metricsResult.error || !metricsResult.success) {
      return { error: metricsResult.error || 'Failed to fetch metrics' }
    }

    const automatedMetrics = (metricsResult.metrics || []).filter(m => m.is_automated)
    const weekStart = new Date(weekStartDate)
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

    let synced = 0
    let errors: string[] = []

    for (const metric of automatedMetrics) {
      try {
        // Calculate the automated value
        const calculatedValue = await calculateAutomatedMetric(metric, weekStart, weekEnd)
        
        if (calculatedValue === null) {
          // Skip if calculation returned null (no data available)
          continue
        }

        // Check if entry already exists
        const { data: existingEntry } = await adminClient
          .from('scorecard_entries')
          .select('id')
          .eq('metric_id', metric.id)
          .eq('week_start_date', weekStartDate)
          .maybeSingle()

        if (existingEntry) {
          // Update existing entry (only update value, preserve target and notes if manually set)
          const { error: updateError } = await adminClient
            .from('scorecard_entries')
            .update({
              value: calculatedValue,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingEntry.id)

          if (updateError) {
            errors.push(`Failed to update ${metric.name}: ${updateError.message}`)
          } else {
            synced++
          }
        } else {
          // Create new entry
          const { error: insertError } = await adminClient
            .from('scorecard_entries')
            .insert({
              metric_id: metric.id,
              week_start_date: weekStartDate,
              value: calculatedValue,
              target_value: metric.target_value,
              created_by: user?.id || null,
            })

          if (insertError) {
            errors.push(`Failed to create ${metric.name}: ${insertError.message}`)
          } else {
            synced++
          }
        }
      } catch (error) {
        errors.push(`Error syncing ${metric.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    return {
      success: true,
      synced,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (error) {
    console.error('Error syncing scorecard week:', error)
    return { error: error instanceof Error ? error.message : 'Failed to sync week' }
  }
}

/**
 * Sync scorecard entries for the last N weeks (typically called on Sundays)
 */
export async function syncScorecardRecentWeeks(numWeeks: number = 3) {
  const today = new Date()
  const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 })
  
  const weeksToSync: string[] = []
  for (let i = 0; i < numWeeks; i++) {
    const weekDate = subWeeks(currentWeekStart, i)
    weeksToSync.push(format(startOfWeek(weekDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
  }

  const results = await Promise.all(
    weeksToSync.map(weekStart => syncScorecardWeek(weekStart))
  )

  const totalSynced = results.reduce((sum, r) => sum + (r.synced || 0), 0)
  const allErrors = results.flatMap(r => r.errors || [])

  return {
    success: true,
    weeksSynced: weeksToSync.length,
    totalEntriesSynced: totalSynced,
    errors: allErrors.length > 0 ? allErrors : undefined,
  }
}

/**
 * Get scorecard entries for multiple weeks (optimized batch query)
 */
export async function getScorecardEntriesForWeeks(weekStartDates: string[]) {
  const supabase = await createClient()

  try {
    if (!weekStartDates || weekStartDates.length === 0) {
      return { error: 'No week dates provided' }
    }

    // Get all metrics
    const metricsResult = await getScorecardMetrics()
    if (metricsResult.error || !metricsResult.success) {
      console.error('Error fetching metrics:', metricsResult.error)
      return { error: `Failed to fetch metrics: ${metricsResult.error || 'Unknown error'}` }
    }

    const metrics = metricsResult.metrics || []

    if (metrics.length === 0) {
      console.warn('No metrics found - will still create placeholder entries')
    }

    // Fetch all entries for these weeks in a single query
    let entriesData: any[] = []
    let entriesError: any = null

    try {
      const queryResult = await supabase
        .from('scorecard_entries')
        .select(`
          *,
          metric:scorecard_metrics(*)
        `)
        .in('week_start_date', weekStartDates)
      
      entriesData = queryResult.data || []
      entriesError = queryResult.error

      if (entriesError) {
        console.error('Supabase query error:', entriesError)
        console.error('Week dates being queried:', weekStartDates)
        console.error('Error code:', entriesError.code)
        console.error('Error details:', entriesError.details)
        console.error('Error hint:', entriesError.hint)
        throw new Error(`Database query failed: ${entriesError.message || JSON.stringify(entriesError)}`)
      }

      // Sort entries by metric display_order manually since we can't use order() with joins easily
      if (entriesData.length > 0 && entriesData[0].metric) {
        entriesData.sort((a, b) => {
          const orderA = a.metric?.display_order || 999
          const orderB = b.metric?.display_order || 999
          return orderA - orderB
        })
      }
    } catch (queryErr) {
      console.error('Error executing Supabase query:', queryErr)
      throw queryErr
    }

    const entriesByWeek = new Map<string, any[]>()

    // Initialize map with empty arrays for each week
    weekStartDates.forEach(date => {
      entriesByWeek.set(date, [])
    })

    // Group entries by week
    if (entriesData) {
      entriesData.forEach((entry: any) => {
        const week = entry.week_start_date
        if (entriesByWeek.has(week)) {
          entriesByWeek.get(week)!.push(entry)
        }
      })
    }

    // For each week, ensure all metrics have entries (create placeholders if missing)
    const result: Record<string, any[]> = {}
    for (const weekStartDate of weekStartDates) {
      const existingEntries = entriesByWeek.get(weekStartDate) || []
      const entries: any[] = []

      for (const metric of metrics) {
        let entry = existingEntries.find((e: any) => e.metric_id === metric.id)

        // If no entry exists, create a placeholder (don't calculate on page load)
        if (!entry) {
          entry = {
            id: '',
            metric_id: metric.id,
            week_start_date: weekStartDate,
            value: 0,
            target_value: metric.target_value,
            notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metric: metric,
          }
        } else if (!entry.metric) {
          // Ensure metric is attached
          entry.metric = metric
        }

        entries.push(entry)
      }

      result[weekStartDate] = entries
    }

    return { success: true, entriesByWeek: result }
  } catch (error) {
    console.error('Error getting scorecard entries:', error)
    const errorMessage = error instanceof Error 
      ? error.message 
      : typeof error === 'string'
      ? error
      : JSON.stringify(error)
    console.error('Full error details:', error)
    return { error: `Failed to get entries: ${errorMessage}` }
  }
}

/**
 * Get or create scorecard entries for a week, calculating automated values
 * NOTE: This is now only used for single-week operations. For batch loading,
 * use getScorecardEntriesForWeeks instead.
 */
export async function getOrCreateScorecardEntries(weekStartDate: string) {
  const result = await getScorecardEntriesForWeeks([weekStartDate])
  
  if (result.error || !result.success) {
    return { error: result.error || 'Failed to get entries' }
  }

  return {
    success: true,
    entries: result.entriesByWeek?.[weekStartDate] || [],
  }
}

/**
 * Update a scorecard entry
 */
export async function updateScorecardEntry(
  entryId: string,
  value: number,
  targetValue: number | null,
  notes: string | null
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('scorecard_entries')
      .update({
        value,
        target_value: targetValue,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)
      .select()
      .single()

    if (error) throw error

    return { success: true, entry: data }
  } catch (error) {
    console.error('Error updating scorecard entry:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update entry' }
  }
}

/**
 * Create a new scorecard entry
 */
export async function createScorecardEntry(
  metricId: string,
  weekStartDate: string,
  value: number,
  targetValue: number | null,
  notes: string | null
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('scorecard_entries')
      .insert({
        metric_id: metricId,
        week_start_date: weekStartDate,
        value,
        target_value: targetValue,
        notes,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, entry: data }
  } catch (error) {
    console.error('Error creating scorecard entry:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create entry' }
  }
}
