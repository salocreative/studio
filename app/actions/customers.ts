'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { format, startOfYear } from 'date-fns'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'
import { getFlexiDesignCompletedBoard } from './flexi-design-completed-board'

export interface Customer {
  client_name: string
  agency: string | null
  lifetime_value: number
  relationship_score: number | null
  project_count: number
}

export interface LifetimeValueBrackets {
  low: { min: number; max: number | null }
  medium: { min: number; max: number | null }
  high: { min: number; max: number | null }
}

/**
 * Get all customers with lifetime value and relationship scores
 * @param startDate - Start date for filtering projects
 * @param endDate - End date for filtering projects
 * @param groupBy - Whether to group by 'client' or 'agency' (default: 'client')
 */
export async function getCustomersWithAnalysis(
  startDate?: string,
  endDate?: string,
  groupBy: 'client' | 'agency' = 'client'
): Promise<{ error?: string; customers?: Customer[] }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Use admin client to bypass RLS for reading all data
  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin API not available. Please configure SUPABASE_SERVICE_ROLE_KEY.' }
  }

  try {
    // Default to year-to-date if no dates provided
    const today = new Date()
    const periodStart = startDate ? new Date(startDate) : startOfYear(today)
    const periodEnd = endDate ? new Date(endDate) : today
    const startDateStr = format(periodStart, 'yyyy-MM-dd')
    const endDateStr = format(periodEnd, 'yyyy-MM-dd')

    // Get quote value column mapping
    // Try to get it from main board type first, but also check for global mappings
    const { data: quoteValueMapping } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, board_id')
      .eq('column_type', 'quote_value')
      .or('board_type.eq.main,board_type.is.null')
      .order('board_id', { ascending: true, nullsFirst: false }) // Prefer board-specific, fallback to global
      .maybeSingle()

    // If no board-specific mapping, try to get any quote_value mapping
    let quoteValueColumnId = quoteValueMapping?.monday_column_id || null
    
    if (!quoteValueColumnId) {
      const { data: anyMapping } = await supabase
        .from('monday_column_mappings')
        .select('monday_column_id')
        .eq('column_type', 'quote_value')
        .maybeSingle()
      
      quoteValueColumnId = anyMapping?.monday_column_id || null
    }

    // Get Flexi-Design board IDs to identify Flexi-Design projects
    const flexiDesignBoardIds = await getFlexiDesignBoardIds()
    
    // Get quote rates for converting Flexi-Design hours to value
    const { data: quoteRates } = await supabase
      .from('quote_rates')
      .select('customer_type, day_rate_gbp, hours_per_day')
    
    const clientRate = quoteRates?.find(r => r.customer_type === 'client')
    const hourlyRate = clientRate ? clientRate.day_rate_gbp / (clientRate.hours_per_day || 6) : 120 // Default to £120/hour

    // Get ALL projects (including completed boards) for lifetime value calculation
    // Include both active and locked (completed) projects
    // Note: Flexi-Design projects don't have agency, so they'll always be grouped by client
    const { data: projects, error: projectsError } = await adminClient
      .from('monday_projects')
      .select('id, client_name, agency, completed_date, quote_value, monday_data, monday_board_id, created_at, status')
      .in('status', ['active', 'archived', 'locked']) // Include all project statuses

    if (projectsError) throw projectsError

    // Filter out Flexi-Design projects from regular projects
    const regularProjects = (projects || []).filter(
      (p: any) => !flexiDesignBoardIds.has(p.monday_board_id)
    )

    // Get all Flexi-Design projects (all projects, we'll use for lifetime value calculation)
    const flexiDesignProjectIds = Array.from(flexiDesignBoardIds)
    let flexiDesignProjects: any[] = []
    
    if (flexiDesignProjectIds.length > 0) {
      const { data: flexiProjects, error: flexiError } = await adminClient
        .from('monday_projects')
        .select('id, client_name, created_at, completed_date, quoted_hours, monday_board_id, status')
        .in('monday_board_id', flexiDesignProjectIds)
        .not('client_name', 'is', null)
      
      if (flexiError) {
        console.warn('Error fetching Flexi-Design projects:', flexiError)
      } else {
        flexiDesignProjects = flexiProjects || []
      }
    }

    // Get relationship votes and calculate averages
    const { data: relationshipVotes, error: votesError } = await adminClient
      .from('customer_relationship_votes')
      .select('client_name, relationship_score')

    if (votesError) {
      // If table doesn't exist, try old table as fallback
      console.warn('customer_relationship_votes table not found, trying old table:', votesError)
      const { data: oldScores } = await adminClient
        .from('customer_relationship_scores')
        .select('client_name, relationship_score')
      
      if (oldScores) {
        const scoresMap = new Map<string, number>()
        oldScores.forEach((score: any) => {
          scoresMap.set(score.client_name, score.relationship_score)
        })
        // Use old scores for now
      }
    }

    // Calculate average scores per client/agency
    const scoresMap = new Map<string, number>()
    const voteCounts = new Map<string, number>()
    if (relationshipVotes) {
      relationshipVotes.forEach((vote: any) => {
        const currentSum = (scoresMap.get(vote.client_name) || 0) * (voteCounts.get(vote.client_name) || 0)
        const newCount = (voteCounts.get(vote.client_name) || 0) + 1
        const newSum = currentSum + vote.relationship_score
        voteCounts.set(vote.client_name, newCount)
        scoresMap.set(vote.client_name, newSum / newCount)
      })
    }

    // Aggregate lifetime value by client
    const customerMap = new Map<string, { lifetime_value: number; project_count: number }>()

    // Process regular projects (non-Flexi-Design)
    // For lifetime value, include ALL projects (not filtered by date range)
    // The date range is used for filtering which projects contribute to the analysis period
    if (regularProjects && regularProjects.length > 0) {
      regularProjects.forEach((project: any) => {
        if (!project.client_name) return

        // Filter by date range - include projects that fall within the selected period
        const completedDate = project.completed_date ? format(new Date(project.completed_date), 'yyyy-MM-dd') : null
        const createdDate = project.created_at ? format(new Date(project.created_at), 'yyyy-MM-dd') : null
        
        // Include projects if:
        // 1. Completed within or before the end date (for lifetime value, include all historical), OR
        // 2. Created within the date range, OR  
        // 3. Active/archived projects (ongoing work)
        // This gives a more inclusive view while still respecting the date range concept
        const isInDateRange = 
          (completedDate && completedDate <= endDateStr) || // Include all projects completed before/within range
          (createdDate && createdDate >= startDateStr && createdDate <= endDateStr) ||
          (project.status === 'active' || project.status === 'archived') // Include all active/archived

        // For lifetime value, we include all projects regardless of date
        // But we still need to filter by date for the analysis period
        // For now, let's be less restrictive and include all projects with values
        
        // Extract quote_value
        let projectValue: number | null = null

        // First, try the direct quote_value column
        if (project.quote_value !== null && project.quote_value !== undefined) {
          const parsedValue = typeof project.quote_value === 'number' 
            ? project.quote_value 
            : parseFloat(String(project.quote_value))
          
          if (!isNaN(parsedValue) && parsedValue > 0) {
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
            
            if (!isNaN(numValue) && numValue > 0) {
              projectValue = numValue
            }
          } else if (valueColumn.text) {
            const numValue = parseFloat(valueColumn.text.replace(/[£,$,\s]/g, ''))
            if (!isNaN(numValue) && numValue > 0) {
              projectValue = numValue
            }
          }
        }

        // Skip projects without quote_value
        // Log for debugging
        if (!projectValue || isNaN(projectValue) || projectValue <= 0) {
          console.log('Skipping regular project without value:', {
            name: project.name || project.monday_data?.name || 'Unknown',
            client: project.client_name,
            hasQuoteValue: !!project.quote_value,
            quoteValue: project.quote_value,
            hasMondayData: !!project.monday_data,
            hasColumnId: !!quoteValueColumnId,
            columnId: quoteValueColumnId,
            status: project.status,
            completedDate: project.completed_date,
            createdDate: project.created_at,
            mondayDataKeys: project.monday_data ? Object.keys(project.monday_data) : [],
          })
          return
        }

        console.log('Including regular project:', {
          name: project.name || 'Unknown',
          client: project.client_name,
          value: projectValue,
          status: project.status,
        })

        // Only include if in date range for this analysis
        if (!isInDateRange) return

        // For agency view, exclude projects with "Salo Creative" as agency
        if (groupBy === 'agency') {
          if (!project.agency || project.agency.toLowerCase() === 'salo creative') {
            // Skip projects with no agency or "Salo Creative" agency in agency view
            return
          }
          // Group by agency
          const groupingKey = project.agency
          const existing = customerMap.get(groupingKey) || { lifetime_value: 0, project_count: 0 }
          customerMap.set(groupingKey, {
            lifetime_value: existing.lifetime_value + projectValue,
            project_count: existing.project_count + 1,
          })
          return
        }

        // For client view, group by client (including "Salo Creative" projects)
        const groupingKey = project.client_name || 'Unknown'
        const existing = customerMap.get(groupingKey) || { lifetime_value: 0, project_count: 0 }
        customerMap.set(groupingKey, {
          lifetime_value: existing.lifetime_value + projectValue,
          project_count: existing.project_count + 1,
        })
      })
    }

    // Process Flexi-Design projects (convert quoted_hours to value)
    // Filter by date range - include if created or completed within range, or if active
    if (flexiDesignProjects && flexiDesignProjects.length > 0) {
      flexiDesignProjects.forEach((project: any) => {
        if (!project.client_name) return

        // Filter by date range - include if created or completed within range, or if active
        const createdDate = project.created_at ? format(new Date(project.created_at), 'yyyy-MM-dd') : null
        const completedDate = project.completed_date ? format(new Date(project.completed_date), 'yyyy-MM-dd') : null
        
        const isInDateRange = 
          (createdDate && createdDate >= startDateStr && createdDate <= endDateStr) ||
          (completedDate && completedDate >= startDateStr && completedDate <= endDateStr) ||
          (project.status !== 'locked' && project.quoted_hours) // Active projects

        if (!isInDateRange) return

        // Calculate value from quoted_hours * hourly_rate
        const quotedHours = project.quoted_hours ? Number(project.quoted_hours) : 0
        if (quotedHours > 0) {
          const projectValue = quotedHours * hourlyRate
          
          // For Flexi-Design, we only have client_name, so always group by client
          const clientName = project.client_name || 'Unknown'
          const existing = customerMap.get(clientName) || { lifetime_value: 0, project_count: 0 }
          customerMap.set(clientName, {
            lifetime_value: existing.lifetime_value + projectValue,
            project_count: existing.project_count + 1,
          })
        }
      })
    }

    // Log summary for debugging
    console.log('Customer analysis summary:', {
      totalProjectsFetched: projects?.length || 0,
      regularProjectsCount: regularProjects?.length || 0,
      flexiDesignProjectsCount: flexiDesignProjects?.length || 0,
      customersFound: customerMap.size,
      quoteValueColumnId,
      startDate: startDateStr,
      endDate: endDateStr,
      flexiDesignBoardIdsCount: flexiDesignBoardIds.size,
      customerList: Array.from(customerMap.keys()),
    })

    // Convert map to array
    const customers: Customer[] = Array.from(customerMap.entries()).map(([client_name, data]) => ({
      client_name,
      lifetime_value: data.lifetime_value,
      relationship_score: scoresMap.get(client_name) || null,
      project_count: data.project_count,
    }))

    // Sort by lifetime value descending
    customers.sort((a, b) => b.lifetime_value - a.lifetime_value)

    return { customers }
  } catch (error) {
    console.error('Error fetching customers:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch customers' }
  }
}

