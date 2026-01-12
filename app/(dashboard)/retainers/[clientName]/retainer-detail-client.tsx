'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ArrowLeft, Calendar, Clock, Link as LinkIcon, Copy, Check, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from 'date-fns'
import { cn } from '@/lib/utils'
import {
  getRetainerData,
  getRetainerClientIdByName,
  getRetainerShareLinks,
  createRetainerShareLink,
  deactivateShareLink,
  type MonthlyProjectData,
  type RetainerShareLink,
} from '@/app/actions/retainers'

interface RetainerDetailClientProps {
  clientName: string
}

export default function RetainerDetailClient({ clientName }: RetainerDetailClientProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [monthlyData, setMonthlyData] = useState<MonthlyProjectData[]>([])
  const [monthlyHours, setMonthlyHours] = useState<number | null>(null)
  const [rolloverHours, setRolloverHours] = useState<number | null>(null)
  const [remainingProjectHours, setRemainingProjectHours] = useState<number>(0)
  const [shareLinks, setShareLinks] = useState<RetainerShareLink[]>([])
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [creatingLink, setCreatingLink] = useState(false)
  const [copiedLink, setCopiedLink] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [showDateDialog, setShowDateDialog] = useState(false)

  useEffect(() => {
    loadData()
    loadShareLinks()
  }, [clientName])

  async function loadData() {
    setLoading(true)
    try {
      const result = await getRetainerData(clientName)
      if (result.error) {
        toast.error('Error loading retainer data', { description: result.error })
      } else if (result.success && result.data) {
        setMonthlyData(result.data)
        setMonthlyHours(result.monthly_hours ?? null)
        setRolloverHours(result.rollover_hours ?? null)
        setRemainingProjectHours(result.remaining_project_hours ?? 0)
      }
    } catch (error) {
      console.error('Error loading retainer data:', error)
      toast.error('Failed to load retainer data')
    } finally {
      setLoading(false)
    }
  }

  async function loadShareLinks() {
    try {
      const idResult = await getRetainerClientIdByName(clientName)
      if (idResult.error || !idResult.success) {
        return
      }

      const result = await getRetainerShareLinks(idResult.id)
      if (result.error) {
        console.error('Error loading share links:', result.error)
      } else if (result.success && result.shareLinks) {
        setShareLinks(result.shareLinks)
      }
    } catch (error) {
      console.error('Error loading share links:', error)
    }
  }

  async function handleCreateShareLink() {
    setCreatingLink(true)
    try {
      const idResult = await getRetainerClientIdByName(clientName)
      if (idResult.error || !idResult.success) {
        toast.error('Error finding retainer client')
        return
      }

      const result = await createRetainerShareLink(idResult.id)
      if (result.error) {
        toast.error('Error creating share link', { description: result.error })
      } else if (result.success && result.shareLink) {
        const shareUrl = `${window.location.origin}/retainers/share/${result.shareLink.share_token}`
        await navigator.clipboard.writeText(shareUrl)
        setCopiedLink(result.shareLink.id)
        toast.success('Share link created and copied to clipboard')
        await loadShareLinks()
        setShowShareDialog(false)
      }
    } catch (error) {
      console.error('Error creating share link:', error)
      toast.error('Failed to create share link')
    } finally {
      setCreatingLink(false)
    }
  }

  async function handleCopyLink(shareToken: string, linkId: string) {
    const shareUrl = `${window.location.origin}/retainers/share/${shareToken}`
    await navigator.clipboard.writeText(shareUrl)
    setCopiedLink(linkId)
    toast.success('Link copied to clipboard')
    setTimeout(() => setCopiedLink(null), 2000)
  }

  async function handleDeactivateLink(linkId: string) {
    if (!confirm('Are you sure you want to deactivate this share link?')) {
      return
    }

    try {
      const result = await deactivateShareLink(linkId)
      if (result.error) {
        toast.error('Error deactivating link', { description: result.error })
      } else {
        toast.success('Share link deactivated')
        await loadShareLinks()
      }
    } catch (error) {
      console.error('Error deactivating link:', error)
      toast.error('Failed to deactivate share link')
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

  function getDateBreakdown(dateKey: string, monthData: MonthlyProjectData) {
    const breakdown: Array<{
      projectName: string
      taskName: string
      hours: number
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
              hours: entry.hours,
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

  function renderCalendar(monthKey: string, hoursByDay: Map<string, number>, monthData: MonthlyProjectData) {
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
                
                const hasTimeEntries = hours > 0
                
                return (
                  <div
                    key={dateKey}
                    onClick={() => hasTimeEntries && handleDateClick(dateKey, monthData)}
                    className={cn(
                      "aspect-square border rounded-lg p-2 flex flex-col items-center justify-center",
                      hasTimeEntries ? "bg-primary/5 border-primary/20 cursor-pointer hover:bg-primary/10 transition-colors" : "bg-muted/30 border-dashed",
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
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div className="flex items-center gap-4 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/retainers')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-semibold">{clientName}</h1>
              <p className="text-sm text-muted-foreground">
                Monthly project breakdown and time tracking
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowShareDialog(true)}
            >
              <LinkIcon className="h-4 w-4 mr-2" />
              Share
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : monthlyData.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">No data available</p>
                <p className="text-sm text-muted-foreground text-center">
                  No projects or time entries found for this client.
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
                    Remaining hours and capacity analysis for active projects
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Remaining Project Hours */}
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">
                        Remaining Project Hours
                      </div>
                      <div className="text-2xl font-bold">
                        {remainingProjectHours.toFixed(1)}h
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Hours left to complete on active projects
                      </div>
                    </div>
                    
                    {/* Current Month Capacity */}
                    {(() => {
                      const currentMonthKey = format(startOfMonth(new Date()), 'yyyy-MM')
                      const currentMonthData = monthlyData.find(m => m.month === currentMonthKey)
                      const currentMonthHours = currentMonthData ? getMonthTotalHours(currentMonthData) : 0
                      const currentMonthCapacity = monthlyHours ? monthlyHours - currentMonthHours : null
                      
                      return (
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-muted-foreground">
                            Current Month Capacity Remaining
                          </div>
                          <div className="text-2xl font-bold">
                            {currentMonthCapacity !== null ? `${currentMonthCapacity.toFixed(1)}h` : 'N/A'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {monthlyHours ? `${monthlyHours.toFixed(1)}h allocated, ${currentMonthHours.toFixed(1)}h used` : 'No monthly hours set'}
                          </div>
                        </div>
                      )
                    })()}
                    
                    {/* Likelihood to Fill Capacity */}
                    {(() => {
                      const currentMonthKey = format(startOfMonth(new Date()), 'yyyy-MM')
                      const currentMonthData = monthlyData.find(m => m.month === currentMonthKey)
                      const currentMonthHours = currentMonthData ? getMonthTotalHours(currentMonthData) : 0
                      const currentMonthCapacity = monthlyHours ? monthlyHours - currentMonthHours : null
                      
                      let likelihoodText = 'N/A'
                      let likelihoodColor = 'text-muted-foreground'
                      
                      if (currentMonthCapacity !== null && currentMonthCapacity > 0) {
                        if (remainingProjectHours >= currentMonthCapacity) {
                          likelihoodText = 'Very Likely'
                          likelihoodColor = 'text-green-600'
                        } else if (remainingProjectHours >= currentMonthCapacity * 0.7) {
                          likelihoodText = 'Likely'
                          likelihoodColor = 'text-green-500'
                        } else if (remainingProjectHours >= currentMonthCapacity * 0.4) {
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
                            Based on remaining project hours vs. capacity
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </CardContent>
              </Card>

              <Accordion type="multiple" className="w-full space-y-4">
                {monthlyData.map((monthData) => {
                const monthTotalHours = getMonthTotalHours(monthData)
                const monthLabel = formatMonth(monthData.month)
                
                // Calculate progress for this month
                const availableHours = monthlyHours || 0
                const progressPercentage = availableHours > 0 
                  ? Math.min((monthTotalHours / availableHours) * 100, 100)
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
                                {monthData.projects.length} project{monthData.projects.length !== 1 ? 's' : ''} • {monthTotalHours.toFixed(1)} hours
                                {availableHours > 0 && ` of ${availableHours}h`}
                              </CardDescription>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {availableHours > 0 && (
                              <div className="flex flex-col items-end gap-1 min-w-[120px]">
                                <div className="text-sm font-medium">
                                  {monthTotalHours.toFixed(1)}h / {availableHours}h
                                </div>
                                <Progress value={progressPercentage} className="w-full h-2" />
                              </div>
                            )}
                            <Badge variant="secondary" className={cn(
                              availableHours > 0 && monthTotalHours > availableHours && "bg-destructive/10 text-destructive"
                            )}>
                              {monthTotalHours.toFixed(1)}h
                            </Badge>
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
                            {renderCalendar(monthData.month, getHoursByDay(monthData), monthData)}
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
            const totalHours = breakdown.reduce((sum, item) => sum + item.hours, 0)
            
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
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span className="font-medium">Total Hours</span>
                  <span className="text-2xl font-bold">{totalHours.toFixed(1)}h</span>
                </div>

                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                  {Object.entries(byProject).map(([projectName, items]) => {
                    const projectHours = items.reduce((sum, item) => sum + item.hours, 0)
                    return (
                      <div key={projectName} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold">{projectName}</h4>
                          <Badge variant="secondary">{projectHours.toFixed(1)}h</Badge>
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
                                {item.hours.toFixed(1)}h
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

      {/* Share Link Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Retainer Report</DialogTitle>
            <DialogDescription>
              Create a public link to share this retainer report with the client.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {shareLinks.length > 0 && (
              <div className="space-y-2">
                <Label>Active Share Links</Label>
                <div className="space-y-2">
                  {shareLinks.filter(link => link.is_active).map((link) => {
                    const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/retainers/share/${link.share_token}`
                    return (
                      <div key={link.id} className="flex items-center gap-2 p-2 border rounded">
                        <Input value={shareUrl} readOnly className="flex-1 font-mono text-xs" />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopyLink(link.share_token, link.id)}
                        >
                          {copiedLink === link.id ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeactivateLink(link.id)}
                        >
                          <LinkIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowShareDialog(false)}>
                Close
              </Button>
              <Button onClick={handleCreateShareLink} disabled={creatingLink}>
                {creatingLink ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <LinkIcon className="mr-2 h-4 w-4" />
                    Create New Link
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

