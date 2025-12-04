'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Trash2 } from 'lucide-react'
import { format, addDays, startOfDay, isSameDay, getDay, nextMonday, isWeekend } from 'date-fns'
import { getProjectsWithTasks, getTimeEntries, deleteTimeEntry } from '@/app/actions/time-tracking'
import { ProjectTaskSelector } from './components/project-task-selector'
import { TimeEntryForm } from './components/time-entry-form'
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

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    loadTimeEntries()
  }, [selectedDate])

  async function loadData() {
    setLoading(true)
    try {
      const result = await getProjectsWithTasks()
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
          />
        ) : (
          <CalendarView getHoursRemaining={getHoursRemaining} />
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
        />
      )}
    </div>
  )
}

function CalendarView({
  getHoursRemaining,
}: {
  getHoursRemaining: (date: Date) => number
}) {
  const [selectedMonth, setSelectedMonth] = useState(new Date())

  return (
    <div className="w-full">
      <Card>
        <CardHeader>
          <CardTitle>Calendar View</CardTitle>
          <CardDescription>View hours remaining for each day</CardDescription>
        </CardHeader>
        <CardContent>
          <Calendar
            mode="single"
            month={selectedMonth}
            onMonthChange={setSelectedMonth}
            className="rounded-md border"
          />
          <div className="mt-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              Hours remaining for selected month:
            </p>
            <div className="text-xs text-muted-foreground">
              Calendar view with hours remaining coming soon
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
