'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, TrendingUp, DollarSign, AlertCircle, Link2 } from 'lucide-react'
import { startOfMonth, endOfMonth, format, subMonths, addMonths } from 'date-fns'
import { toast } from 'sonner'
import { getXeroStatus, getFinancialData } from '@/app/actions/xero'
import { getLeads } from '@/app/actions/leads'
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

  useEffect(() => {
    loadData()
  }, [period])

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

          {/* Leads Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Leads Overview</CardTitle>
              <CardDescription>
                Potential future revenue from leads and prospects
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                  <div className="text-sm text-muted-foreground">Potential Revenue</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    £{potentialRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    (Est. at £{estimatedHourlyRate}/hour)
                  </div>
                </div>
              </div>
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

