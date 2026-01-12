'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
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

      // Then load the retainer data using public version
      const dataResult = await getRetainerDataPublic(shareResult.client.client_name)
      if (dataResult.error) {
        setError(dataResult.error)
      } else if (dataResult.success && dataResult.data) {
        setMonthlyData(dataResult.data)
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

  function getMonthTotalHours(monthData: MonthlyProjectData): number {
    return monthData.projects.reduce((total, project) => {
      return total + project.tasks.reduce((taskTotal, task) => {
        return taskTotal + task.total_hours
      }, 0)
    }, 0)
  }

  function getProjectTotalHours(project: MonthlyProjectData['projects'][0]): number {
    return project.tasks.reduce((total, task) => total + task.total_hours, 0)
  }

  function getHoursByDay(monthData: MonthlyProjectData): Map<string, number> {
    const hoursByDay = new Map<string, number>()
    
    monthData.projects.forEach(project => {
      project.tasks.forEach(task => {
        task.time_entries.forEach(entry => {
          const dateKey = entry.date // YYYY-MM-DD format
          const currentHours = hoursByDay.get(dateKey) || 0
          hoursByDay.set(dateKey, currentHours + entry.hours)
        })
      })
    })
    
    return hoursByDay
  }

  function renderCalendar(monthKey: string, hoursByDay: Map<string, number>) {
    const monthStart = startOfMonth(parseISO(`${monthKey}-01`))
    const monthEnd = endOfMonth(monthStart)
    const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd })
    
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
                const hours = hoursByDay.get(dateKey) || 0
                const isToday = isSameDay(day, new Date())
                
                return (
                  <div
                    key={dateKey}
                    className={cn(
                      "aspect-square border rounded-lg p-2 flex flex-col items-center justify-center",
                      hours > 0 ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-dashed",
                      isToday && "ring-2 ring-primary/50"
                    )}
                  >
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      {format(day, 'd')}
                    </div>
                    <div className={cn(
                      "text-lg font-bold",
                      hours > 0 ? "text-foreground" : "text-muted-foreground"
                    )}>
                      {hours > 0 ? hours.toFixed(1) : '0'}h
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
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
            <Accordion type="multiple" className="w-full space-y-4">
              {monthlyData.map((monthData) => {
                const monthTotalHours = getMonthTotalHours(monthData)
                const monthLabel = formatMonth(monthData.month)

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
                                {monthData.projects.length} project{monthData.projects.length !== 1 ? 's' : ''} • {monthTotalHours.toFixed(1)} hours
                              </CardDescription>
                            </div>
                          </div>
                          <Badge variant="secondary" className="ml-auto">
                            {monthTotalHours.toFixed(1)}h
                          </Badge>
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
                                const projectTotalHours = getProjectTotalHours(project)
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
                                      <p className="text-lg font-bold">{projectTotalHours.toFixed(1)}h</p>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>

                          {/* Calendar View */}
                          <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                              Daily Hours
                            </h3>
                            {renderCalendar(monthData.month, getHoursByDay(monthData))}
                          </div>
                        </CardContent>
                      </AccordionContent>
                    </AccordionItem>
                  </Card>
                )
              })}
            </Accordion>
          )}
        </div>
      </div>
    </div>
  )
}

