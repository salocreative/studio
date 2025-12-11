'use server'

import { createClient } from '@/lib/supabase/server'
import { startOfMonth, format, subMonths, addMonths } from 'date-fns'

interface ClientSpendData {
  clientName: string
  monthlySpend: Record<string, number> // month key (YYYY-MM) -> total spend
  totalSpend: number
}

/**
 * Get client spend data grouped by month from completed projects
 */
export async function getClientSpendByMonth(
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
    // Get quote_value column mapping (similar to leads.ts)
    const { data: quoteValueMappings } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, board_id')
      .eq('column_type', 'quote_value')

    // Find quote_value column ID (try to use any mapping as fallback)
    let quoteValueColumnId: string | null = null
    if (quoteValueMappings && quoteValueMappings.length > 0) {
      // Prefer global mapping, otherwise use first available
      const globalMapping = quoteValueMappings.find(m => !m.board_id)
      quoteValueColumnId = globalMapping?.monday_column_id || quoteValueMappings[0].monday_column_id
    }

    // Calculate date range (from numberOfMonths ago to now)
    const endDate = new Date()
    const startDate = subMonths(endDate, numberOfMonths - 1)
    const startDateStr = format(startOfMonth(startDate), 'yyyy-MM-dd')

    // Get all completed projects (status = 'locked' which means completed/archived)
    // with completed_date within the range
    const { data: completedProjects, error: projectsError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, quoted_hours, completed_date, monday_data')
      .eq('status', 'locked')
      .not('completed_date', 'is', null)
      .gte('completed_date', startDateStr)
      .order('completed_date', { ascending: false })

    if (projectsError) throw projectsError

    // Group by client and month
    const clientData: Record<string, ClientSpendData> = {}

    if (completedProjects) {
      completedProjects.forEach((project: any) => {
        if (!project.completed_date || !project.client_name) return

        const clientName = project.client_name
        const completedDate = new Date(project.completed_date)
        const monthKey = format(completedDate, 'yyyy-MM')

        // Extract quote_value from monday_data if available
        let projectValue: number | null = null

        if (project.monday_data && quoteValueColumnId && project.monday_data[quoteValueColumnId]) {
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

        // Fallback to estimated value if no quote_value
        const estimatedHourlyRate = 75 // Should match forecast page
        const estimatedValue = project.quoted_hours ? Number(project.quoted_hours) * estimatedHourlyRate : 0
        const finalValue = projectValue || estimatedValue

        // Initialize client if not exists
        if (!clientData[clientName]) {
          clientData[clientName] = {
            clientName,
            monthlySpend: {},
            totalSpend: 0,
          }
        }

        // Add to monthly spend
        if (!clientData[clientName].monthlySpend[monthKey]) {
          clientData[clientName].monthlySpend[monthKey] = 0
        }
        clientData[clientName].monthlySpend[monthKey] += finalValue
        clientData[clientName].totalSpend += finalValue
      })
    }

    // Convert to array and sort by total spend (descending)
    const clientSpendArray = Object.values(clientData)
      .map((data) => ({
        ...data,
        totalSpend: Number(data.totalSpend.toFixed(2)),
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend)

    // Generate list of months to display
    const months: string[] = []
    for (let i = 0; i < numberOfMonths; i++) {
      const monthDate = subMonths(endDate, numberOfMonths - 1 - i)
      months.push(format(startOfMonth(monthDate), 'yyyy-MM'))
    }

    return {
      success: true,
      clients: clientSpendArray,
      months,
    }
  } catch (error) {
    console.error('Error fetching client spend data:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch client spend data' }
  }
}

