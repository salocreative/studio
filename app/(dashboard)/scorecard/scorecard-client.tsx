'use client'

import React, { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, TrendingUp, TrendingDown, Minus, Edit2, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { 
  getScorecardCategories, 
  getScorecardMetrics,
  getScorecardEntriesForWeeks,
  updateScorecardEntry,
  createScorecardEntry,
  type ScorecardCategory,
  type ScorecardMetric,
  type ScorecardEntry
} from '@/app/actions/scorecard'
import { toast } from 'sonner'
import { format, startOfWeek, addWeeks, subWeeks, eachWeekOfInterval } from 'date-fns'
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
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [editingWeek, setEditingWeek] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, { value: string; target: string; notes: string }>>({})
  const [saving, setSaving] = useState(false)
  const tableScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadData()
  }, [currentWeekStart, numWeeks])

  // Scroll to the right (current week) when table loads or week data changes
  useEffect(() => {
    if (tableScrollRef.current && weekData.length > 0) {
      // Scroll to the far right to show the current week
      tableScrollRef.current.scrollLeft = tableScrollRef.current.scrollWidth
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
      }))

      setWeekData(weeks)
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

  function handleStartEdit(weekStart: string) {
    setEditingWeek(weekStart)
    const week = weekData.find(w => w.weekStart === weekStart)
    if (week) {
      const editState: Record<string, { value: string; target: string; notes: string }> = {}
      week.entries.forEach(entry => {
        editState[entry.metric_id] = {
          value: entry.value.toString(),
          target: entry.target_value?.toString() || '',
          notes: entry.notes || '',
        }
      })
      setEditValues(editState)
    }
  }

  function handleCancelEdit() {
    setEditingWeek(null)
    setEditValues({})
  }

  function handleCloseEditDialog() {
    if (!saving) {
      handleCancelEdit()
    }
  }

  async function handleSaveWeek() {
    if (!editingWeek) return

    setSaving(true)
    try {
      const week = weekData.find(w => w.weekStart === editingWeek)
      if (!week) return

      const savePromises = week.entries.map(async (entry) => {
        const editData = editValues[entry.metric_id]
        if (!editData) return

        const value = parseFloat(editData.value)
        const target = editData.target ? parseFloat(editData.target) : null

        if (isNaN(value)) {
          toast.error(`Invalid value for ${entry.metric?.name}`)
          return
        }

        if (entry.id) {
          return updateScorecardEntry(entry.id, value, target, editData.notes || null)
        } else {
          return createScorecardEntry(entry.metric_id, editingWeek, value, target, editData.notes || null)
        }
      })

      await Promise.all(savePromises)
      toast.success('Week data saved successfully')
      setEditingWeek(null)
      setEditValues({})
      await loadData()
    } catch (error) {
      console.error('Error saving week data:', error)
      toast.error('Error saving week data')
    } finally {
      setSaving(false)
    }
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
          <CardDescription>Weekly key metrics across all categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigateWeeks('prev')}>
              ← Previous {numWeeks} Weeks
            </Button>
            <div className="flex-1 text-center">
              <div className="font-semibold">
                Showing {numWeeks} weeks
              </div>
              <Button variant="ghost" size="sm" onClick={goToCurrentWeek} className="mt-2">
                Go to Current Week
              </Button>
            </div>
            <Button variant="outline" onClick={() => navigateWeeks('next')}>
              Next {numWeeks} Weeks →
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

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div ref={tableScrollRef} className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-background min-w-[250px] border-r">Metric</TableHead>
                  {weekData.map((week, index) => {
                    const weekStartDate = new Date(week.weekStart)
                    const weekEndDate = new Date(weekStartDate)
                    weekEndDate.setDate(weekEndDate.getDate() + 6)
                    const isCurrentWeek = index === weekData.length - 1
                    const isEditing = editingWeek === week.weekStart

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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStartEdit(week.weekStart)}
                          >
                            <Edit2 className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                        </div>
                      </TableHead>
                    )
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => {
                  const categoryMetrics = metrics.filter(m => m.category_id === category.id)
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
                        {weekData.map((week) => {
                          const categoryEntries = week.entries.filter(e => e.metric?.category_id === category.id)
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
                            {weekData.map((week, weekIndex) => {
                              const entry = week.entries.find(e => e.metric_id === metric.id)
                              const previousWeek = weekIndex > 0 ? weekData[weekIndex - 1] : null
                              const previousEntry = previousWeek?.entries.find(e => e.metric_id === metric.id)
                              const comparison = getWeekComparison(entry, previousEntry)

                              return (
                                <TableCell key={week.weekStart} className="text-center">
                                  <div className="space-y-1">
                                    {entry ? (
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

      {/* Edit Week Dialog */}
      <Dialog open={!!editingWeek} onOpenChange={handleCloseEditDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit Week: {editingWeek ? (() => {
                const weekStart = new Date(editingWeek)
                const weekEnd = new Date(weekStart)
                weekEnd.setDate(weekEnd.getDate() + 6)
                return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d')}`
              })() : ''}
            </DialogTitle>
            <DialogDescription>
              Edit values for manual metrics. Automated metrics are read-only and updated automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {categories.map((category) => {
              const categoryMetrics = metrics.filter(m => m.category_id === category.id)
              const editableMetrics = categoryMetrics.filter(m => !m.is_automated)

              if (editableMetrics.length === 0) return null

              return (
                <div key={category.id} className="space-y-4">
                  <h3 className="text-lg font-semibold border-b pb-2">{category.name}</h3>
                  <div className="space-y-4">
                    {editableMetrics.map((metric) => {
                      const week = weekData.find(w => w.weekStart === editingWeek)
                      const entry = week?.entries.find(e => e.metric_id === metric.id)
                      const editData = editValues[metric.id] || {
                        value: entry?.value.toString() || '0',
                        target: entry?.target_value?.toString() || '',
                        notes: entry?.notes || '',
                      }

                      return (
                        <div key={metric.id} className="space-y-2 p-4 border rounded-lg">
                          <div className="space-y-1">
                            <Label className="font-medium">{metric.name}</Label>
                            {metric.description && (
                              <p className="text-sm text-muted-foreground">{metric.description}</p>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor={`value-${metric.id}`}>
                                Value {metric.unit && `(${metric.unit})`}
                              </Label>
                              <Input
                                id={`value-${metric.id}`}
                                type="number"
                                step="0.01"
                                value={editData.value}
                                onChange={(e) => {
                                  setEditValues(prev => ({
                                    ...prev,
                                    [metric.id]: {
                                      ...prev[metric.id],
                                      value: e.target.value,
                                      target: prev[metric.id]?.target || editData.target,
                                      notes: prev[metric.id]?.notes || editData.notes,
                                    }
                                  }))
                                }}
                                placeholder="Enter value"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`target-${metric.id}`}>
                                Target {metric.unit && `(${metric.unit})`}
                              </Label>
                              <Input
                                id={`target-${metric.id}`}
                                type="number"
                                step="0.01"
                                value={editData.target}
                                onChange={(e) => {
                                  setEditValues(prev => ({
                                    ...prev,
                                    [metric.id]: {
                                      ...prev[metric.id],
                                      value: prev[metric.id]?.value || editData.value,
                                      target: e.target.value,
                                      notes: prev[metric.id]?.notes || editData.notes,
                                    }
                                  }))
                                }}
                                placeholder="Enter target (optional)"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`notes-${metric.id}`}>Notes</Label>
                            <Textarea
                              id={`notes-${metric.id}`}
                              value={editData.notes}
                              onChange={(e) => {
                                setEditValues(prev => ({
                                  ...prev,
                                  [metric.id]: {
                                    ...prev[metric.id],
                                    value: prev[metric.id]?.value || editData.value,
                                    target: prev[metric.id]?.target || editData.target,
                                    notes: e.target.value,
                                  }
                                }))
                              }}
                              placeholder="Add notes..."
                              rows={3}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelEdit}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveWeek}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

