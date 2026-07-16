'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { FolderKanban, AlertCircle, CheckCircle2, Clock, Search, X, Loader2, ChevronRight, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'
import { getProjectsWithTimeTracking, getProjectDetails } from '@/app/actions/projects'
import { cn } from '@/lib/utils'
import { format, parseISO, compareDesc } from 'date-fns'

const INTERNAL_CLIENT_NAME = 'Salo Creative'
/** Pace is "on track" when logged hours are within this fraction of quoted hours of the expected amount */
const PACE_TOLERANCE = 0.1

function isInternalProject(project: { client_name: string | null }) {
  return project.client_name?.toLowerCase() === INTERNAL_CLIENT_NAME.toLowerCase()
}

interface ProjectDesigner {
  id: string
  full_name: string | null
  email: string | null
  hours: number
}

interface Project {
  id: string
  name: string
  client_name: string | null
  completed_date?: string | null
  due_date?: string | null
  created_at?: string | null
  status: 'active' | 'archived' | 'locked'
  quoted_hours: number | null
  total_logged_hours: number
  designers?: ProjectDesigner[]
  tasks: Array<{
    id: string
    name: string
    quoted_hours: number | null
    logged_hours: number
    time_left: number | null
    timeline_start?: string | null
    timeline_end?: string | null
  }>
}

export type ProjectsStatusFilter = 'active' | 'locked'

interface ProjectsClientProps {
  statusFilter: ProjectsStatusFilter
}

