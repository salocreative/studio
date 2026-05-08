'use client'

import React, { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from 'lucide-react'
import { 
  getScorecardCategories, 
  getScorecardMetrics,
  getScorecardEntriesForWeeks,
  type ScorecardCategory,
  type ScorecardMetric,
  type ScorecardEntry
} from '@/app/actions/scorecard'
import { toast } from 'sonner'
import { format, startOfWeek, addWeeks, subWeeks } from 'date-fns'
import { cn } from '@/lib/utils'

interface EntryWithMetric extends ScorecardEntry {
  metric: ScorecardMetric
}

interface WeekData {
  weekStart: string
  entries: EntryWithMetric[]
}

export default function ScorecardPageClient() {
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<ScorecardCategory[]>([])
  const [metrics, setMetrics] = useState<ScorecardMetric[]>([])
  const [weekData, setWeekData] = useState<WeekData[]>([])
  const [currentWeekStart, setCurrentWeekStart] = useState<string>(() => {
    const today = new Date()
    return format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  })
  const [numWeeks, setNumWeeks] = useState(8) // Show 8 weeks by default
  const [carouselStartIndex, setCarouselStartIndex] = useState(0)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const tableScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadData()
  }, [currentWeekStart, numWeeks])

  // Scroll to the right (current week) when table loads or week data changes
  useEffect(() => {
    if (tableScrollRef.current && weekData.length > 0) {
      // Keep the table positioned on the left, where the current week column is shown first.
      tableScrollRef.current.scrollLeft = 0
    }
  }, [weekData])

  async function loadData() {
    setLoading(true)
    try {
      const [categoriesResult, metricsResult] = await Promise.all([
        getScorecardCategories(),
        getScorecardMetrics(),
      ])

      if (categoriesResult.error) {
        toast.error('Error loading categories', { description: categoriesResult.error })
      } else if (categoriesResult.success) {
        setCategories(categoriesResult.categories || [])
        // Expand all categories by default
        setExpandedCategories(new Set(categoriesResult.categories?.map(c => c.id) || []))
      }

      if (metricsResult.error) {
        toast.error('Error loading metrics', { description: metricsResult.error })
      } else if (metricsResult.success) {
        setMetrics(metricsResult.metrics || [])
      }

      // Load entries for multiple weeks (optimized batch query)
      const weeksToLoad: string[] = []
      const baseWeek = new Date(currentWeekStart)
      for (let i = numWeeks - 1; i >= 0; i--) {
        const weekDate = subWeeks(baseWeek, i)
        weeksToLoad.push(format(startOfWeek(weekDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
      }

      const entriesResult = await getScorecardEntriesForWeeks(weeksToLoad)

      if (entriesResult.error) {
        console.error('Error loading scorecard entries:', entriesResult.error)
        toast.error('Error loading scorecard data', { description: entriesResult.error })
        // Still show empty weeks so the UI renders
      }

      if (!entriesResult.success || !entriesResult.entriesByWeek) {
        console.error('Invalid response from getScorecardEntriesForWeeks:', entriesResult)
        if (!entriesResult.error) {
          toast.error('Invalid data format received')
        }
      }

      const weeks: WeekData[] = weeksToLoad.map((weekStart) => ({
        weekStart,
        entries: entriesResult.success && entriesResult.entriesByWeek
          ? (entriesResult.entriesByWeek[weekStart] || [])
          : [],
      })).reverse()

      setWeekData(weeks)
      setCarouselStartIndex(0)
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Error loading data')
    } finally {
      setLoading(false)
    }
  }

  function toggleCategory(categoryId: string) {
    const newExpanded = new Set(expandedCategories)
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId)
    } else {
      newExpanded.add(categoryId)
    }
    setExpandedCategories(newExpanded)
  }

  function navigateWeeks(direction: 'prev' | 'next') {
    const currentDate = new Date(currentWeekStart)
    const newDate = direction === 'next' 
      ? addWeeks(currentDate, numWeeks)
      : subWeeks(currentDate, numWeeks)
    setCurrentWeekStart(format(startOfWeek(newDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
  }

  function goToCurrentWeek() {
    const today = new Date()
    setCurrentWeekStart(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
  }

  const visibleWeekCount = 3
  const visibleWeeks = weekData.slice(carouselStartIndex, carouselStartIndex + visibleWeekCount)
  const canGoToOlderWeeks = carouselStartIndex + visibleWeekCount < weekData.length
  const canGoToNewerWeeks = carouselStartIndex > 0

  const automatedMetrics = metrics.filter(metric => metric.is_automated)
  const automatedMetricIds = new Set(automatedMetrics.map(metric => metric.id))
  const currentWeek = weekData[0]
  const currentWeekTrackedMetricIds = new Set(
    (currentWeek?.entries || []).filter(entry => entry.id).map(entry => entry.metric_id)
  )

  const stableAutomations = automatedMetrics.filter((metric) => {
    if (!metric.automation_source) return false
    if (metric.automation_source === 'capacity') return false
    const isApproximateLeadMetric =
      metric.automation_source === 'leads' &&
      ['intro_calls', 'inbound'].includes(metric.automation_config?.type)
    return !isApproximateLeadMetric
  })

  const partialAutomations = automatedMetrics.filter((metric) => {
    return metric.automation_source === 'leads' && ['intro_calls', 'inbound'].includes(metric.automation_config?.type)
  })

  const needsWorkAutomations = automatedMetrics.filter((metric) => {
    return !metric.automation_source || metric.automation_source === 'capacity'
  })

  function goToOlderWeeks() {
    setCarouselStartIndex(prev => Math.min(prev + visibleWeekCount, Math.max(weekData.length - visibleWeekCount, 0)))
  }

  function goToNewerWeeks() {
    setCarouselStartIndex(prev => Math.max(prev - visibleWeekCount, 0))
  }

  function getWeekComparison(currentEntry: EntryWithMetric | undefined, previousEntry: EntryWithMetric | undefined) {
    if (!currentEntry || !previousEntry) return null
    
    const change = currentEntry.value - previousEntry.value
    const changePercent = previousEntry.value !== 0 
      ? (change / previousEntry.value) * 100 
      : (change > 0 ? 100 : 0)
    
    return {
      change,
      changePercent,
      isImprovement: change > 0,
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Scorecard Overview</CardTitle>
          <CardDescription>Weekly automated metrics across all categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={goToNewerWeeks} disabled={!canGoToNewerWeeks}>
              ← Newer 3 Weeks
            </Button>
            <div className="flex-1 text-center">
              <div className="font-semibold">
                Showing {Math.min(visibleWeekCount, weekData.length)} of {weekData.length} weeks
              </div>
              <Button variant="ghost" size="sm" onClick={goToCurrentWeek} className="mt-2">
                Go to Current Week
              </Button>
            </div>
            <Button variant="outline" onClick={goToOlderWeeks} disabled={!canGoToOlderWeeks}>
              Older 3 Weeks →
            </Button>
            <div className="flex items-center gap-2">
              <Label htmlFor="num-weeks" className="text-sm">Weeks:</Label>
              <Input
                id="num-weeks"
                type="number"
                min="2"
                max="26"
                value={numWeeks}
                onChange={(e) => setNumWeeks(Math.max(2, Math.min(26, parseInt(e.target.value) || 8)))}
                className="w-20"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automation Health</CardTitle>
          <CardDescription>Status of currently tracked automated metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Stable Automations</div>
              <div className="text-2xl font-semibold">{stableAutomations.length}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Partial / Proxy Logic</div>
              <div className="text-2xl font-semibold">{partialAutomations.length}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground">Needs Backend Work</div>
              <div className="text-2xl font-semibold">{needsWorkAutomations.length}</div>
            </div>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Current week entries synced: {currentWeekTrackedMetricIds.size} / {automatedMetrics.length}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div ref={tableScrollRef} className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-background min-w-[250px] border-r">Metric</TableHead>
                  {visibleWeeks.map((week, index) => {
                    const weekStartDate = new Date(week.weekStart)
                    const weekEndDate = new Date(weekStartDate)
                    weekEndDate.setDate(weekEndDate.getDate() + 6)
                    const isCurrentWeek = index === 0 && carouselStartIndex === 0
                    return (
                      <TableHead 
                        key={week.weekStart} 
                        className={cn(
                          "text-center min-w-[150px]",
                          isCurrentWeek && "bg-muted/50"
                        )}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className="font-semibold">
                            {format(weekStartDate, 'MMM d')} - {format(weekEndDate, 'MMM d')}
                          </div>
                          {isCurrentWeek && <span className="text-xs text-muted-foreground">Current</span>}
                        </div>
                      </TableHead>
                    )
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => {
                  const categoryMetrics = automatedMetrics.filter(m => m.category_id === category.id)
                  const isExpanded = expandedCategories.has(category.id)

                  return (
                    <React.Fragment key={category.id}>
                      {/* Category Header Row */}
                      <TableRow className="bg-muted/30 font-semibold">
                        <TableCell className="sticky left-0 z-10 bg-muted/60 border-r">
                          <button
                            onClick={() => toggleCategory(category.id)}
                            className="flex items-center gap-2 hover:text-primary transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            {category.name}
                          </button>
                        </TableCell>
                        {visibleWeeks.map((week) => {
                          const categoryEntries = week.entries.filter(
                            e => e.metric?.category_id === category.id && automatedMetricIds.has(e.metric_id)
                          )
                          const totalValue = categoryEntries.reduce((sum, e) => sum + e.value, 0)
                          return (
                            <TableCell key={week.weekStart} className="text-center">
                              {categoryEntries.length > 0 && totalValue > 0 ? (
                                <span className="font-semibold">{totalValue.toLocaleString()}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>

                      {/* Metric Rows (when expanded) */}
                      {isExpanded && categoryMetrics.map((metric) => {
                        return (
                          <TableRow key={metric.id} className="hover:bg-muted/20">
                            <TableCell className="sticky left-0 z-10 bg-background pl-8 border-r">
                              <div className="flex items-center gap-2">
                                <span>{metric.name}</span>
                                {metric.is_automated && (
                                  <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded">
                                    Auto
                                  </span>
                                )}
                              </div>
                              {metric.description && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {metric.description}
                                </div>
                              )}
                            </TableCell>
                            {visibleWeeks.map((week, weekIndex) => {
                              const entry = week.entries.find(e => e.metric_id === metric.id)
                              const previousWeek = visibleWeeks[weekIndex + 1] || null
                              const previousEntry = previousWeek?.entries.find(e => e.metric_id === metric.id)
                              const hasPersistedEntry = Boolean(entry?.id)
                              const hasPersistedPreviousEntry = Boolean(previousEntry?.id)
                              const comparison = hasPersistedEntry && hasPersistedPreviousEntry
                                ? getWeekComparison(entry, previousEntry)
                                : null

                              return (
                                <TableCell key={week.weekStart} className="text-center">
                                  <div className="space-y-1">
                                    {entry && hasPersistedEntry ? (
                                      <>
                                        <div className="font-semibold">
                                          {entry.value.toLocaleString()} {metric.unit || ''}
                                        </div>
                                        {entry.target_value && (
                                          <div className="text-xs text-muted-foreground">
                                            Target: {entry.target_value.toLocaleString()}
                                          </div>
                                        )}
                                        {comparison && (
                                          <div className={cn(
                                            "text-xs flex items-center justify-center gap-1",
                                            comparison.isImprovement ? "text-green-600" : "text-red-600"
                                          )}>
                                            {comparison.isImprovement ? (
                                              <TrendingUp className="h-3 w-3" />
                                            ) : (
                                              <TrendingDown className="h-3 w-3" />
                                            )}
                                            {comparison.change > 0 ? '+' : ''}{comparison.change.toFixed(1)} 
                                            ({comparison.changePercent > 0 ? '+' : ''}{comparison.changePercent.toFixed(0)}%)
                                          </div>
                                        )}
                                        {entry.notes && (
                                          <div className="text-xs text-muted-foreground mt-1 max-w-[200px] truncate" title={entry.notes}>
                                            {entry.notes}
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </div>
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}

