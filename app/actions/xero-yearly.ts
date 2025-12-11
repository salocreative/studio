'use server'

import { createClient } from '@/lib/supabase/server'
import { fetchXeroFinancialData } from '@/lib/xero/api'
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns'

interface MonthlyFinancialData {
  month: string
  revenue: number
  expenses: number
  profit: number
}

/**
 * Get financial data for the last 12 months
 * Fetches each month separately and aggregates the data
 */
export async function getYearlyFinancialData() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Get Xero connection to determine tenant_id
    const { data: connection } = await supabase
      .from('xero_connection')
      .select('tenant_id')
      .maybeSingle()

    if (!connection) {
      return { error: 'Xero not connected' }
    }

    const now = new Date()
    const monthlyData: MonthlyFinancialData[] = []

    // Fetch data for each of the last 12 months
    for (let i = 0; i < 12; i++) {
      const monthDate = subMonths(now, i)
      const monthStart = startOfMonth(monthDate)
      const monthEnd = endOfMonth(monthDate)

      const startDateStr = format(monthStart, 'yyyy-MM-dd')
      const endDateStr = format(monthEnd, 'yyyy-MM-dd')
      const monthKey = format(monthStart, 'yyyy-MM')

      // Check cache first
      const { data: cached } = await supabase
        .from('xero_financial_cache')
        .select('revenue, expenses, profit, cached_at')
        .eq('tenant_id', connection.tenant_id)
        .eq('period_start', startDateStr)
        .eq('period_end', endDateStr)
        .maybeSingle()

      if (cached) {
        const cacheAge = Date.now() - new Date(cached.cached_at).getTime()
        const oneDayInMs = 24 * 60 * 60 * 1000

        // Use cached data if less than 24 hours old
        if (cacheAge < oneDayInMs) {
          monthlyData.push({
            month: monthKey,
            revenue: Number(cached.revenue || 0),
            expenses: Number(cached.expenses || 0),
            profit: Number(cached.profit || 0),
          })
          continue
        }
      }

      // Fetch fresh data for this month
      const result = await fetchXeroFinancialData(startDateStr, endDateStr)
      if (result.success) {
        monthlyData.push({
          month: monthKey,
          revenue: result.revenue || 0,
          expenses: result.expenses || 0,
          profit: result.profit || 0,
        })
      } else {
        // If fetch fails, use cached data even if old, or zero
        monthlyData.push({
          month: monthKey,
          revenue: cached ? Number(cached.revenue || 0) : 0,
          expenses: cached ? Number(cached.expenses || 0) : 0,
          profit: cached ? Number(cached.profit || 0) : 0,
        })
      }
    }

    // Sort by month (oldest first)
    monthlyData.sort((a, b) => a.month.localeCompare(b.month))

    // Calculate cumulative (year-to-date) values
    let cumulativeRevenue = 0
    let cumulativeExpenses = 0
    let cumulativeProfit = 0

    const monthlyDataWithCumulative = monthlyData.map(data => {
      cumulativeRevenue += data.revenue
      cumulativeExpenses += data.expenses
      cumulativeProfit += data.profit
      return {
        ...data,
        cumulativeRevenue,
        cumulativeExpenses,
        cumulativeProfit,
      }
    })

    return {
      success: true,
      monthlyData: monthlyDataWithCumulative,
      totalRevenue: cumulativeRevenue,
      totalExpenses: cumulativeExpenses,
      totalProfit: cumulativeProfit,
    }
  } catch (error) {
    console.error('Error fetching yearly financial data:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch yearly financial data' }
  }
}