/**
 * Get lifetime value brackets configuration
 */
export async function getLifetimeValueBrackets(): Promise<{ error?: string; brackets?: LifetimeValueBrackets }> {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('lifetime_value_brackets')
      .select('bracket_name, min_value, max_value')
      .order('min_value', { ascending: true })

    if (error) {
      // If table doesn't exist, return defaults
      if (error.code === 'PGRST116' || error.message?.includes('does not exist')) {
        return {
          brackets: {
            low: { min: 1, max: 4999.99 },
            medium: { min: 5000, max: 9999.99 },
            high: { min: 10000, max: null },
          },
        }
      }
      throw error
    }

    const brackets: LifetimeValueBrackets = {
      low: { min: 0, max: 0 },
      medium: { min: 0, max: 0 },
      high: { min: 0, max: null },
    }

    data?.forEach((bracket: any) => {
      const name = bracket.bracket_name as 'low' | 'medium' | 'high'
      brackets[name] = {
        min: Number(bracket.min_value),
        max: bracket.max_value !== null ? Number(bracket.max_value) : null,
      }
    })

    return { brackets }
  } catch (error) {
    console.error('Error fetching lifetime value brackets:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch brackets' }
  }
}

/**
 * Update lifetime value brackets (admin only)
 */
export async function updateLifetimeValueBrackets(
  brackets: LifetimeValueBrackets
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role, deleted_at')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin API not available. Please configure SUPABASE_SERVICE_ROLE_KEY.' }
  }

  try {
    // Update each bracket
    for (const [bracketName, bracket] of Object.entries(brackets)) {
      const { error } = await adminClient
        .from('lifetime_value_brackets')
        .update({
          min_value: bracket.min,
          max_value: bracket.max,
        })
        .eq('bracket_name', bracketName)

      if (error) throw error
    }

    return { success: true }
  } catch (error) {
    console.error('Error updating lifetime value brackets:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update brackets' }
  }
}

