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
import { getLeads } from '@/app/actions/leads'
import { getMonthlySummary } from '@/app/actions/monthly-summary'
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
  const [leads, setLeads] = useState<any[]>([])
  const [loadingFinancial, setLoadingFinancial] = useState(false)
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
      
      // Handle connection status - match the logic from Settings page exactly
      // Settings page uses: result.connected || false
      if (xeroStatus.error) {
        console.error('Error checking Xero status:', xeroStatus.error)
        // Only show error toast for non-table-missing errors
        if (!xeroStatus.error.includes('table not found') && !xeroStatus.error.includes('migration')) {
          toast.error('Error checking Xero connection', { description: xeroStatus.error })
        }
      } else {
        // Use the same logic as Settings page: result.connected || false
        const isConnected = xeroStatus.connected || false
        setXeroConnected(isConnected)
        
        // Load financial data if Xero is connected
        if (isConnected) {
          await loadFinancialData()
        }
      }

      // Load leads
      const leadsResult = await getLeads()
      if (leadsResult.error) {
        console.error('Error loading leads:', leadsResult.error)
      } else {
        setLeads(leadsResult.leads || [])
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

  const totalLeadsHours = leads.reduce((sum, lead) => sum + (lead.quoted_hours || 0), 0)
  // Simplified: Estimate revenue from leads (assuming £X per hour)
  // This would be configurable in production
  const estimatedHourlyRate = 75 // Placeholder - should be configurable
  const potentialRevenue = totalLeadsHours * estimatedHourlyRate

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
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-2xl font-semibold">Forecast</h1>
            <p className="text-sm text-muted-foreground">
              Project forecasting and planning
            </p>
          </div>
          <div className="flex items-center gap-4">
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

          {/* Financial Overview */}
          {xeroConnected && (
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
          )}

          {/* Monthly Summary Table */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Summary</CardTitle>
              <CardDescription>
                Overview of completed project work by month over the last 12 months
              </CardDescription>
            </CardHeader>
            <CardContent>
              {monthlySummary && monthlySummary.months.length > 0 ? (
                <TooltipProvider>
                  <div className="rounded-lg border overflow-hidden">
                    <div ref={tableScrollRef} className="overflow-x-auto relative">
                      <table className="w-full caption-bottom text-sm border-collapse">
                        <thead className="[&_tr]:border-b">
                          <tr className="hover:bg-muted/50 border-b transition-colors">
                            <th className="sticky left-0 z-30 bg-background border-r text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap min-w-[150px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                              Metric
                            </th>
                            {monthlySummary.months
                              .filter(m => m.totalValue > 0 || m.totalQuotedHours > 0 || m.projectCount > 0)
                              .map((monthData) => {
                                const monthDate = parseISO(`${monthData.month}-01`)
                                return (
                                  <th key={monthData.month} className="text-right text-foreground h-10 px-2 align-middle font-medium whitespace-nowrap min-w-[130px]">
                                    {format(monthDate, 'MMM yyyy')}
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
                            {monthlySummary.months
                              .filter(m => m.totalValue > 0 || m.totalQuotedHours > 0 || m.projectCount > 0)
                              .map((monthData) => (
                                <td key={monthData.month} className="text-right p-2 align-middle whitespace-nowrap">
                                  {monthData.clientBreakdown.length > 0 ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help underline decoration-dotted">
                                          £{monthData.totalValue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[300px]">
                                        <div className="space-y-1">
                                          <div className="font-semibold mb-2">Client Breakdown:</div>
                                          {monthData.clientBreakdown.map((client) => (
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
                              ))}
                          </tr>
                          {/* Hours Quoted Row */}
                          <tr className="hover:bg-muted/50 border-b transition-colors">
                            <td className="sticky left-0 z-20 bg-background border-r font-medium p-2 align-middle whitespace-nowrap min-w-[150px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                              Hours Quoted
                            </td>
                            {monthlySummary.months
                              .filter(m => m.totalValue > 0 || m.totalQuotedHours > 0 || m.projectCount > 0)
                              .map((monthData) => (
                                <td key={monthData.month} className="text-right p-2 align-middle whitespace-nowrap">
                                  {monthData.totalQuotedHours > 0 ? (
                                    `${monthData.totalQuotedHours.toFixed(1)}h`
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                              ))}
                          </tr>
                          {/* Number of Projects Row */}
                          <tr className="hover:bg-muted/50 border-b transition-colors">
                            <td className="sticky left-0 z-20 bg-background border-r font-medium p-2 align-middle whitespace-nowrap min-w-[150px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                              Number of Projects
                            </td>
                            {monthlySummary.months
                              .filter(m => m.totalValue > 0 || m.totalQuotedHours > 0 || m.projectCount > 0)
                              .map((monthData) => (
                                <td key={monthData.month} className="text-right p-2 align-middle whitespace-nowrap">
                                  {monthData.projectCount > 0 ? (
                                    monthData.projectCount
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                              ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </TooltipProvider>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="mb-2">No monthly summary data available</p>
                  <p className="text-sm">
                    This could be because:
                  </p>
                  <ul className="text-sm mt-2 space-y-1 list-disc list-inside">
                    <li>No completed projects have quote_value set</li>
                    <li>Completed projects don't have completed_date configured</li>
                    <li>All projects are from Flexi-Design boards (excluded from this table)</li>
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Leads Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Leads Overview</CardTitle>
              <CardDescription>
                Potential future revenue from leads and prospects from Monday.com
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Total Leads</div>
                  <div className="text-2xl font-bold">{leads.length}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Total Quoted Hours</div>
                  <div className="text-2xl font-bold">{totalLeadsHours.toFixed(1)}h</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Total Value</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    £{leads.reduce((sum, lead) => sum + (lead.quote_value || lead.quoted_hours ? (lead.quoted_hours || 0) * estimatedHourlyRate : 0), 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {leads.some(l => l.quote_value) 
                      ? 'From Monday.com values'
                      : `Est. at £${estimatedHourlyRate}/hour`}
                  </div>
                </div>
              </div>

              {/* Detailed Leads Table */}
              {leads.length > 0 && (
                <div className="border-t pt-6">
                  <h3 className="text-lg font-semibold mb-4">All Leads</h3>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project Name</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead className="text-right">Quoted Hours</TableHead>
                          <TableHead className="text-right">Quote Value</TableHead>
                          <TableHead className="text-right">Est. Value</TableHead>
                          <TableHead>Timeline</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leads.map((lead) => {
                          const estimatedValue = lead.quoted_hours ? lead.quoted_hours * estimatedHourlyRate : 0
                          const displayValue = lead.quote_value || estimatedValue
                          const isEstimated = !lead.quote_value

                          return (
                            <TableRow key={lead.id}>
                              <TableCell className="font-medium">{lead.name}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {lead.client_name || '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                {lead.quoted_hours ? `${lead.quoted_hours.toFixed(1)}h` : '—'}
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {lead.quote_value ? (
                                  `£${lead.quote_value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className={cn(
                                "text-right",
                                isEstimated && "text-muted-foreground"
                              )}>
                                {estimatedValue > 0 ? (
                                  <>
                                    £{estimatedValue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    {isEstimated && lead.quote_value === null && (
                                      <span className="text-xs ml-1">(est.)</span>
                                    )}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {lead.timeline_start || lead.timeline_end ? (
                                  <div>
                                    {lead.timeline_start && (
                                      <div>{format(new Date(lead.timeline_start), 'MMM d, yyyy')}</div>
                                    )}
                                    {lead.timeline_start && lead.timeline_end && (
                                      <div className="text-xs">to</div>
                                    )}
                                    {lead.timeline_end && (
                                      <div>{format(new Date(lead.timeline_end), 'MMM d, yyyy')}</div>
                                    )}
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                        <TableRow className="font-semibold bg-muted/50">
                          <TableCell colSpan={2}>Total</TableCell>
                          <TableCell className="text-right">
                            {totalLeadsHours.toFixed(1)}h
                          </TableCell>
                          <TableCell className="text-right">
                            £{leads.reduce((sum, lead) => sum + (lead.quote_value || 0), 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            £{potentialRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Forecast Summary */}
          {xeroConnected && financialData && (
            <Card>
              <CardHeader>
                <CardTitle>Forecast Summary</CardTitle>
                <CardDescription>
                  Projected financial outlook based on current data and leads
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <div className="text-sm font-medium">Current Period ({period === 'current' ? 'This Month' : period === 'last' ? 'Last Month' : 'Next Month'})</div>
                      <div className="text-xs text-muted-foreground">
                        {financialData.period.start} to {financialData.period.end}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn(
                        "text-2xl font-bold",
                        financialData.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                      )}>
                        £{financialData.profit.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs text-muted-foreground">Profit</div>
                    </div>
                  </div>

                  {leads.length > 0 && (
                    <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                      <div>
                        <div className="text-sm font-medium">Potential from Leads</div>
                        <div className="text-xs text-muted-foreground">
                          {leads.length} leads with {totalLeadsHours.toFixed(1)}h quoted
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                          £{potentialRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs text-muted-foreground">If all convert</div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

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

