'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Calendar, Clock } from 'lucide-react'
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { getRetainerClientByToken } from '@/app/actions/retainers'
import { getRetainerDataPublic } from '@/app/actions/retainers-public'
import type { MonthlyProjectData } from '@/app/actions/retainers'

interface RetainerShareClientProps {
  shareToken: string
}

export default function RetainerShareClient({ shareToken }: RetainerShareClientProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string>('')
  const [monthlyData, setMonthlyData] = useState<MonthlyProjectData[]>([])
  const [monthlyHours, setMonthlyHours] = useState<number | null>(null)
  const [rolloverHours, setRolloverHours] = useState<number | null>(null)
  const [agreedDaysPerWeek, setAgreedDaysPerWeek] = useState<number | null>(null)
  const [agreedDaysPerMonth, setAgreedDaysPerMonth] = useState<number | null>(null)
  const [hoursPerDay, setHoursPerDay] = useState<number | null>(null)
  const [remainingProjectHours, setRemainingProjectHours] = useState<number>(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [showDateDialog, setShowDateDialog] = useState(false)

  useEffect(() => {
    loadData()
  }, [shareToken])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      // First, validate the share token and get client info
      const shareResult = await getRetainerClientByToken(shareToken)
      if (shareResult.error || !shareResult.success) {
        setError(shareResult.error || 'Invalid or expired share link')
        setLoading(false)
        return
      }

      if (!shareResult.client) {
        setError('Client not found')
        setLoading(false)
        return
      }

      setClientName(shareResult.client.client_name)
      setMonthlyHours(shareResult.client.monthly_hours || null)
      setRolloverHours(shareResult.client.rollover_hours || null)
      setAgreedDaysPerWeek(shareResult.client.agreed_days_per_week || null)
      setAgreedDaysPerMonth(shareResult.client.agreed_days_per_month || null)
      setHoursPerDay(shareResult.client.hours_per_day || null)

      // Then load the retainer data using public version
      const dataResult = await getRetainerDataPublic(shareResult.client.client_name)
      if (dataResult.error) {
        setError(dataResult.error)
      } else if (dataResult.success && dataResult.data) {
        setMonthlyData(dataResult.data)
        setRemainingProjectHours(dataResult.remaining_project_hours ?? 0)
      }
    } catch (error) {
      console.error('Error loading share data:', error)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  function formatMonth(monthKey: string): string {
    try {
      const date = parseISO(`${monthKey}-01`)
      return format(date, 'MMMM yyyy')
    } catch {
      return monthKey
    }
  }

  function formatDate(dateString: string): string {
    try {
      return format(parseISO(dateString), 'MMM d, yyyy')
    } catch {
      return dateString
    }
  }

  // Convert hours to days using the configured hours_per_day
  function hoursToDays(hours: number): number {
    const hoursPerWorkingDay = hoursPerDay || 6 // Default to 6 if not set
    return hours / hoursPerWorkingDay
  }

  // Format days for display
  function formatDays(days: number): string {
    if (days === 0) return '0.0'
    return days.toFixed(1)
  }

  function getMonthTotalDays(monthData: MonthlyProjectData): number {
    const totalHours = monthData.projects.reduce((total, project) => {
      return total + project.tasks.reduce((taskTotal, task) => {
        return taskTotal + task.total_hours
      }, 0)
    }, 0)
    return hoursToDays(totalHours)
  }

  function getProjectTotalDays(project: MonthlyProjectData['projects'][0]): number {
    const totalHours = project.tasks.reduce((total, task) => total + task.total_hours, 0)
    return hoursToDays(totalHours)
  }

  function getMonthTotalRolloverDays(monthData: MonthlyProjectData): number {
    const daysSplitByDay = getDaysSplitByDay(monthData)
    let totalRollover = 0
    daysSplitByDay.forEach((split) => {
      totalRollover += split.rolloverDays
    })
    return totalRollover
  }

  function getDaysByDay(monthData: MonthlyProjectData): Map<string, number> {
    const daysByDay = new Map<string, number>()
    
    monthData.projects.forEach(project => {
      project.tasks.forEach(task => {
        task.time_entries.forEach(entry => {
          const dateKey = entry.date // YYYY-MM-DD format
          const currentDays = daysByDay.get(dateKey) || 0
          daysByDay.set(dateKey, currentDays + hoursToDays(entry.hours))
        })
      })
    })
    
    return daysByDay
  }

  /**
   * Calculate monthly vs rollover hours split for each day in the month
   * Uses per-day allocation: daily_allocation = monthly_hours / agreed_days
   * Any hours over the daily allocation on a given day come from rollover
   * Returns a map of date -> { monthlyDays, rolloverDays, totalDays }
   * (converted from hours to days)
   */
  function getDaysSplitByDay(monthData: MonthlyProjectData): Map<string, { monthlyDays: number; rolloverDays: number; totalDays: number }> {
    const splitByDay = new Map<string, { monthlyDays: number; rolloverDays: number; totalDays: number }>()
    
    // Daily allocation is based on hours_per_day setting, not calculated from monthly_hours / agreed_days
    // The agreed days is just informational - the actual daily cap is hours_per_day
    const rolloverHoursAllocation = rolloverHours || 0
    const dailyAllocation = hoursPerDay || 6 // Default to 6 if not set
    
    // Get all time entries grouped by date
    const entriesByDate = new Map<string, number>()
    monthData.projects.forEach(project => {
      project.tasks.forEach(task => {
        task.time_entries.forEach(entry => {
          const current = entriesByDate.get(entry.date) || 0
          entriesByDate.set(entry.date, current + entry.hours)
        })
      })
    })
    
    // Track cumulative rollover usage to respect the limit
    let cumulativeRolloverUsed = 0
    
    // Process each day
    const sortedDates = Array.from(entriesByDate.keys()).sort()
    
    sortedDates.forEach(dateKey => {
      const dayHours = entriesByDate.get(dateKey) || 0
      
      // Per-day allocation: monthly = min(dayHours, dailyAllocation), rollover = excess
      let monthlyHoursUsed = 0
      let rolloverHoursUsed = 0
      
      if (dailyAllocation > 0) {
        // Calculate split for this day
        monthlyHoursUsed = Math.min(dayHours, dailyAllocation)
        const excessHours = Math.max(0, dayHours - dailyAllocation)
        
        // Check if we can use rollover for the excess
        const rolloverAvailable = Math.max(0, rolloverHoursAllocation - cumulativeRolloverUsed)
        rolloverHoursUsed = Math.min(excessHours, rolloverAvailable)
        cumulativeRolloverUsed += rolloverHoursUsed
      } else {
        // No daily allocation configured - all hours go to monthly (legacy behavior)
        monthlyHoursUsed = dayHours
      }
      
      splitByDay.set(dateKey, {
        monthlyDays: hoursToDays(monthlyHoursUsed),
        rolloverDays: hoursToDays(rolloverHoursUsed),
        totalDays: hoursToDays(dayHours),
      })
    })
    
    return splitByDay
  }

  function getDateBreakdown(dateKey: string, monthData: MonthlyProjectData) {
    const breakdown: Array<{
      projectName: string
      taskName: string
      days: number
      user_name: string | null
      notes: string | null
    }> = []

    monthData.projects.forEach(project => {
      project.tasks.forEach(task => {
        task.time_entries.forEach(entry => {
          if (entry.date === dateKey) {
            breakdown.push({
              projectName: project.name,
              taskName: task.name,
              days: hoursToDays(entry.hours),
              user_name: entry.user_name,
              notes: entry.notes,
            })
          }
        })
      })
    })

    return breakdown
  }

  function handleDateClick(dateKey: string, monthData: MonthlyProjectData) {
    const breakdown = getDateBreakdown(dateKey, monthData)
    if (breakdown.length > 0) {
      setSelectedDate(dateKey)
      setShowDateDialog(true)
    }
  }

  function renderCalendar(monthKey: string, daysByDay: Map<string, number>, monthData: MonthlyProjectData) {
    const monthStart = startOfMonth(parseISO(`${monthKey}-01`))
    const monthEnd = endOfMonth(monthStart)
    const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd })
    
    // Get the split data for this month
    const daysSplitByDay = getDaysSplitByDay(monthData)
    
    // Create a grid with 5 columns (Monday to Friday)
    const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    
    // Map weekday number to column index (Monday=1 -> 0, Tuesday=2 -> 1, etc.)
    const getColumnIndex = (dayOfWeek: number): number | null => {
      // Sunday = 0, Monday = 1, ..., Saturday = 6
      if (dayOfWeek === 0 || dayOfWeek === 6) return null // Skip weekends
      return dayOfWeek - 1 // Monday (1) -> 0, Tuesday (2) -> 1, etc.
    }
    
    // Create a 2D grid: rows of 5 columns
    const calendarGrid: (Date | null)[][] = []
    let currentRow: (Date | null)[] = Array(5).fill(null)
    
    allDays.forEach(day => {
      const dayOfWeek = getDay(day)
      const colIndex = getColumnIndex(dayOfWeek)
      
      if (colIndex !== null) {
        // If it's Monday (column 0) and we already have days in the current row, start a new row
        if (colIndex === 0 && currentRow.some(cell => cell !== null)) {
          calendarGrid.push(currentRow)
          currentRow = Array(5).fill(null)
        }
        currentRow[colIndex] = day
      }
    })
    
    // Add the last row if it has any days
    if (currentRow.some(cell => cell !== null)) {
      calendarGrid.push(currentRow)
    }
    
    return (
      <div className="space-y-2">
        {/* Weekday headers */}
        <div className="grid grid-cols-5 gap-2 mb-2">
          {weekdayLabels.map((day) => (
            <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar grid */}
        <div className="space-y-2">
          {calendarGrid.map((row, rowIndex) => (
            <div key={rowIndex} className="grid grid-cols-5 gap-2">
              {row.map((day, colIndex) => {
                if (!day) {
                  return <div key={`empty-${colIndex}`} className="aspect-square" />
                }
                
                const dateKey = format(day, 'yyyy-MM-dd')
                const days = daysByDay.get(dateKey) || 0
                const split = daysSplitByDay.get(dateKey)
                const isToday = isSameDay(day, new Date())
                const hasTimeEntries = days > 0
                const hasRollover = split && split.rolloverDays > 0
                
                return (
                  <div
                    key={dateKey}
                    onClick={() => hasTimeEntries && handleDateClick(dateKey, monthData)}
                    className={cn(
                      "aspect-square border rounded-lg p-2 flex flex-col items-center justify-center relative",
                      hasTimeEntries ? "bg-primary/5 border-primary/20 cursor-pointer hover:bg-primary/10 transition-colors" : "bg-muted/30 border-dashed",
                      hasRollover && "border-orange-500/50 bg-orange-50/50 dark:bg-orange-950/20",
                      isToday && "ring-2 ring-primary/50"
                    )}
                  >
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      {format(day, 'd')}
                    </div>
                    {hasTimeEntries && split ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="text-sm font-bold text-foreground">
                          {formatDays(split.totalDays)}d
                        </div>
                        {split.rolloverDays > 0 && (
                          <div className="text-[10px] font-medium text-orange-600 dark:text-orange-400">
                            +{formatDays(split.rolloverDays)} overflow
                          </div>
                        )}
                        {split.monthlyDays > 0 && split.rolloverDays === 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            monthly
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-lg font-bold text-muted-foreground">
                        0.0d
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        
        {/* Legend */}
        {(monthlyHours || rolloverHours) && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded border border-primary/20 bg-primary/5" />
              <span>Monthly days</span>
            </div>
            {rolloverHours && rolloverHours > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded border border-orange-500/50 bg-orange-50/50 dark:bg-orange-950/20" />
                <span>Overflow days</span>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="container mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold">{clientName || 'Retainer Report'}</h1>
          <p className="text-muted-foreground mt-1">
            Monthly project breakdown and time tracking
          </p>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-lg font-medium mb-2 text-destructive">Error</p>
                <p className="text-sm text-muted-foreground text-center">{error}</p>
              </CardContent>
            </Card>
          ) : monthlyData.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">No data available</p>
                <p className="text-sm text-muted-foreground text-center">
                  No projects or time entries found.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary Section */}
              <Card>
                <CardHeader>
                  <CardTitle>Capacity Overview</CardTitle>
                  <CardDescription>
                    Remaining days and capacity analysis for active projects
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Remaining Project Days */}
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">
                        Remaining Project Days
                      </div>
                      <div className="text-2xl font-bold">
                        {formatDays(hoursToDays(remainingProjectHours))}d
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Days left to complete on active projects
                      </div>
                    </div>
                    
                    {/* Current Month Capacity */}
                    {(() => {
                      const currentMonthKey = format(startOfMonth(new Date()), 'yyyy-MM')
                      const currentMonthData = monthlyData.find(m => m.month === currentMonthKey)
                      const currentMonthDays = currentMonthData ? getMonthTotalDays(currentMonthData) : 0
                      const availableDays = monthlyHours ? hoursToDays(monthlyHours) : 0
                      const currentMonthCapacity = availableDays > 0 ? availableDays - currentMonthDays : null
                      
                      return (
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-muted-foreground">
                            Current Month Capacity Remaining
                          </div>
                          <div className="text-2xl font-bold">
                            {currentMonthCapacity !== null ? `${formatDays(currentMonthCapacity)}d` : 'N/A'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {availableDays > 0 ? `${formatDays(availableDays)}d allocated, ${formatDays(currentMonthDays)}d used` : 'No monthly hours set'}
                          </div>
                        </div>
                      )
                    })()}
                    
                    {/* Current Month Rollover Days Remaining */}
                    {(() => {
                      const currentMonthKey = format(startOfMonth(new Date()), 'yyyy-MM')
                      const currentMonthData = monthlyData.find(m => m.month === currentMonthKey)
                      const currentMonthRollover = currentMonthData ? getMonthTotalRolloverDays(currentMonthData) : 0
                      const rolloverRemaining = rolloverHours ? hoursToDays(rolloverHours) - currentMonthRollover : null
                      
                      return (
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-muted-foreground">
                            Overflow Days Remaining
                          </div>
                          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                            {rolloverRemaining !== null ? `${formatDays(Math.max(0, rolloverRemaining))}d` : 'N/A'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {rolloverHours ? `${formatDays(hoursToDays(rolloverHours))}d total, ${formatDays(currentMonthRollover)}d used` : 'No overflow hours set'}
                          </div>
                        </div>
                      )
                    })()}
                    
                    {/* Likelihood to Fill Capacity */}
                    {(() => {
                      const currentMonthKey = format(startOfMonth(new Date()), 'yyyy-MM')
                      const currentMonthData = monthlyData.find(m => m.month === currentMonthKey)
                      const currentMonthDays = currentMonthData ? getMonthTotalDays(currentMonthData) : 0
                      const availableDays = monthlyHours ? hoursToDays(monthlyHours) : 0
                      const currentMonthCapacity = availableDays > 0 ? availableDays - currentMonthDays : null
                      const remainingProjectDays = hoursToDays(remainingProjectHours)
                      
                      let likelihoodText = 'N/A'
                      let likelihoodColor = 'text-muted-foreground'
                      
                      if (currentMonthCapacity !== null && currentMonthCapacity > 0) {
                        if (remainingProjectDays >= currentMonthCapacity) {
                          likelihoodText = 'Very Likely'
                          likelihoodColor = 'text-green-600'
                        } else if (remainingProjectDays >= currentMonthCapacity * 0.7) {
                          likelihoodText = 'Likely'
                          likelihoodColor = 'text-green-500'
                        } else if (remainingProjectDays >= currentMonthCapacity * 0.4) {
                          likelihoodText = 'Possible'
                          likelihoodColor = 'text-yellow-600'
                        } else {
                          likelihoodText = 'Unlikely'
                          likelihoodColor = 'text-orange-600'
                        }
                      }
                      
                      return (
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-muted-foreground">
                            Likelihood to Fill Capacity
                          </div>
                          <div className={`text-2xl font-bold ${likelihoodColor}`}>
                            {likelihoodText}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Based on remaining project days vs. capacity
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </CardContent>
              </Card>

              <Accordion type="multiple" className="w-full space-y-4">
                {monthlyData.map((monthData) => {
                const monthTotalDays = getMonthTotalDays(monthData)
                const monthTotalRollover = getMonthTotalRolloverDays(monthData)
                const monthLabel = formatMonth(monthData.month)
                
                // Calculate progress for this month (convert monthly_hours to days)
                const availableDays = monthlyHours ? hoursToDays(monthlyHours) : 0
                const progressPercentage = availableDays > 0 
                  ? Math.min((monthTotalDays / availableDays) * 100, 100)
                  : 0

                return (
                  <Card key={monthData.month}>
                    <AccordionItem value={monthData.month} className="border-0">
                      <AccordionTrigger className="px-6 py-4 hover:no-underline">
                        <div className="flex items-center justify-between w-full pr-4">
                          <div className="flex items-center gap-4">
                            <Calendar className="h-5 w-5 text-muted-foreground" />
                            <div className="text-left">
                              <CardTitle className="text-lg">{monthLabel}</CardTitle>
                              <CardDescription className="mt-0">
                                {monthData.projects.length} project{monthData.projects.length !== 1 ? 's' : ''} • {formatDays(monthTotalDays)} days
                                {availableDays > 0 && ` of ${formatDays(availableDays)}`}
                                {monthTotalRollover > 0 && (
                                  <span className="text-orange-600 dark:text-orange-400 ml-1">
                                    • {formatDays(monthTotalRollover)}d overflow
                                  </span>
                                )}
                              </CardDescription>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {availableDays > 0 && (
                              <div className="flex flex-col items-end gap-1 min-w-[120px]">
                                <div className="text-sm font-medium">
                                  {formatDays(monthTotalDays)}d / {formatDays(availableDays)}d
                                </div>
                                <Progress value={progressPercentage} className="w-full h-2" />
                              </div>
                            )}
                            <Badge variant="secondary" className={cn(
                              availableDays > 0 && monthTotalDays > availableDays && "bg-destructive/10 text-destructive"
                            )}>
                              {formatDays(monthTotalDays)}d
                            </Badge>
                            {monthTotalRollover > 0 && (
                              <Badge variant="outline" className="border-orange-500/50 text-orange-600 dark:text-orange-400">
                                {formatDays(monthTotalRollover)}d overflow
                              </Badge>
                            )}
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <CardContent className="pt-0 space-y-6">
                          {/* Project List */}
                          <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                              Projects
                            </h3>
                            <div className="space-y-2">
                              {monthData.projects.map((project) => {
                                const projectTotalDays = getProjectTotalDays(project)
                                return (
                                  <div
                                    key={project.id}
                                    className="flex items-center justify-between p-3 border rounded-lg"
                                  >
                                    <div className="flex items-center gap-3">
                                      <div>
                                        <p className="font-medium">{project.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {project.status}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-lg font-bold">{formatDays(projectTotalDays)}d</p>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>

                          {/* Calendar View */}
                          <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                              Daily
                            </h3>
                            {renderCalendar(monthData.month, getDaysByDay(monthData), monthData)}
                          </div>
                        </CardContent>
                      </AccordionContent>
                    </AccordionItem>
                  </Card>
                )
              })}
              </Accordion>
            </>
          )}
        </div>
      </div>

      {/* Date Breakdown Dialog */}
      <Dialog open={showDateDialog} onOpenChange={setShowDateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedDate && formatDate(selectedDate)}
            </DialogTitle>
            <DialogDescription>
              Project breakdown and time logged for this date
            </DialogDescription>
          </DialogHeader>

          {selectedDate && (() => {
            const monthKey = selectedDate.substring(0, 7) // YYYY-MM
            const monthData = monthlyData.find(m => m.month === monthKey)
            if (!monthData) return null

            const breakdown = getDateBreakdown(selectedDate, monthData)
            const totalDays = breakdown.reduce((sum, item) => sum + item.days, 0)
            
            // Get the split for this date
            const daysSplitByDay = getDaysSplitByDay(monthData)
            const split = daysSplitByDay.get(selectedDate)
            
            // Group by project
            const byProject = breakdown.reduce((acc, item) => {
              if (!acc[item.projectName]) {
                acc[item.projectName] = []
              }
              acc[item.projectName].push(item)
              return acc
            }, {} as Record<string, typeof breakdown>)

            return (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <span className="font-medium">Total Days</span>
                    <span className="text-2xl font-bold">{formatDays(totalDays)}d</span>
                  </div>
                  {split && (split.monthlyDays > 0 || split.rolloverDays > 0) && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <div className="text-xs text-muted-foreground mb-1">Monthly Days</div>
                        <div className="text-lg font-bold">{formatDays(split.monthlyDays)}d</div>
                      </div>
                      {split.rolloverDays > 0 && (
                        <div className="p-3 bg-orange-50/50 dark:bg-orange-950/20 border border-orange-500/50 rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">Overflow Days</div>
                          <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
                            {formatDays(split.rolloverDays)}d
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                  {Object.entries(byProject).map(([projectName, items]) => {
                    const projectDays = items.reduce((sum, item) => sum + item.days, 0)
                    return (
                      <div key={projectName} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold">{projectName}</h4>
                          <Badge variant="secondary">{formatDays(projectDays)}d</Badge>
                        </div>
                        <div className="space-y-2">
                          {items.map((item, idx) => (
                            <div key={idx} className="flex items-start justify-between gap-4 p-2 bg-muted/50 rounded">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">{item.taskName}</div>
                                {item.user_name && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {item.user_name}
                                  </div>
                                )}
                                {item.notes && (
                                  <div className="text-xs text-muted-foreground mt-1 italic">
                                    {item.notes}
                                  </div>
                                )}
                              </div>
                              <div className="text-sm font-semibold whitespace-nowrap">
                                {formatDays(item.days)}d
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}