/**
 * Update customer relationship score (all authenticated users can vote)
 */
export async function updateCustomerRelationshipScore(
  clientName: string,
  relationshipScore: number
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('deleted_at')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (!userProfile) {
    return { error: 'User not found' }
  }

  // Validate score range
  if (relationshipScore < 0 || relationshipScore > 10) {
    return { error: 'Relationship score must be between 0 and 10' }
  }

  try {
    // Use upsert to insert or update user's vote
    const { error } = await supabase
      .from('customer_relationship_votes')
      .upsert({
        client_name: clientName,
        user_id: user.id,
        relationship_score: relationshipScore,
      }, {
        onConflict: 'client_name,user_id',
      })

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error updating relationship score:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update relationship score' }
  }
}

/**
 * Get user's relationship vote for a customer
 */
export async function getUserRelationshipVote(
  clientName: string
): Promise<{ error?: string; score?: number | null }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('customer_relationship_votes')
      .select('relationship_score')
      .eq('client_name', clientName)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      // If table doesn't exist, try old table as fallback
      if (error.code === 'PGRST116' || error.message?.includes('does not exist')) {
        const { data: oldData } = await supabase
          .from('customer_relationship_scores')
          .select('relationship_score')
          .eq('client_name', clientName)
          .maybeSingle()
        return { score: oldData?.relationship_score || null }
      }
      throw error
    }

    return { score: data?.relationship_score || null }
  } catch (error) {
    console.error('Error fetching relationship vote:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch relationship vote' }
  }
}

