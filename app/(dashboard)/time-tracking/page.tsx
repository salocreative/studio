'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Trash2 } from 'lucide-react'
import { format, addDays, startOfDay, isSameDay, getDay, nextMonday, isWeekend, startOfMonth, endOfMonth, eachDayOfInterval, getDaysInMonth, addMonths, subMonths } from 'date-fns'
import { getProjectsWithTasks, getTimeEntries, deleteTimeEntry } from '@/app/actions/time-tracking'
import { ProjectTaskSelector } from './components/project-task-selector'
import { TimeEntryForm } from './components/time-entry-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Task {
  id: string
  name: string
  quoted_hours?: number | null
  is_favorite?: boolean
}

interface Project {
  id: string
  name: string
  client_name?: string | null
  status?: 'active' | 'archived' | 'locked'
  tasks: Task[]
}

interface TimeEntry {
  id: string
  hours: number
  notes?: string | null
  date: string
  task: Task
  project: Project & { status?: 'active' | 'archived' | 'locked' }
}

export default function TimeTrackingPage() {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [view, setView] = useState<'daily' | 'calendar'>('daily')
  const [projects, setProjects] = useState<Project[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [boardType, setBoardType] = useState<'main' | 'flexi-design'>('main')

  useEffect(() => {
    loadData()
  }, [boardType])

  useEffect(() => {
    loadTimeEntries()
  }, [selectedDate])

  async function loadData() {
    setLoading(true)
    try {
      const result = await getProjectsWithTasks(boardType)
      if (result.error) {
        console.error('Error loading projects:', result.error)
      } else if (result.projects) {
        setProjects(result.projects)
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadTimeEntries() {
    const dateStr = format(selectedDate, 'yyyy-MM-dd')
    try {
      const result = await getTimeEntries(dateStr, dateStr)
      if (result.error) {
        console.error('Error loading time entries:', result.error)
      } else if (result.entries) {
        setTimeEntries(result.entries as TimeEntry[])
      }
    } catch (error) {
      console.error('Error loading time entries:', error)
    }
  }

  const handleDateChange = (days: number) => {
    setSelectedDate((prev) => {
      let newDate = addDays(prev, days)
      // Skip weekends: if moving forward and landing on weekend, go to Monday
      // If moving backward and landing on weekend, go to Friday
      if (days > 0 && isWeekend(newDate)) {
        newDate = nextMonday(newDate)
      } else if (days < 0 && isWeekend(newDate)) {
        // Go to previous Friday if we land on a weekend going backwards
        const dayOfWeek = getDay(newDate)
        if (dayOfWeek === 0) { // Sunday
          newDate = addDays(newDate, -2)
        } else if (dayOfWeek === 6) { // Saturday
          newDate = addDays(newDate, -1)
        }
      }
      return newDate
    })
  }

  const getHoursLogged = () => {
    return timeEntries.reduce((sum, entry) => sum + entry.hours, 0)
  }

  const getHoursRemaining = (date: Date) => {
    // This will be used for calendar view - for now just use daily view logic
    const logged = getHoursLogged()
    return Math.max(0, 6 - logged)
  }
  

  const handleSelectTask = (task: Task, project: Project) => {
    setSelectedTask(task)
    setSelectedProject(project)
  }

  const handleTimeEntrySuccess = () => {
    setSelectedTask(null)
    setSelectedProject(null)
    loadTimeEntries()
    loadData() // Refresh favorites
  }

  const handleDeleteEntry = async (entryId: string) => {
    // Find the entry to check if project is locked
    const entry = timeEntries.find(e => e.id === entryId)
    if (entry && entry.project.status === 'locked') {
      toast.error('Cannot delete time entries for locked projects')
      return
    }

    if (!confirm('Are you sure you want to delete this time entry?')) {
      return
    }

    try {
      const result = await deleteTimeEntry(entryId)
      if (result.error) {
        toast.error('Error deleting entry', { description: result.error })
      } else {
        toast.success('Time entry deleted')
        loadTimeEntries()
      }
    } catch (error) {
      console.error('Error deleting entry:', error)
      toast.error('Error deleting entry', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const hoursLogged = getHoursLogged()
  const hoursRemaining = Math.max(0, 6 - hoursLogged)

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-2xl font-semibold">Time Tracking</h1>
            <p className="text-sm text-muted-foreground">Track your time against projects</p>
          </div>
          <div className="flex items-center gap-2">
            {/* View Switcher */}
            <Button
              variant={view === 'daily' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setView('daily')}
            >
              <Clock className="mr-2 h-4 w-4" />
              Daily
            </Button>
            <Button
              variant={view === 'calendar' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setView('calendar')}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              Calendar
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {view === 'daily' ? (
          <DailyView
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
            onDateSelect={setSelectedDate}
            hoursLogged={hoursLogged}
            hoursRemaining={hoursRemaining}
            projects={projects}
            timeEntries={timeEntries}
            onSelectTask={handleSelectTask}
            onDeleteEntry={handleDeleteEntry}
            loading={loading}
            boardType={boardType}
            onBoardTypeChange={setBoardType}
          />
        ) : (
          <CalendarView
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
            onDeleteEntry={handleDeleteEntry}
            projects={projects}
            onSelectTask={handleSelectTask}
            boardType={boardType}
            onBoardTypeChange={setBoardType}
            onTimeEntrySuccess={handleTimeEntrySuccess}
          />
        )}
      </div>

      {selectedTask && selectedProject && (
        <TimeEntryForm
          task={selectedTask}
          project={selectedProject}
          date={format(selectedDate, 'yyyy-MM-dd')}
          onSuccess={handleTimeEntrySuccess}
          onCancel={() => {
            setSelectedTask(null)
            setSelectedProject(null)
          }}
        />
      )}
    </div>
  )
}

function DailyView({
  selectedDate,
  onDateChange,
  onDateSelect,
  hoursLogged,
  hoursRemaining,
  projects,
  timeEntries,
  onSelectTask,
  onDeleteEntry,
  loading,
  boardType,
  onBoardTypeChange,
}: {
  selectedDate: Date
  onDateChange: (days: number) => void
  onDateSelect: (date: Date) => void
  hoursLogged: number
  hoursRemaining: number
  projects: Project[]
  timeEntries: TimeEntry[]
  onSelectTask: (task: Task, project: Project) => void
  onDeleteEntry: (entryId: string) => void
  loading: boolean
  boardType: 'main' | 'flexi-design'
  onBoardTypeChange: (boardType: 'main' | 'flexi-design') => void
}) {
  return (
    <div className="space-y-6">
      {/* Date Navigation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{format(selectedDate, 'EEEE, MMMM d, yyyy')}</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => onDateChange(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  let today = startOfDay(new Date())
                  // If today is a weekend, move to the next Monday
                  if (isWeekend(today)) {
                    today = nextMonday(today)
                  }
                  onDateSelect(today)
                }}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onDateChange(1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardDescription>
            {hoursLogged} hours logged • {hoursRemaining} hours remaining (target: 6 hours/day)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {timeEntries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No time entries for this date</p>
                <p className="text-sm mt-2">Select a task below to log time</p>
              </div>
            ) : (
              <div className="space-y-2">
                {timeEntries.map((entry) => {
                  const isLocked = entry.project.status === 'locked'
                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        "flex items-center justify-between p-4 border rounded-lg",
                        isLocked && "opacity-75 bg-muted/30"
                      )}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{entry.task.name}</div>
                          {isLocked && (
                            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                              Locked
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {entry.project.name}
                          {entry.project.client_name && ` • ${entry.project.client_name}`}
                        </div>
                        {entry.notes && (
                          <div className="text-sm text-muted-foreground mt-1">
                            {entry.notes}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-medium">{entry.hours}h</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(entry.date), 'MMM d')}
                          </div>
                        </div>
                        {!isLocked && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDeleteEntry(entry.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Project Selection */}
      {loading ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              Loading projects...
            </div>
          </CardContent>
        </Card>
      ) : (
        <ProjectTaskSelector
          projects={projects}
          onSelectTask={onSelectTask}
          boardType={boardType}
          onBoardTypeChange={onBoardTypeChange}
        />
      )}
    </div>
  )
}

function CalendarView({
  selectedDate,
  onDateSelect,
  onDeleteEntry,
  projects,
  onSelectTask,
  boardType,
  onBoardTypeChange,
  onTimeEntrySuccess,
}: {
  selectedDate: Date
  onDateSelect: (date: Date) => void
  onDeleteEntry: (entryId: string) => void
  projects: Project[]
  onSelectTask: (task: Task, project: Project) => void
  boardType: 'main' | 'flexi-design'
  onBoardTypeChange: (boardType: 'main' | 'flexi-design') => void
  onTimeEntrySuccess: () => void
}) {
  const [selectedMonth, setSelectedMonth] = useState(new Date())
  const [monthTimeEntries, setMonthTimeEntries] = useState<Record<string, number>>({})
  const [allTimeEntries, setAllTimeEntries] = useState<TimeEntry[]>([])
  const [selectedDateEntries, setSelectedDateEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadTrigger, setReloadTrigger] = useState(0)
  const [showLogTimeDialog, setShowLogTimeDialog] = useState(false)
  const [calendarTask, setCalendarTask] = useState<Task | null>(null)
  const [calendarProject, setCalendarProject] = useState<Project | null>(null)

  const handleDeleteEntry = async (entryId: string) => {
    await onDeleteEntry(entryId)
    // Trigger reload of month entries after deletion
    setReloadTrigger(prev => prev + 1)
  }

  const handleTaskSelect = (task: Task, project: Project) => {
    setCalendarTask(task)
    setCalendarProject(project)
    setShowLogTimeDialog(false)
  }

  const handleCalendarTimeEntrySuccess = () => {
    // Ensure we're viewing the month that contains the selected date
    const selectedMonthValue = startOfMonth(selectedDate)
    const currentMonthValue = startOfMonth(selectedMonth)
    if (selectedMonthValue.getTime() !== currentMonthValue.getTime()) {
      setSelectedMonth(selectedMonthValue)
    }
    // Reload calendar data - this will trigger the useEffect to reload entries
    setReloadTrigger(prev => prev + 1)
    // Call parent success handler (which might do other things)
    onTimeEntrySuccess()
    // Clear selected task/project
    setCalendarTask(null)
    setCalendarProject(null)
  }

  // Fetch time entries for the entire month
  useEffect(() => {
    async function loadMonthTimeEntries() {
      setLoading(true)
      try {
        const monthStart = startOfMonth(selectedMonth)
        const monthEnd = endOfMonth(selectedMonth)
        const startDateStr = format(monthStart, 'yyyy-MM-dd')
        const endDateStr = format(monthEnd, 'yyyy-MM-dd')
        
        const result = await getTimeEntries(startDateStr, endDateStr)
        if (result.error) {
          console.error('Error loading month time entries:', result.error)
          setMonthTimeEntries({})
          setAllTimeEntries([])
        } else if (result.entries) {
          const entries = result.entries as TimeEntry[]
          setAllTimeEntries(entries)
          
          // Aggregate hours by date
          const hoursByDate: Record<string, number> = {}
          entries.forEach((entry: TimeEntry) => {
            const dateKey = entry.date
            hoursByDate[dateKey] = (hoursByDate[dateKey] || 0) + entry.hours
          })
          setMonthTimeEntries(hoursByDate)
        }
      } catch (error) {
        console.error('Error loading month time entries:', error)
        setMonthTimeEntries({})
        setAllTimeEntries([])
      } finally {
        setLoading(false)
      }
    }

    loadMonthTimeEntries()
  }, [selectedMonth, reloadTrigger])

  // Load time entries for selected date
  useEffect(() => {
    const dateKey = format(selectedDate, 'yyyy-MM-dd')
    const entriesForDate = allTimeEntries.filter(entry => entry.date === dateKey)
    setSelectedDateEntries(entriesForDate)
  }, [selectedDate, allTimeEntries])

  const handleMonthChange = (direction: 'prev' | 'next') => {
    setSelectedMonth((prev) => {
      return direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1)
    })
  }

  const monthStart = startOfMonth(selectedMonth)
  const monthEnd = endOfMonth(selectedMonth)
  const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd })
  
  // Filter out weekends and group by week
  const weekdays = allDays.filter(day => !isWeekend(day))
  const weeks: Date[][] = []
  let currentWeek: Date[] = []
  
  weekdays.forEach((day, index) => {
    const dayOfWeek = getDay(day) // 0 = Sunday, 1 = Monday, etc.
    
    // Start a new week on Monday
    if (dayOfWeek === 1 && currentWeek.length > 0) {
      weeks.push(currentWeek)
      currentWeek = [day]
    } else {
      currentWeek.push(day)
    }
    
    // Push the last week at the end
    if (index === weekdays.length - 1) {
      weeks.push(currentWeek)
    }
  })

  const getHoursForDate = (date: Date): number => {
    const dateKey = format(date, 'yyyy-MM-dd')
    return monthTimeEntries[dateKey] || 0
  }

  const isToday = (date: Date): boolean => {
    return isSameDay(date, new Date())
  }

  const isSelected = (date: Date): boolean => {
    return isSameDay(date, selectedDate)
  }

  const selectedDateHours = getHoursForDate(selectedDate)

  return (
    <div className="w-full max-w-[1400px] mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calendar - Left Column */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{format(selectedMonth, 'MMMM yyyy')}</CardTitle>
                <CardDescription>Click a day to view tasks</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleMonthChange('prev')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const today = startOfDay(new Date())
                    setSelectedMonth(today)
                    if (!isWeekend(today)) {
                      onDateSelect(today)
                    }
                  }}
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleMonthChange('next')}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center text-muted-foreground">
                  Loading calendar...
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Weekday headers */}
                <div className="grid grid-cols-5 gap-3">
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day) => (
                    <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
                      {day.slice(0, 3)}
                    </div>
                  ))}
                </div>

                {/* Calendar grid */}
                <div className="space-y-3">
                  {weeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="grid grid-cols-5 gap-3">
                      {week.map((day) => {
                        const hours = getHoursForDate(day)
                        const daySelected = isSelected(day)
                        const dayToday = isToday(day)
                        
                        return (
                          <button
                            key={day.toISOString()}
                            onClick={() => onDateSelect(day)}
                            className={cn(
                              "relative p-4 border rounded-lg text-left transition-all hover:border-primary hover:shadow-sm min-h-[100px]",
                              daySelected && "border-primary ring-2 ring-primary/20 bg-primary/5",
                              dayToday && !daySelected && "border-primary/50 bg-primary/5",
                              hours === 0 && "bg-muted/30 border-dashed"
                            )}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="font-semibold text-sm">
                                {format(day, 'd')}
                              </div>
                              {dayToday && (
                                <div className="w-2 h-2 bg-primary rounded-full" />
                              )}
                            </div>
                            <div className={cn(
                              "text-2xl font-bold",
                              hours === 0 ? "text-muted-foreground" : "text-foreground"
                            )}>
                              {hours > 0 ? hours.toFixed(1) : '0'}h
                            </div>
                            {hours === 0 && (
                              <div className="text-xs text-muted-foreground mt-1">
                                No time logged
                              </div>
                            )}
                          </button>
                        )
                      })}
                      {/* Pad with empty cells if week has fewer than 5 days */}
                      {Array.from({ length: 5 - week.length }).map((_, i) => (
                        <div key={`empty-${i}`} className="min-h-[100px]" />
                      ))}
                    </div>
                  ))}
                </div>

                {/* Legend */}
                <div className="flex items-center justify-center gap-6 pt-4 border-t text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border rounded border-dashed bg-muted/30" />
                    <span>No time logged</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border rounded border-primary bg-primary/5" />
                    <span>Today</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 rounded border-primary ring-2 ring-primary/20 bg-primary/5" />
                    <span>Selected</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Task List - Right Column */}
        <Card>
          <CardHeader>
            <CardTitle>{format(selectedDate, 'EEEE, MMMM d, yyyy')}</CardTitle>
            <CardDescription>
              {selectedDateHours > 0 
                ? `${selectedDateHours.toFixed(1)} hours logged • ${Math.max(0, 6 - selectedDateHours).toFixed(1)} hours remaining`
                : 'No time logged for this date'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedDateEntries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground space-y-4">
                <p>No time entries for this date</p>
                <Button onClick={() => setShowLogTimeDialog(true)}>
                  <Clock className="mr-2 h-4 w-4" />
                  Log Time
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {selectedDateEntries.map((entry) => {
                    const isLocked = entry.project.status === 'locked'
                    return (
                      <div
                        key={entry.id}
                        className={cn(
                          "flex items-center justify-between p-4 border rounded-lg",
                          isLocked && "opacity-75 bg-muted/30"
                        )}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{entry.task.name}</div>
                            {isLocked && (
                              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                                Locked
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {entry.project.name}
                            {entry.project.client_name && ` • ${entry.project.client_name}`}
                          </div>
                          {entry.notes && (
                            <div className="text-sm text-muted-foreground mt-1">
                              {entry.notes}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="font-medium">{entry.hours}h</div>
                          </div>
                          {!isLocked && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteEntry(entry.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <Button 
                  onClick={() => setShowLogTimeDialog(true)}
                  className="w-full"
                  variant="outline"
                >
                  <Clock className="mr-2 h-4 w-4" />
                  Log Time
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Log Time Dialog */}
      <Dialog open={showLogTimeDialog} onOpenChange={setShowLogTimeDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select Project & Task</DialogTitle>
            <DialogDescription>
              Choose a project and task to log time for {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </DialogDescription>
          </DialogHeader>
          <ProjectTaskSelector
            projects={projects}
            onSelectTask={handleTaskSelect}
            boardType={boardType}
            onBoardTypeChange={onBoardTypeChange}
            hideClientFilters={true}
          />
        </DialogContent>
      </Dialog>

      {/* Time Entry Form for Calendar View */}
      {calendarTask && calendarProject && (
        <TimeEntryForm
          task={calendarTask}
          project={calendarProject}
          date={format(selectedDate, 'yyyy-MM-dd')}
          onSuccess={handleCalendarTimeEntrySuccess}
          onCancel={() => {
            setCalendarTask(null)
            setCalendarProject(null)
          }}
        />
      )}
    </div>
  )
}