function SegmentedSwitch<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; disabled?: boolean }[]
}) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            option.disabled && 'cursor-not-allowed opacity-40',
            value === option.value
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function ProjectsClient({ statusFilter }: ProjectsClientProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [selectedDesigner, setSelectedDesigner] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'clients' | 'internal'>('clients')
  const [filterMode, setFilterMode] = useState<'client' | 'designer'>('client')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectDetails, setProjectDetails] = useState<any>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    setLoading(true)
    try {
      const result = await getProjectsWithTimeTracking()
      if (result.error) {
        console.error('Error loading projects:', result.error)
      } else if (result.projects) {
        setProjects(result.projects)
      }
    } catch (error) {
      console.error('Error loading projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleProjectClick = async (projectId: string) => {
    setSelectedProjectId(projectId)
    setLoadingDetails(true)
    
    try {
      const result = await getProjectDetails(projectId)
      if (result.error) {
        console.error('Error loading project details:', result.error)
      } else if (result.project) {
        console.log('Project details result:', result)
        setProjectDetails({
          project: result.project,
          tasksBreakdown: result.tasksBreakdown || [],
          userTotals: result.userTotals || [],
          latestEntries: result.latestEntries || [],
        })
      }
    } catch (error) {
      console.error('Error loading project details:', error)
    } finally {
      setLoadingDetails(false)
    }
  }

  const handleCloseSheet = () => {
    setSelectedProjectId(null)
    setProjectDetails(null)
  }

  // Filter projects based on search query (but not client/designer filter yet)
  const searchFilteredProjects = useMemo(() => {
    return projects.filter((project) => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      const matchesName = project.name.toLowerCase().includes(q)
      const matchesClient = project.client_name?.toLowerCase().includes(q)
      const matchesDesigner = (project.designers || []).some((d) =>
        (d.full_name || d.email || '').toLowerCase().includes(q)
      )
      return matchesName || matchesClient || matchesDesigner
    })
  }, [projects, searchQuery])

  // Filter by Clients vs Internal (Salo Creative) scope
  const scopeFilteredProjects = useMemo(() => {
    return searchFilteredProjects.filter((project) => {
      const isInternal = isInternalProject(project)
      return viewMode === 'internal' ? isInternal : !isInternal
    })
  }, [searchFilteredProjects, viewMode])

  // Filter projects based on search query, scope, client, and designer
  const filteredProjects = useMemo(() => {
    return scopeFilteredProjects.filter((project) => {
      const matchesClient = !selectedClient || project.client_name === selectedClient
      const matchesDesigner =
        !selectedDesigner ||
        (project.designers || []).some((d) => d.id === selectedDesigner)
      return matchesClient && matchesDesigner
    })
  }, [scopeFilteredProjects, selectedClient, selectedDesigner])

  // Get unique clients for the current tab (Clients mode only — Salo Creative is excluded)
  const getUniqueClients = (statusFilter: 'active' | 'locked') => {
    const filtered = scopeFilteredProjects.filter(p =>
      statusFilter === 'active' ? p.status === 'active' : p.status === 'locked'
    )
    const clients = new Set<string>()
    filtered.forEach(project => {
      if (project.client_name && !isInternalProject(project)) {
        clients.add(project.client_name)
      }
    })
    return Array.from(clients).sort()
  }

  // Designers who have logged time on projects in the current tab/scope (and client filter)
  const getUniqueDesigners = (statusFilter: 'active' | 'locked') => {
    const filtered = scopeFilteredProjects.filter((p) => {
      const matchesStatus = statusFilter === 'active' ? p.status === 'active' : p.status === 'locked'
      const matchesClient = !selectedClient || p.client_name === selectedClient
      return matchesStatus && matchesClient
    })
    const byId = new Map<string, ProjectDesigner>()
    filtered.forEach((project) => {
      ;(project.designers || []).forEach((designer) => {
        if (!byId.has(designer.id)) {
          byId.set(designer.id, designer)
        }
      })
    })
    return Array.from(byId.values()).sort((a, b) => {
      const nameA = a.full_name || a.email || ''
      const nameB = b.full_name || b.email || ''
      return nameA.localeCompare(nameB)
    })
  }

  const handleViewModeChange = (mode: 'clients' | 'internal') => {
    setViewMode(mode)
    setSelectedClient(null)
    setSelectedDesigner(null)
    if (mode === 'internal') {
      setFilterMode('designer')
    }
  }

  const handleFilterModeChange = (mode: 'client' | 'designer') => {
    setFilterMode(mode)
    setSelectedClient(null)
    setSelectedDesigner(null)
  }

  const isLive = statusFilter === 'active'
  const statusProjects = filteredProjects.filter((p) =>
    statusFilter === 'active' ? p.status === 'active' : p.status === 'locked'
  )
  const availableClients = getUniqueClients(statusFilter)
  const availableDesigners = getUniqueDesigners(statusFilter)

  const hasActiveFilters = Boolean(searchQuery || selectedClient || selectedDesigner)

  return (
    <>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading projects...</p>
          </div>
        ) : (
          <>
            <div className="mb-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <SegmentedSwitch
                    value={viewMode}
                    onChange={handleViewModeChange}
                    options={[
                      { value: 'clients', label: 'Client Projects' },
                      { value: 'internal', label: 'Salo Projects' },
                    ]}
                  />
                  {viewMode === 'clients' && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground whitespace-nowrap">Show by</span>
                      <SegmentedSwitch
                        value={filterMode}
                        onChange={handleFilterModeChange}
                        options={[
                          { value: 'client', label: 'Client' },
                          { value: 'designer', label: 'Designer' },
                        ]}
                      />
                    </div>
                  )}
                </div>
                <div className="relative w-full sm:w-56 shrink-0">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 pl-8 pr-8 text-sm"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                      onClick={() => setSearchQuery('')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {filterMode === 'client' && viewMode === 'clients' && (
                <ClientFilters
                  clients={availableClients}
                  selectedClient={selectedClient}
                  onSelectClient={setSelectedClient}
                />
              )}

              {filterMode === 'designer' && (
                <DesignerFilters
                  designers={availableDesigners}
                  selectedDesigner={selectedDesigner}
                  onSelectDesigner={setSelectedDesigner}
                />
              )}
            </div>

            {statusProjects.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium">
                    {hasActiveFilters
                      ? 'No matching projects'
                      : isLive
                        ? viewMode === 'internal'
                          ? 'No live internal projects'
                          : 'No live projects'
                        : viewMode === 'internal'
                          ? 'No completed internal projects'
                          : 'No completed projects'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {hasActiveFilters
                      ? 'Try adjusting your search or filter criteria'
                      : isLive
                        ? viewMode === 'internal'
                          ? 'Salo Creative projects will appear here once synced from Monday.com'
                          : 'Active projects will appear here once synced from Monday.com'
                        : viewMode === 'internal'
                          ? 'Completed Salo Creative projects will appear here'
                          : 'Completed projects (from completed boards) will appear here'}
                  </p>
                </CardContent>
              </Card>
            ) : isLive ? (
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {statusProjects
                      .sort((a, b) => {
                        const healthA = getProjectHealth(a)
                        const healthB = getProjectHealth(b)
                        const severity = (h: ReturnType<typeof getProjectHealth>) => {
                          if (h.pace === 'over-budget') return 0
                          if (h.pace === 'ahead') return 1
                          if (h.pace === 'behind') return 2
                          if (h.pace === 'on-pace') return 3
                          return 4
                        }
                        const diff = severity(healthA) - severity(healthB)
                        if (diff !== 0) return diff
                        return a.name.localeCompare(b.name)
                      })
                      .map((project) => (
                        <ProjectListItem
                          key={project.id}
                          project={project}
                          onClick={() => handleProjectClick(project.id)}
                          showHealth
                        />
                      ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              (() => {
                const completedProjects = [...statusProjects].sort((a, b) => {
                  if (!a.completed_date && !b.completed_date) {
                    return a.name.localeCompare(b.name)
                  }
                  if (!a.completed_date) return 1
                  if (!b.completed_date) return -1
                  return compareDesc(parseISO(a.completed_date), parseISO(b.completed_date))
                })

                const groupedByMonth = new Map<string, Project[]>()

                completedProjects.forEach((project) => {
                  let monthKey = 'No Date'
                  if (project.completed_date) {
                    const date = parseISO(project.completed_date)
                    monthKey = format(date, 'MMMM yyyy')
                  }

                  if (!groupedByMonth.has(monthKey)) {
                    groupedByMonth.set(monthKey, [])
                  }
                  groupedByMonth.get(monthKey)!.push(project)
                })

                const sortedMonths = Array.from(groupedByMonth.keys()).sort((a, b) => {
                  if (a === 'No Date') return 1
                  if (b === 'No Date') return -1
                  try {
                    const dateA = parseISO(a + '-01')
                    const dateB = parseISO(b + '-01')
                    return compareDesc(dateA, dateB)
                  } catch {
                    return a.localeCompare(b)
                  }
                })

                return (
                  <div className="space-y-6">
                    {sortedMonths.map((monthKey) => {
                      const monthProjects = groupedByMonth.get(monthKey) || []
                      return (
                        <div key={monthKey}>
                          <h3 className="text-sm font-semibold text-muted-foreground mb-3 px-1">
                            {monthKey}
                          </h3>
                          <Card>
                            <CardContent className="p-0">
                              <div className="divide-y">
                                {monthProjects.map((project) => (
                                  <ProjectListItem
                                    key={project.id}
                                    project={project}
                                    onClick={() => handleProjectClick(project.id)}
                                  />
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      )
                    })}
                  </div>
                )
              })()
            )}
          </>
        )}

        {/* Project Details Sheet */}
        <Sheet open={selectedProjectId !== null} onOpenChange={(open) => !open && handleCloseSheet()}>
          <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
            <div className="p-6">
            <SheetHeader className="pb-4 px-0">
              <SheetTitle className="text-lg">
                {loadingDetails ? 'Loading...' : projectDetails?.project.name || 'Project Details'}
              </SheetTitle>
              {!loadingDetails && projectDetails?.project.client_name && (
                <SheetDescription className="text-sm">
                  {projectDetails.project.client_name}
                </SheetDescription>
              )}
            </SheetHeader>
            
            {loadingDetails ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : projectDetails ? (
              <div className="space-y-4">
                {(() => {
                  const totalQuotedFromTasks = projectDetails.tasksBreakdown.reduce(
                    (sum: number, task: { quotedHours: number | null }) =>
                      sum + (task.quotedHours || 0),
                    0
                  )
                  const projectQuotedHours =
                    totalQuotedFromTasks > 0
                      ? totalQuotedFromTasks
                      : projectDetails.project.quoted_hours

                  return (
                    <>
                {/* Tasks Breakdown */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Tasks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {projectDetails.tasksBreakdown && projectDetails.tasksBreakdown.length > 0 ? (
                      <div className="divide-y">
                        {projectDetails.tasksBreakdown.map((task: any) => (
                          <div key={task.id} className="py-2.5 first:pt-0 last:pb-0">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{task.name}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-muted-foreground">
                                    {task.loggedHours.toFixed(1)}h logged
                                  </span>
                                  {task.quotedHours !== null && (
                                    <>
                                      <span className="text-xs text-muted-foreground">/</span>
                                      <span className="text-xs text-muted-foreground">
                                        {task.quotedHours.toFixed(1)}h quoted
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {task.percentage !== null && (
                                  <span className={cn(
                                    "text-xs font-semibold whitespace-nowrap",
                                    budgetPercentageTextClass(task.percentage)
                                  )}>
                                    {formatBudgetPercentage(task.percentage)}
                                  </span>
                                )}
                                {task.quotedHours !== null && task.percentage !== null && (
                                  <Progress 
                                    value={budgetProgressValue(task.percentage)} 
                                    className={cn('h-1.5 w-16', budgetProgressBarClass(task.percentage))}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No tasks found</p>
                    )}
                  </CardContent>
                </Card>

                {/* Time Totals by User */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Time by Team Member</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {projectDetails.userTotals.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No time entries yet</p>
                    ) : (
                      <div className="divide-y">
                        {projectDetails.userTotals.map((user: any) => {
                          const userPercentage = projectQuotedHours
                            ? (user.totalHours / projectQuotedHours) * 100
                            : null

                          return (
                          <div key={user.userId} className="py-2.5 first:pt-0 last:pb-0">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium">{user.userName}</div>
                                {user.userEmail && (
                                  <div className="text-xs text-muted-foreground truncate">{user.userEmail}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  <div className="text-sm font-semibold">{user.totalHours.toFixed(1)}h</div>
                                  {userPercentage !== null && (
                                    <div className={cn(
                                      'text-xs font-semibold',
                                      budgetPercentageTextClass(userPercentage)
                                    )}>
                                      {formatBudgetPercentage(userPercentage)}
                                    </div>
                                  )}
                                </div>
                                {userPercentage !== null && (
                                  <Progress 
                                    value={budgetProgressValue(userPercentage)} 
                                    className={cn('h-1.5 w-16', budgetProgressBarClass(userPercentage))}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Latest Time Entries */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Latest Entries</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {projectDetails.latestEntries.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No time entries yet</p>
                    ) : (
                      <div className="divide-y">
                        {projectDetails.latestEntries.map((entry: any) => (
                          <div key={entry.id} className="py-2 first:pt-0 last:pb-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="text-xs font-medium truncate">{entry.taskName}</span>
                                  <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">
                                    {entry.hours.toFixed(1)}h
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>{entry.userName}</span>
                                  <span>·</span>
                                  <span>{format(parseISO(entry.date), 'MMM d')}</span>
                                </div>
                                {entry.notes && (
                                  <div className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                                    "{entry.notes}"
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
                    </>
                  )
                })()}
                </div>
            ) : null}
            </div>
          </SheetContent>
        </Sheet>
    </>
  )
}

function getProjectStats(project: Project) {
  // Calculate totals from tasks
  // Note: This calculation works the same for both active and locked/completed projects
  // Time entries are preserved for completed projects to enable historical reflection
  const totalQuotedHoursFromTasks = project.tasks.reduce((sum, task) => sum + (task.quoted_hours || 0), 0)
  const totalLoggedHours = project.total_logged_hours
  
  // Use project-level quoted_hours as fallback if task totals are 0
  // This is important for completed projects where task data might have been cleared
  const totalQuotedHours = totalQuotedHoursFromTasks > 0 
    ? totalQuotedHoursFromTasks 
    : (project.quoted_hours || 0)
  
  // Calculate percentage - if no quoted hours but we have logged hours, show as over budget
  const percentage = totalQuotedHours > 0 
    ? (totalLoggedHours / totalQuotedHours) * 100 
    : (totalLoggedHours > 0 ? Infinity : 0) // Show as over budget if we have hours but no quoted hours
  
  const status = getStatus(percentage)
  const isOverBudget = percentage > 100 || (totalQuotedHours === 0 && totalLoggedHours > 0)

  return {
    totalQuotedHours,
    totalLoggedHours,
    percentage,
    status,
    isOverBudget,
  }
}

type ProjectPace = 'on-pace' | 'ahead' | 'behind' | 'over-budget' | 'no-timeline'

function getProjectHealth(project: Project) {
  const { totalQuotedHours, totalLoggedHours, percentage, isOverBudget } = getProjectStats(project)

  const startTimes = project.tasks
    .map((t) => t.timeline_start)
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime())
  const endTimes = project.tasks
    .map((t) => t.timeline_end)
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime())

  const startMs = startTimes.length > 0
    ? Math.min(...startTimes)
    : project.created_at
      ? new Date(project.created_at).getTime()
      : null

  let endMs = endTimes.length > 0
    ? Math.max(...endTimes)
    : project.due_date
      ? new Date(project.due_date).getTime()
      : null

  if (project.status === 'locked' && project.completed_date) {
    endMs = new Date(project.completed_date).getTime()
  }

  if (startMs === null || endMs === null || endMs <= startMs || totalQuotedHours <= 0) {
    return {
      pace: (isOverBudget ? 'over-budget' : 'no-timeline') as ProjectPace,
      timelineProgress: null as number | null,
      expectedHours: null as number | null,
      varianceHours: null as number | null,
      totalQuotedHours,
      totalLoggedHours,
      percentage,
      isOverBudget,
    }
  }

  const referenceMs = project.status === 'locked' && project.completed_date
    ? new Date(project.completed_date).getTime()
    : Date.now()

  const totalDuration = endMs - startMs
  const elapsed = Math.min(Math.max(referenceMs - startMs, 0), totalDuration)
  const timelineProgress = elapsed / totalDuration
  const expectedHours = totalQuotedHours * timelineProgress
  const varianceHours = totalLoggedHours - expectedHours
  const varianceRatio = varianceHours / totalQuotedHours

  let pace: ProjectPace
  if (isOverBudget) {
    pace = 'over-budget'
  } else if (Math.abs(varianceRatio) <= PACE_TOLERANCE) {
    pace = 'on-pace'
  } else if (varianceHours > 0) {
    pace = 'ahead'
  } else {
    pace = 'behind'
  }

  return {
    pace,
    timelineProgress,
    expectedHours,
    varianceHours,
    totalQuotedHours,
    totalLoggedHours,
    percentage,
    isOverBudget,
  }
}

function ProjectListItem({
  project,
  onClick,
  showHealth = false,
}: {
  project: Project
  onClick: () => void
  showHealth?: boolean
}) {
  const stats = getProjectStats(project)
  const health = showHealth ? getProjectHealth(project) : null
  const { totalQuotedHours, totalLoggedHours, percentage, status, isOverBudget } = stats
  const designers = project.designers || []

  return (
    <button
      onClick={onClick}
      className="w-full px-6 py-4 flex items-center justify-between gap-4 hover:bg-accent transition-colors text-left"
    >
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-base truncate">{project.name}</div>
            {project.client_name && (
              <div className="text-sm text-muted-foreground mt-0.5 truncate">
                {project.client_name}
              </div>
            )}
          </div>
          {project.status === 'locked' && (
            <Badge variant="outline" className="bg-muted text-xs shrink-0">
              Completed
            </Badge>
          )}
          {showHealth && health && <HealthBadge health={health} />}
        </div>

        {designers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {designers.map((designer) => (
              <Badge
                key={designer.id}
                variant="secondary"
                className="font-normal text-xs"
                title={`${designerDisplayName(designer)} · ${designer.hours.toFixed(1)}h`}
              >
                {designerShortName(designer)}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Time:</span>
            <span className="font-medium">
              {totalLoggedHours.toFixed(1)}h / {totalQuotedHours.toFixed(1)}h
            </span>
            <span className={cn(
              "font-semibold",
              percentage > 100 ? "text-destructive" : "text-muted-foreground"
            )}>
              {Number.isFinite(percentage) ? `${percentage.toFixed(0)}%` : '—'}
            </span>
          </div>
          {showHealth && health && health.timelineProgress !== null && health.expectedHours !== null && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>
                Timeline {(health.timelineProgress * 100).toFixed(0)}%
              </span>
              <span>·</span>
              <span>Expected {health.expectedHours.toFixed(1)}h</span>
              {health.varianceHours !== null && Math.abs(health.varianceHours) >= 0.05 && (
                <>
                  <span>·</span>
                  <span className={cn(
                    health.pace === 'ahead' || health.pace === 'over-budget'
                      ? 'text-destructive'
                      : health.pace === 'behind'
                        ? 'text-amber-600'
                        : undefined
                  )}>
                    {health.varianceHours > 0 ? '+' : ''}
                    {health.varianceHours.toFixed(1)}h vs pace
                  </span>
                </>
              )}
            </div>
          )}
          {!showHealth && (
            <div className="flex items-center gap-1.5">
              {status === 'over' && (
                <>
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">Over budget</span>
                </>
              )}
              {status === 'on-track' && (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-600">On track</span>
                </>
              )}
              {status === 'under' && (
                <>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Under budget</span>
                </>
              )}
            </div>
          )}
        </div>

        <Progress
          value={Math.min(100, Number.isFinite(percentage) ? percentage : 0)}
          className={cn(
            "h-1.5 max-w-md",
            (isOverBudget || percentage > 100) && "bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive"
          )}
        />
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
    </button>
  )
}

function HealthBadge({ health }: { health: ReturnType<typeof getProjectHealth> }) {
  const config = {
    'over-budget': {
      label: 'Over budget',
      className: 'border-destructive/30 bg-destructive/10 text-destructive',
      icon: AlertCircle,
    },
    ahead: {
      label: 'Ahead of pace',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      icon: TrendingUp,
    },
    behind: {
      label: 'Behind pace',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      icon: TrendingDown,
    },
    'on-pace': {
      label: 'On pace',
      className: 'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400',
      icon: CheckCircle2,
    },
    'no-timeline': {
      label: 'No timeline',
      className: 'border-muted-foreground/20 bg-muted text-muted-foreground',
      icon: AlertTriangle,
    },
  }[health.pace]

  const Icon = config.icon

  return (
    <Badge variant="outline" className={cn('shrink-0 gap-1 font-medium', config.className)}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </Badge>
  )
}

function getStatus(percentage: number): 'over' | 'on-track' | 'under' {
  if (percentage >= 100) return 'over'
  if (percentage >= 80) return 'on-track'
  return 'under'
}

function formatBudgetPercentage(percentage: number) {
  if (!Number.isFinite(percentage)) return '—'
  return `${percentage.toFixed(0)}%`
}

function budgetPercentageTextClass(percentage: number) {
  if (!Number.isFinite(percentage) || percentage >= 100) return 'text-destructive'
  if (percentage >= 80) return 'text-green-600'
  return 'text-muted-foreground'
}

function budgetProgressValue(percentage: number) {
  if (!Number.isFinite(percentage)) return 100
  return Math.min(100, percentage)
}

function budgetProgressBarClass(percentage: number) {
  if (!Number.isFinite(percentage) || percentage >= 100) {
    return 'bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive'
  }
  return undefined
}

function designerDisplayName(designer: ProjectDesigner) {
  return designer.full_name || designer.email || 'Unknown'
}

function designerShortName(designer: ProjectDesigner) {
  const name = designer.full_name || designer.email || '?'
  return name.split(/\s+/)[0]
}

function ClientFilters({
  clients,
  selectedClient,
  onSelectClient,
}: {
  clients: string[]
  selectedClient: string | null
  onSelectClient: (client: string | null) => void
}) {
  if (clients.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={selectedClient === null ? 'default' : 'outline'}
        size="sm"
        onClick={() => onSelectClient(null)}
        className="h-8"
      >
        All
      </Button>
      {clients.map((client) => (
        <Button
          key={client}
          variant={selectedClient === client ? 'default' : 'outline'}
          size="sm"
          onClick={() => onSelectClient(selectedClient === client ? null : client)}
          className="h-8"
        >
          {client}
        </Button>
      ))}
    </div>
  )
}

function DesignerFilters({
  designers,
  selectedDesigner,
  onSelectDesigner,
}: {
  designers: ProjectDesigner[]
  selectedDesigner: string | null
  onSelectDesigner: (designerId: string | null) => void
}) {
  if (designers.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={selectedDesigner === null ? 'default' : 'outline'}
        size="sm"
        onClick={() => onSelectDesigner(null)}
        className="h-8"
      >
        All
      </Button>
      {designers.map((designer) => (
        <Button
          key={designer.id}
          variant={selectedDesigner === designer.id ? 'default' : 'outline'}
          size="sm"
          onClick={() =>
            onSelectDesigner(selectedDesigner === designer.id ? null : designer.id)
          }
          className="h-8"
        >
          {designerDisplayName(designer)}
        </Button>
      ))}
    </div>
  )
}

