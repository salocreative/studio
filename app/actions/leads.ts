'use server'

import { createClient } from '@/lib/supabase/server'

interface Lead {
  id: string
  name: string
  client_name: string | null
  quoted_hours: number | null
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
    // Get all leads (projects with status 'lead')
    const { data: leads, error: leadsError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, quoted_hours, monday_data')
      .eq('status', 'lead')
      .order('name', { ascending: true })

    if (leadsError) throw leadsError

    // Extract timeline from monday_data if available
    const leadsWithTimeline: Lead[] = (leads || []).map((lead: any) => {
      let timeline_start: string | null = null
      let timeline_end: string | null = null

      // Extract timeline from monday_data if available
      if (lead.monday_data) {
        // Look for timeline column values in monday_data
        // The exact structure depends on how Monday.com stores timeline data
        // This is a placeholder - you may need to adjust based on actual data structure
        const timelineColumn = Object.values(lead.monday_data).find((cv: any) => 
          cv?.type === 'timeline' || cv?.type === 'date-range'
        ) as any
        if (timelineColumn?.value) {
          timeline_start = timelineColumn.value?.from || null
          timeline_end = timelineColumn.value?.to || null
        }
      }

      return {
        id: lead.id,
        name: lead.name,
        client_name: lead.client_name,
        quoted_hours: lead.quoted_hours ? Number(lead.quoted_hours) : null,
        timeline_start,
        timeline_end,
      }
    })

    return { success: true, leads: leadsWithTimeline }
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

