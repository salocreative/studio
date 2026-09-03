'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { format, addDays, startOfDay, isSameDay, getDay, nextMonday, isWeekend, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, parseISO } from 'date-fns'
import {
  getProjectsWithTasks,
  getTimeEntries,
  deleteTimeEntry,
} from '@/app/actions/time-tracking'
import { ProjectTaskSelector } from './components/project-task-selector'
import { TimeEntryForm } from './components/time-entry-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type BoardType = 'main' | 'flexi-design'

interface Task {
  id: string
  name: string
  quoted_hours?: number | null
  logged_hours?: number | null
  time_left?: number | null
  /** Derived server-side from the Monday status column; null when the task has no status column. */
  is_completed?: boolean | null
  is_favorite?: boolean
}

interface Project {
  id: string
  name: string
  client_name?: string | null
  quoted_hours?: number | null
  total_logged_hours?: number | null
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

interface User {
  id: string
  email: string
  full_name: string | null
}

/**
 * The first paint's data, fetched by the server component rather than by an effect after
 * hydration. `date` is the day the server fetched for (UK time) and `monthEntries` covers
 * the whole month containing it, matching how the client caches entries.
 */
export interface TimeTrackingInitialData {
  date: string
  isAdmin: boolean
  users: User[]
  projects: Project[]
  monthEntries: TimeEntry[]
}

/**
 * Identifies a cached month of time entries: which month, and whose.
 *
 * Entries are fetched and cached a month at a time rather than a day at a time. Moving
 * between days within a month is then a client-side slice instead of a server action —
 * each of those cost three sequential network round trips (the middleware's auth check,
 * the action's own, then the query), which is what made day navigation feel unresponsive.
 */
function monthKeyFor(date: Date, userId?: string) {
  return `${format(date, 'yyyy-MM')}|${userId ?? ''}`
}

export function TimeTrackingClient({ initial }: { initial: TimeTrackingInitialData }) {
  /** Same shape as `monthKeyFor(parseISO(initial.date), undefined)`, without the parse. */
  const initialMonthKey = `${initial.date.slice(0, 7)}|`

  const [selectedDate, setSelectedDate] = useState(() => parseISO(initial.date))
  /** The month the calendar grid is browsing, which need not contain `selectedDate`. */
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(parseISO(initial.date)))
  const [view, setView] = useState<'daily' | 'calendar'>('daily')
  /** Projects cached per board, so switching back to a board is instant. Main arrives from
   *  the server, so the first render has no loading state. */
  const [projectsByBoard, setProjectsByBoard] = useState<Partial<Record<BoardType, Project[]>>>(
    () => ({ main: initial.projects })
  )
  /** Time entries cached per `monthKeyFor`; `undefined` means "not fetched yet". */
  const [entriesByMonth, setEntriesByMonth] = useState<Record<string, TimeEntry[]>>(
    () => ({ [initialMonthKey]: initial.monthEntries })
  )
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [boardType, setBoardType] = useState<BoardType>('main')
  /** Both fixed for the session, so they stay props rather than state. */
  const isAdmin = initial.isAdmin
  const users = initial.users
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncStatus, setSyncStatus] = useState('')
  const [existingTimeEntry, setExistingTimeEntry] = useState<{
    id: string
    hours: number
    notes?: string | null
  } | null>(null)

  /** Boards with a fetch in flight, so a board selected twice in quick succession or a
   *  refresh landing mid-fetch doesn't queue a second request for it. */
  const inFlightBoards = useRef<Set<BoardType>>(new Set())
  /** Month keys already fetched or in flight, keyed to the request that is loading them.
   *  Seeded with the month the server already fetched, so the month effect below treats it
   *  as loaded rather than requesting it again on mount. */
  const monthRequestsRef = useRef<Map<string, Promise<void>>>(
    new Map([[initialMonthKey, Promise.resolve()]])
  )
  /** Newest request per month key, so a superseded response can't commit stale entries. */
  const latestMonthRequestRef = useRef<Map<string, number>>(new Map())
  const requestCounterRef = useRef(0)

  const projects = projectsByBoard[boardType] ?? []
  const projectsLoading = projectsByBoard[boardType] === undefined

  /**
   * Fetch and cache one month of time entries.
   *
   * Returns the in-flight request for a month already being loaded, so several effects
   * asking for the same month share a single round trip. `force` refetches a cached month
   * after a write.
   */
  const loadMonth = useCallback(
    (month: Date, options?: { force?: boolean }): Promise<void> => {
      const key = monthKeyFor(month, selectedUserId)

      if (options?.force) {
        monthRequestsRef.current.delete(key)
      } else {
        const existing = monthRequestsRef.current.get(key)
        if (existing) return existing
      }

      const requestId = ++requestCounterRef.current
      latestMonthRequestRef.current.set(key, requestId)

      const request = (async () => {
        const startDate = format(startOfMonth(month), 'yyyy-MM-dd')
        const endDate = format(endOfMonth(month), 'yyyy-MM-dd')

        try {
          const result = await getTimeEntries(startDate, endDate, selectedUserId)

          // A newer request for this month has already taken over.
          if (latestMonthRequestRef.current.get(key) !== requestId) return

          if ('error' in result) {
            console.error('Error loading time entries:', result.error)
            // Drop the record so a later attempt can retry, but settle the month so it
            // stops showing the loading state.
            monthRequestsRef.current.delete(key)
            setEntriesByMonth((prev) => ({ ...prev, [key]: prev[key] ?? [] }))
            return
          }

          setEntriesByMonth((prev) => ({ ...prev, [key]: (result.entries ?? []) as TimeEntry[] }))
        } catch (error) {
          console.error('Error loading time entries:', error)
          if (latestMonthRequestRef.current.get(key) !== requestId) return
          monthRequestsRef.current.delete(key)
          setEntriesByMonth((prev) => ({ ...prev, [key]: prev[key] ?? [] }))
        }
      })()

      monthRequestsRef.current.set(key, request)
      return request
    },
    [selectedUserId]
  )

  // Fetch a board's projects the first time it is selected; cached boards render immediately.
  useEffect(() => {
    if (projectsByBoard[boardType] !== undefined) return
    void loadProjects(boardType)
  }, [boardType, projectsByBoard])

  // Keep the month containing the selected day loaded. Day navigation within that month
  // then costs nothing; only crossing a month boundary hits the server.
  useEffect(() => {
    void loadMonth(selectedDate)
  }, [selectedDate, loadMonth])

  // The calendar grid can browse to a month the selected day isn't in.
  useEffect(() => {
    if (view !== 'calendar') return
    void loadMonth(selectedMonth)
  }, [view, selectedMonth, loadMonth])

  async function loadProjects(board: BoardType) {
    if (inFlightBoards.current.has(board)) return
    inFlightBoards.current.add(board)

    try {
      const result = await getProjectsWithTasks(board)
      if ('error' in result) {
        console.error('Error loading projects:', result.error)
        // Settle the board so it stops showing the loading state.
        setProjectsByBoard((prev) => ({ ...prev, [board]: prev[board] ?? [] }))
        return
      }
      setProjectsByBoard((prev) => ({ ...prev, [board]: (result.projects ?? []) as Project[] }))
    } catch (error) {
      console.error('Error loading data:', error)
      setProjectsByBoard((prev) => ({ ...prev, [board]: prev[board] ?? [] }))
    } finally {
      inFlightBoards.current.delete(board)
    }
  }

  const dayMonthEntries = entriesByMonth[monthKeyFor(selectedDate, selectedUserId)]
  /** True until the month containing the selected day has been fetched. */
  const entriesLoading = dayMonthEntries === undefined

  const timeEntries = useMemo(() => {
    if (!dayMonthEntries) return []
    const dateKey = format(selectedDate, 'yyyy-MM-dd')
    return dayMonthEntries.filter((entry) => entry.date === dateKey)
  }, [dayMonthEntries, selectedDate])

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
    setExistingTimeEntry(null)
    setSelectedTask(task)
    setSelectedProject(project)
  }

  function resolveEntryContext(entry: TimeEntry): { task: Task; project: Project } {
    const fullProject =
      projects.find((p) => p.id === entry.project.id) ?? {
        ...entry.project,
        quoted_hours: entry.project.quoted_hours ?? null,
        total_logged_hours: entry.project.total_logged_hours ?? null,
        tasks: [] as Task[],
      }
    const fullTask =
      fullProject.tasks?.find((t) => t.id === entry.task.id) ?? entry.task
    return { task: fullTask, project: fullProject }
  }

  const handleEditEntry = (entry: TimeEntry) => {
    if (entry.project.status === 'locked') {
      toast.error('Cannot edit time entries for locked projects')
      return
    }
    const { task, project } = resolveEntryContext(entry)
    setSelectedTask(task)
    setSelectedProject(project)
    setExistingTimeEntry({
      id: entry.id,
      hours: entry.hours,
      notes: entry.notes ?? null,
    })
  }

  const handleTimeEntrySuccess = () => {
    setSelectedTask(null)
    setSelectedProject(null)
    setExistingTimeEntry(null)
    // The entry was logged against selectedDate, so only that month is stale.
    void loadMonth(selectedDate, { force: true })
    void loadProjects(boardType) // Refresh favourites and logged hours
  }

  const handleQuickSync = async () => {
    setSyncing(true)
    setSyncProgress(0)
    setSyncStatus('Starting sync...')
    try {
      const res = await fetch('/api/sync/monday', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncAllBoards: false }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Sync failed (${res.status})`)
      }
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: {
            phase?: string
            message?: string
            progress?: number
            projectName?: string
            projectIndex?: number
            totalProjects?: number
            projectsSynced?: number
            archived?: number
            deleted?: number
          }
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          setSyncStatus(event.message ?? '')
          if (event.progress != null) setSyncProgress(Math.round(event.progress * 100))
          if (event.phase === 'syncing' && event.projectName) {
            setSyncStatus(`Syncing: ${event.projectName} (${(event.projectIndex ?? 0) + 1} of ${event.totalProjects ?? 0})`)
          }
          if (event.phase === 'error') throw new Error(event.message ?? 'Sync failed')
          if (event.phase === 'complete') {
            setSyncProgress(100)
            const parts = [`Synced ${event.projectsSynced ?? 0} projects`]
            if ((event.archived ?? 0) > 0) parts.push(`${event.archived} archived`)
            if ((event.deleted ?? 0) > 0) parts.push(`${event.deleted} deleted`)
            const completeMessage = parts.join(', ') + ' from Monday.com'
            setSyncStatus(completeMessage)
            await loadProjects(boardType)
            toast.success(completeMessage)
            setTimeout(() => setSyncing(false), 1500)
            return
          }
        }
      }
      setSyncing(false)
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Sync failed')
      toast.error(error instanceof Error ? error.message : 'Sync failed')
      setTimeout(() => setSyncing(false), 2000)
    }
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
      const result = await deleteTimeEntry(entryId, selectedUserId)
      if (result.error) {
        toast.error('Error deleting entry', { description: result.error })
      } else {
        toast.success('Time entry deleted')
        void loadMonth(entry ? parseISO(entry.date) : selectedDate, { force: true })
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
            {/* User Selector (Admin only) */}
            {isAdmin && users.length > 0 && (
              <Select
                value={selectedUserId || 'current'}
                onValueChange={(value) => setSelectedUserId(value === 'current' ? undefined : value)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current User</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
            <Button
              variant="outline"
              size="icon"
              onClick={handleQuickSync}
              disabled={syncing}
              title="Quick sync projects from Monday.com"
            >
              <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
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
            entriesLoading={entriesLoading}
            onSelectTask={handleSelectTask}
            onDeleteEntry={handleDeleteEntry}
            onEditEntry={handleEditEntry}
            loading={projectsLoading}
            boardType={boardType}
            onBoardTypeChange={setBoardType}
          />
        ) : (
          <CalendarView
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            monthEntries={entriesByMonth[monthKeyFor(selectedMonth, selectedUserId)]}
            dayEntries={timeEntries}
            dayEntriesLoading={entriesLoading}
            projectsLoading={projectsLoading}
            onDeleteEntry={handleDeleteEntry}
            projects={projects}
            onEditEntry={handleEditEntry}
            boardType={boardType}
            onBoardTypeChange={setBoardType}
            onTimeEntrySuccess={handleTimeEntrySuccess}
            targetUserId={selectedUserId}
          />
        )}
      </div>

      {/* Quick Sync progress modal */}
      <Dialog open={syncing}>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>Syncing from Monday.com</DialogTitle>
            <DialogDescription>
              {syncStatus || 'Preparing...'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <Progress value={syncProgress} className="h-2" />
          </div>
        </DialogContent>
      </Dialog>

      {selectedTask && selectedProject && (
        <TimeEntryForm
          task={selectedTask}
          project={selectedProject}
          date={format(selectedDate, 'yyyy-MM-dd')}
          onSuccess={handleTimeEntrySuccess}
          onCancel={() => {
            setSelectedTask(null)
            setSelectedProject(null)
            setExistingTimeEntry(null)
          }}
          targetUserId={selectedUserId}
          existingEntry={existingTimeEntry}
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
  entriesLoading,
  onSelectTask,
  onDeleteEntry,
  onEditEntry,
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
  entriesLoading: boolean
  onSelectTask: (task: Task, project: Project) => void
  onDeleteEntry: (entryId: string) => void
  onEditEntry: (entry: TimeEntry) => void
  loading: boolean
  boardType: 'main' | 'flexi-design'
  onBoardTypeChange: (boardType: 'main' | 'flexi-design') => void
}) {
  return (
    <div className="space-y-6">
      {/* Date Navigation */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => onDateChange(-1)}
                className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
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
                className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onDateChange(1)}
                className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <CardDescription className="text-slate-400">
            {entriesLoading
              ? 'Loading entries…'
              : `${hoursLogged} hours logged • ${hoursRemaining} hours remaining (target: 6 hours/day)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {entriesLoading ? (
              // Placeholder rows rather than the previous day's entries, which would read
              // as current data for the newly selected date.
              <div className="space-y-2" aria-busy="true" aria-label="Loading time entries">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4 border rounded-lg bg-background animate-pulse"
                  >
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/3 rounded bg-muted" />
                      <div className="h-3 w-1/2 rounded bg-muted" />
                    </div>
                    <div className="h-4 w-10 rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : timeEntries.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
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
                        "flex items-center justify-between p-4 border rounded-lg bg-background",
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
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Edit time entry"
                              onClick={() => onEditEntry(entry)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete time entry"
                              onClick={() => onDeleteEntry(entry.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
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
      <ProjectTaskSelector
        projects={projects}
        onSelectTask={onSelectTask}
        boardType={boardType}
        onBoardTypeChange={onBoardTypeChange}
        loading={loading}
      />
    </div>
  )
}

function CalendarView({
  selectedDate,
  onDateSelect,
  selectedMonth,
  onMonthChange,
  monthEntries,
  dayEntries,
  dayEntriesLoading,
  projectsLoading,
  onDeleteEntry,
  projects,
  onEditEntry,
  boardType,
  onBoardTypeChange,
  onTimeEntrySuccess,
  targetUserId,
}: {
  selectedDate: Date
  onDateSelect: (date: Date) => void
  selectedMonth: Date
  onMonthChange: (month: Date) => void
  /** Entries for `selectedMonth`; `undefined` while that month is still loading. */
  monthEntries: TimeEntry[] | undefined
  /** Entries for `selectedDate`, which may fall outside the browsed month. */
  dayEntries: TimeEntry[]
  dayEntriesLoading: boolean
  /** Drives the skeleton in the Log Time dialog's project list. */
  projectsLoading: boolean
  onDeleteEntry: (entryId: string) => void
  projects: Project[]
  onEditEntry: (entry: TimeEntry) => void
  boardType: 'main' | 'flexi-design'
  onBoardTypeChange: (boardType: 'main' | 'flexi-design') => void
  onTimeEntrySuccess: () => void
  targetUserId?: string
}) {
  const [showLogTimeDialog, setShowLogTimeDialog] = useState(false)
  const [calendarTask, setCalendarTask] = useState<Task | null>(null)
  const [calendarProject, setCalendarProject] = useState<Project | null>(null)

  const loading = monthEntries === undefined
  const selectedDateEntries = dayEntries

  // Hours per day for the grid, aggregated from the month the parent already has cached.
  const monthTimeEntries = useMemo(() => {
    const hoursByDate: Record<string, number> = {}
    for (const entry of monthEntries ?? []) {
      hoursByDate[entry.date] = (hoursByDate[entry.date] || 0) + entry.hours
    }
    return hoursByDate
  }, [monthEntries])

  const handleTaskSelect = (task: Task, project: Project) => {
    setCalendarTask(task)
    setCalendarProject(project)
    setShowLogTimeDialog(false)
  }

  const handleCalendarTimeEntrySuccess = () => {
    // Ensure we're viewing the month that contains the selected date
    const selectedMonthValue = startOfMonth(selectedDate)
    if (selectedMonthValue.getTime() !== startOfMonth(selectedMonth).getTime()) {
      onMonthChange(selectedMonthValue)
    }
    onTimeEntrySuccess()
    setCalendarTask(null)
    setCalendarProject(null)
  }

  const handleMonthChange = (direction: 'prev' | 'next') => {
    onMonthChange(direction === 'next' ? addMonths(selectedMonth, 1) : subMonths(selectedMonth, 1))
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

  // Summed from the day's own entries, so it stays correct when the grid is browsing
  // a different month to the one the selected day falls in.
  const selectedDateHours = selectedDateEntries.reduce((sum, entry) => sum + entry.hours, 0)

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
                    onMonthChange(startOfMonth(today))
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
              {dayEntriesLoading
                ? 'Loading entries…'
                : selectedDateHours > 0
                  ? `${selectedDateHours.toFixed(1)} hours logged • ${Math.max(0, 6 - selectedDateHours).toFixed(1)} hours remaining`
                  : 'No time logged for this date'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {dayEntriesLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading time entries">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4 border rounded-lg animate-pulse"
                  >
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/3 rounded bg-muted" />
                      <div className="h-3 w-1/2 rounded bg-muted" />
                    </div>
                    <div className="h-4 w-10 rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : selectedDateEntries.length === 0 ? (
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
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Edit time entry"
                                onClick={() => onEditEntry(entry)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Delete time entry"
                                onClick={() => onDeleteEntry(entry.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
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
            loading={projectsLoading}
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
          targetUserId={targetUserId}
        />
      )}
    </div>
  )
}