/**
 * Get all votes for a customer/agency (for leaderboard display)
 */
export async function getCustomerRelationshipVotes(
  clientName: string
): Promise<{ error?: string; votes?: Array<{ user_id: string; user_name: string; relationship_score: number }> }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin API not available' }
  }

  try {
    // First get votes
    const { data: votes, error: votesError } = await adminClient
      .from('customer_relationship_votes')
      .select('user_id, relationship_score')
      .eq('client_name', clientName)

    if (votesError) throw votesError

    if (!votes || votes.length === 0) {
      return { votes: [] }
    }

    // Get user details for all user IDs
    const userIds = votes.map(v => v.user_id)
    const { data: users, error: usersError } = await adminClient
      .from('users')
      .select('id, full_name, email')
      .in('id', userIds)
      .is('deleted_at', null)

    if (usersError) throw usersError

    // Create a map of user_id to user name
    const userMap = new Map()
    users?.forEach((user: any) => {
      userMap.set(user.id, user.full_name || user.email || 'Unknown')
    })

    // Combine votes with user names
    const votesWithNames = votes.map((vote: any) => ({
      user_id: vote.user_id,
      user_name: userMap.get(vote.user_id) || 'Unknown',
      relationship_score: vote.relationship_score,
    }))

    return { votes: votesWithNames }
  } catch (error) {
    console.error('Error fetching relationship votes:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch relationship votes' }
  }
}

/**
 * Get relationship score for a customer
 */
export async function getCustomerRelationshipScore(
  clientName: string
): Promise<{ error?: string; score?: number | null }> {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('customer_relationship_scores')
      .select('relationship_score')
      .eq('client_name', clientName)
      .maybeSingle()

    if (error) {
      // If table doesn't exist, return null
      if (error.code === 'PGRST116' || error.message?.includes('does not exist')) {
        return { score: null }
      }
      throw error
    }

    return { score: data?.relationship_score || null }
  } catch (error) {
    console.error('Error fetching relationship score:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch relationship score' }
  }
}

