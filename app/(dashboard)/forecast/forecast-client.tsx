'use client'

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, TrendingUp, DollarSign, AlertCircle, Link2, ExternalLink } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { startOfMonth, endOfMonth, format, subMonths, addMonths, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { getXeroStatus, getFinancialData } from '@/app/actions/xero'
import { getMonthlySummary } from '@/app/actions/monthly-summary'
import { getLeads } from '@/app/actions/leads'
import { getYearlyFinancialData } from '@/app/actions/xero-yearly'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface FinancialData {
  revenue: number
  expenses: number
  profit: number
  period: {
    start: string
    end: string
  }
  fromCache?: boolean
}

export default function ForecastPageClient() {
  const [loading, setLoading] = useState(true)
  const [xeroConnected, setXeroConnected] = useState(false)
  const [period, setPeriod] = useState<'current' | 'last' | 'next'>('current')
  const [financialData, setFinancialData] = useState<FinancialData | null>(null)
  const [loadingFinancial, setLoadingFinancial] = useState(false)
  const [leads, setLeads] = useState<any[]>([])
  const [monthlySummary, setMonthlySummary] = useState<{
    months: Array<{
      month: string
      totalValue: number
      totalQuotedHours: number
      projectCount: number
      clientBreakdown: Array<{
        clientName: string
        value: number
      }>
    }>
  } | null>(null)
  const [yearlyFinancialData, setYearlyFinancialData] = useState<{
    monthlyData: Array<{
      month: string
      revenue: number
      expenses: number
      profit: number
      cumulativeRevenue: number
      cumulativeExpenses: number
      cumulativeProfit: number
    }>
    totalRevenue: number
    totalExpenses: number
    totalProfit: number
  } | null>(null)
  const tableScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadData()
  }, [period])

  // Scroll table to the right when monthly summary data loads to show latest month first
  useEffect(() => {
    if (monthlySummary && monthlySummary.months.length > 0 && tableScrollRef.current) {
      // Small delay to ensure table is rendered
      setTimeout(() => {
        if (tableScrollRef.current) {
          tableScrollRef.current.scrollLeft = tableScrollRef.current.scrollWidth
        }
      }, 100)
    }
  }, [monthlySummary])

  async function loadData() {
    setLoading(true)
    try {
      // Check Xero connection status
      const xeroStatus = await getXeroStatus()
      
      // Determine connection status
      let isConnected = false
      if (xeroStatus.error) {
        console.error('Error checking Xero status:', xeroStatus.error)
        // Only show error toast for non-table-missing errors
        if (!xeroStatus.error.includes('table not found') && !xeroStatus.error.includes('migration')) {
          toast.error('Error checking Xero connection', { description: xeroStatus.error })
        }
      } else {
        // Use the same logic as Settings page: result.connected || false
        isConnected = xeroStatus.connected || false
        setXeroConnected(isConnected)
        
        // Load financial data if Xero is connected
        if (isConnected) {
          await loadFinancialData()
        }
      }

      // Load leads data for future projections
      const leadsResult = await getLeads()
      if (leadsResult.error) {
        console.error('Error loading leads:', leadsResult.error)
      } else {
        setLeads(leadsResult.leads || [])
      }

      // Load yearly financial data for chart
      if (isConnected) {
        const yearlyResult = await getYearlyFinancialData()
        if (yearlyResult.error) {
          console.error('Error loading yearly financial data:', yearlyResult.error)
        } else if (yearlyResult.success) {
          setYearlyFinancialData(yearlyResult)
        }
      }

      // Load monthly summary data
      const monthlySummaryResult = await getMonthlySummary(12)
      if (monthlySummaryResult.error) {
        console.error('Error loading monthly summary:', monthlySummaryResult.error)
      } else if (monthlySummaryResult.success) {
        setMonthlySummary({
          months: monthlySummaryResult.months || [],
        })
        // Scroll table to the right after data loads to show latest month
        setTimeout(() => {
          if (tableScrollRef.current) {
            tableScrollRef.current.scrollLeft = tableScrollRef.current.scrollWidth
          }
        }, 100)
      }
    } catch (error) {
      console.error('Error loading forecast data:', error)
      toast.error('Error loading forecast data')
    } finally {
      setLoading(false)
    }
  }

  async function loadFinancialData() {
    setLoadingFinancial(true)
    try {
      const dates = getDateRange()
      const result = await getFinancialData(dates.start, dates.end)
      
      if (result.error) {
        console.error('Error loading financial data:', result.error)
        // Only show error toast if we don't have cached data
        if (!result.fromCache) {
          toast.error('Error loading financial data', { description: result.error })
        }
        // Still set data to 0 so UI doesn't break
        setFinancialData({
          revenue: 0,
          expenses: 0,
          profit: 0,
          period: { start: dates.start, end: dates.end },
        })
      } else if (result.success) {
        console.log('Financial data loaded:', {
          revenue: result.revenue,
          expenses: result.expenses,
          profit: result.profit,
          period: result.period,
          fromCache: result.fromCache
        })
        
        // Show info toast if using cached data
        if (result.fromCache) {
          toast.info('Showing cached financial data', { 
            description: 'Xero connection unavailable. Displaying last cached data.' 
          })
        }
        
        setFinancialData({
          revenue: result.revenue || 0,
          expenses: result.expenses || 0,
          profit: result.profit || 0,
          period: result.period || { start: dates.start, end: dates.end },
          fromCache: result.fromCache,
        })
      } else {
        console.warn('Unexpected result format:', result)
      }
    } catch (error) {
      console.error('Error loading financial data:', error)
      toast.error('Error loading financial data')
    } finally {
      setLoadingFinancial(false)
    }
  }

  const getDateRange = () => {
    if (period === 'current') {
      const start = startOfMonth(new Date())
      const end = endOfMonth(new Date())
      return {
        start: format(start, 'yyyy-MM-dd'),
        end: format(end, 'yyyy-MM-dd'),
      }
    } else if (period === 'last') {
      const start = startOfMonth(subMonths(new Date(), 1))
      const end = endOfMonth(subMonths(new Date(), 1))
      return {
        start: format(start, 'yyyy-MM-dd'),
        end: format(end, 'yyyy-MM-dd'),
      }
    } else {
      const start = startOfMonth(addMonths(new Date(), 1))
      const end = endOfMonth(addMonths(new Date(), 1))
      return {
        start: format(start, 'yyyy-MM-dd'),
        end: format(end, 'yyyy-MM-dd'),
      }
    }
  }


  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b bg-background">
          <div className="flex h-16 items-center px-6">
            <div>
              <h1 className="text-2xl font-semibold">Forecast</h1>
              <p className="text-sm text-muted-foreground">
                Project forecasting and planning
              </p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Forecast</h1>
            <p className="text-sm text-muted-foreground">
              Project forecasting and planning
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl space-y-6">
          {/* Xero Connection Status */}
          {!xeroConnected && (
            <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950 dark:border-orange-900">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  <CardTitle>Xero Not Connected</CardTitle>
                </div>
                <CardDescription>
                  Connect your Xero account to see real financial data and accurate forecasts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/settings">
                    <Link2 className="mr-2 h-4 w-4" />
                    Connect Xero in Settings
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Year-to-Date Financial Chart */}
          {xeroConnected && yearlyFinancialData && yearlyFinancialData.monthlyData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Year-to-Date Financial Overview</CardTitle>
                <CardDescription>
                  Revenue and expenses trend over the last 12 months. Solid lines show monthly values, dashed lines show cumulative year-to-date totals.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={yearlyFinancialData.monthlyData.map(data => ({
                    month: format(parseISO(`${data.month}-01`), 'MMM yyyy'),
                    revenue: data.revenue,
                    expenses: data.expenses,
                    profit: data.profit,
                    cumulativeRevenue: data.cumulativeRevenue,
                    cumulativeExpenses: data.cumulativeExpenses,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="month" 
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `£${(value / 1000).toFixed(0)}k`}
                    />
                    <RechartsTooltip 
                      formatter={(value: number) => `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="revenue" 
                      stroke="#8884d8" 
                      strokeWidth={2}
                      name="Monthly Revenue"
                      dot={{ r: 4 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="expenses" 
                      stroke="#82ca9d" 
                      strokeWidth={2}
                      name="Monthly Expenses"
                      dot={{ r: 4 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="cumulativeRevenue" 
                      stroke="#8884d8" 
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name="YTD Revenue"
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="cumulativeExpenses" 
                      stroke="#82ca9d" 
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name="YTD Expenses"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Financial Overview - Period Selector */}
          {xeroConnected && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Financial Overview</CardTitle>
                    <CardDescription>
                      Revenue, expenses, and profit for the selected period
                    </CardDescription>
                  </div>
                  <Select value={period} onValueChange={(value: 'current' | 'last' | 'next') => setPeriod(value)}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="last">Last Month</SelectItem>
                      <SelectItem value="current">Current Month</SelectItem>
                      <SelectItem value="next">Next Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {financialData?.fromCache && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
                      <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                      <span>Showing cached financial data. Xero connection unavailable.</span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Revenue
                    </CardTitle>
                  </CardHeader>
                <CardContent>
                  {loadingFinancial ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : (
                    <div className="text-3xl font-bold">
                      £{financialData?.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Expenses
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingFinancial ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : (
                    <div className="text-3xl font-bold">
                      £{financialData?.expenses.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Profit
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingFinancial ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : (
                    <div className={cn(
                      "text-3xl font-bold",
                      (financialData?.profit || 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    )}>
                      £{financialData?.profit.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                    </div>
                  )}
                </CardContent>
              </Card>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Monthly Summary Table */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Summary</CardTitle>
              <CardDescription>
                Completed project work and projected future work from leads. Historical data shows completed projects, projected data (in italics) shows leads by their timeline.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                // Combine completed months with future months from leads
                const completedMonths = monthlySummary?.months || []
                const now = new Date()
                const currentMonth = format(now, 'yyyy-MM')
                
                // Process leads to group by month
                const futureMonthsMap = new Map<string, {
                  totalValue: number
                  totalQuotedHours: number
                  projectCount: number
                  clientBreakdown: Record<string, number>
                  isProjected: boolean
                }>()
                
                leads.forEach((lead) => {
                  // Use due_date instead of timeline
                  if (!lead.due_date) return
                  
                  const dueDate = new Date(lead.due_date)
                  if (isNaN(dueDate.getTime())) return
                  
                  // Get the month of the due date
                  const monthKey = format(startOfMonth(dueDate), 'yyyy-MM')
                  
                  // Only include future months (including current month)
                  if (monthKey < currentMonth) return
                  
                  // Assign lead to its due date month
                  if (!futureMonthsMap.has(monthKey)) {
                    futureMonthsMap.set(monthKey, {
                      totalValue: 0,
                      totalQuotedHours: 0,
                      projectCount: 0,
                      clientBreakdown: {},
                      isProjected: true,
                    })
                  }
                  
                  const monthData = futureMonthsMap.get(monthKey)!
                  const value = lead.quote_value || 0
                  const hours = lead.quoted_hours || 0
                  const clientName = lead.client_name || 'Unknown'
                  
                  monthData.totalValue += value
                  monthData.totalQuotedHours += hours
                  monthData.projectCount += 1
                  
                  if (!monthData.clientBreakdown[clientName]) {
                    monthData.clientBreakdown[clientName] = 0
                  }
                  monthData.clientBreakdown[clientName] += value
                })
                
                // Combine completed and future months
                const allMonthsMap = new Map<string, {
                  totalValue: number
                  totalQuotedHours: number
                  projectCount: number
                  clientBreakdown: Array<{ clientName: string; value: number }> | Record<string, number>
                  isProjected: boolean
                }>()
                
                // Add completed months
                completedMonths.forEach((month) => {
                  allMonthsMap.set(month.month, {
                    ...month,
                    isProjected: false,
                  })
                })
                
                // Add future months (merge if month already exists)
                futureMonthsMap.forEach((futureData, monthKey) => {
                  if (allMonthsMap.has(monthKey)) {
                    // Merge with existing completed data
                    const existing = allMonthsMap.get(monthKey)!
                    existing.totalValue += futureData.totalValue
                    existing.totalQuotedHours += futureData.totalQuotedHours
                    existing.projectCount += futureData.projectCount
                    // Merge client breakdown
                    if (Array.isArray(existing.clientBreakdown)) {
                      const breakdownMap: Record<string, number> = {}
                      existing.clientBreakdown.forEach(c => {
                        breakdownMap[c.clientName] = c.value
                      })
                      Object.entries(futureData.clientBreakdown).forEach(([client, value]) => {
                        breakdownMap[client] = (breakdownMap[client] || 0) + value
                      })
                      existing.clientBreakdown = Object.entries(breakdownMap).map(([clientName, value]) => ({
                        clientName,
                        value,
                      }))
                    }
                  } else {
                    // New future month
                    allMonthsMap.set(monthKey, {
                      ...futureData,
                      clientBreakdown: Object.entries(futureData.clientBreakdown).map(([clientName, value]) => ({
                        clientName,
                        value,
                      })),
                    })
                  }
                })
                
                // Sort months chronologically
                const allMonths = Array.from(allMonthsMap.entries())
                  .map(([month, data]) => ({
                    month,
                    ...data,
                  }))
                  .sort((a, b) => a.month.localeCompare(b.month))
                
                // Filter out months with no data
                const monthsWithData = allMonths.filter(
                  m => m.totalValue > 0 || m.totalQuotedHours > 0 || m.projectCount > 0
                )
                
                if (monthsWithData.length === 0) {
                  return (
                    <div className="text-center py-12 text-muted-foreground">
                      <p className="mb-2">No monthly summary data available</p>
                      <p className="text-sm">
                        This could be because:
                      </p>
                      <ul className="text-sm mt-2 space-y-1 list-disc list-inside">
                        <li>No completed projects have quote_value set</li>
                        <li>Completed projects don't have completed_date configured</li>
                        <li>No leads have timeline dates configured</li>
                        <li>All projects are from Flexi-Design boards (excluded from this table)</li>
                      </ul>
                    </div>
                  )
                }
                
                return (
                  <TooltipProvider>
                    <div className="rounded-lg border overflow-hidden">
                      <div ref={tableScrollRef} className="overflow-x-auto relative">
                        <table className="w-full caption-bottom text-sm border-collapse">
                          <thead className="[&_tr]:border-b">
                            <tr className="hover:bg-muted/50 border-b transition-colors">
                              <th className="sticky left-0 z-30 bg-background border-r text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap min-w-[150px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                                Metric
                              </th>
                              {monthsWithData.map((monthData) => {
                                const monthDate = parseISO(`${monthData.month}-01`)
                                const isFuture = monthData.month >= currentMonth && monthData.isProjected
                                return (
                                  <th key={monthData.month} className={cn(
                                    "text-right text-foreground h-10 px-2 align-middle font-medium whitespace-nowrap min-w-[130px]",
                                    isFuture && "italic text-muted-foreground"
                                  )}>
                                    {format(monthDate, 'MMM yyyy')}
                                    {isFuture && <span className="text-xs ml-1">(proj.)</span>}
                                  </th>
                                )
                              })}
                            </tr>
                          </thead>
                          <tbody className="[&_tr:last-child]:border-0">
                            {/* Total Billable Work Row */}
                            <tr className="hover:bg-muted/50 border-b transition-colors">
                              <td className="sticky left-0 z-20 bg-background border-r font-medium p-2 align-middle whitespace-nowrap min-w-[150px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                                Total Billable Work
                              </td>
                              {monthsWithData.map((monthData) => {
                                const clientBreakdown = Array.isArray(monthData.clientBreakdown) 
                                  ? monthData.clientBreakdown 
                                  : Object.entries(monthData.clientBreakdown).map(([clientName, value]) => ({
                                      clientName,
                                      value: typeof value === 'number' ? value : 0,
                                    }))
                                const hasData = clientBreakdown.length > 0 || monthData.totalValue > 0
                                const isFuture = monthData.month >= currentMonth && monthData.isProjected
                                
                                return (
                                  <td key={monthData.month} className={cn(
                                    "text-right p-2 align-middle whitespace-nowrap",
                                    isFuture && "italic"
                                  )}>
                                    {hasData ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className={cn(
                                            "cursor-help underline decoration-dotted",
                                            isFuture && "text-muted-foreground"
                                          )}>
                                            £{monthData.totalValue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[300px]">
                                          <div className="space-y-1">
                                            <div className="font-semibold mb-2">
                                              {isFuture ? 'Projected Client Breakdown:' : 'Client Breakdown:'}
                                            </div>
                                            {clientBreakdown.map((client) => (
                                              <div key={client.clientName} className="flex justify-between gap-4 text-sm">
                                                <span>{client.clientName}:</span>
                                                <span className="font-medium">£{client.value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                            {/* Hours Quoted Row */}
                            <tr className="hover:bg-muted/50 border-b transition-colors">
                              <td className="sticky left-0 z-20 bg-background border-r font-medium p-2 align-middle whitespace-nowrap min-w-[150px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                                Hours Quoted
                              </td>
                              {monthsWithData.map((monthData) => {
                                const isFuture = monthData.month >= currentMonth && monthData.isProjected
                                return (
                                  <td key={monthData.month} className={cn(
                                    "text-right p-2 align-middle whitespace-nowrap",
                                    isFuture && "italic text-muted-foreground"
                                  )}>
                                    {monthData.totalQuotedHours > 0 ? (
                                      `${monthData.totalQuotedHours.toFixed(1)}h`
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                            {/* Number of Projects Row */}
                            <tr className="hover:bg-muted/50 border-b transition-colors">
                              <td className="sticky left-0 z-20 bg-background border-r font-medium p-2 align-middle whitespace-nowrap min-w-[150px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                                Number of Projects
                              </td>
                              {monthsWithData.map((monthData) => {
                                const isFuture = monthData.month >= currentMonth && monthData.isProjected
                                return (
                                  <td key={monthData.month} className={cn(
                                    "text-right p-2 align-middle whitespace-nowrap",
                                    isFuture && "italic text-muted-foreground"
                                  )}>
                                    {Math.round(monthData.projectCount) > 0 ? (
                                      Math.round(monthData.projectCount)
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </TooltipProvider>
                )
              })()}
            </CardContent>
          </Card>

          {!xeroConnected && (
            <Card>
              <CardContent className="py-12">
                <div className="text-center text-muted-foreground">
                  <p className="mb-2">Connect Xero to see detailed forecasts</p>
                  <p className="text-sm">
                    Financial forecasting requires Xero integration to access real revenue and expense data.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  )
}

