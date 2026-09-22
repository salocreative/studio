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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FolderKanban, AlertCircle, CheckCircle2, Search, X, Loader2, AlertTriangle, TrendingUp, TrendingDown, Trash2 } from 'lucide-react'
import { getProjectsWithTimeTracking, getProjectDetails, deleteCompletedProject } from '@/app/actions/projects'
import { ReviewVsMondayButton } from './completed-monday-review'
import { cn } from '@/lib/utils'
import { formatGbp } from '@/lib/billing/invoices'
import { format, parseISO, compareDesc } from 'date-fns'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ALL_FILTER = '__all__'
const SALO_CREATIVE = 'salo creative'
/** Pace is "on track" when logged hours are within this fraction of quoted hours of the expected amount */
const PACE_TOLERANCE = 0.1

function isSaloCreative(value: string | null | undefined) {
  return value?.trim().toLowerCase() === SALO_CREATIVE
}

/** Internal jobs have Salo Creative as both the client and the agency. */
function isInternalJob(project: { client_name: string | null; agency?: string | null }) {
  return isSaloCreative(project.client_name) && isSaloCreative(project.agency)
}

function uniqueSortedNames(values: (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((name): name is string => Boolean(name)))
  ).sort((a, b) => a.localeCompare(b))
}

function withSelected(options: string[], selected: string | null): string[] {
  if (selected && !options.includes(selected)) {
    return [...options, selected].sort((a, b) => a.localeCompare(b))
  }
  return options
}

export type ProjectsStatusFilter = 'active' | 'locked'

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
  agency?: string | null
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

interface ProjectsClientProps {
  statusFilter: ProjectsStatusFilter
  canDelete?: boolean
}

export function ProjectsClient({ statusFilter, canDelete = false }: ProjectsClientProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [selectedAgency, setSelectedAgency] = useState<string | null>(null)
  const [selectedDesigner, setSelectedDesigner] = useState<string | null>(null)
  const [jobScope, setJobScope] = useState<'external' | 'internal'>('external')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectDetails, setProjectDetails] = useState<any>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  useEffect(() => {
    const projectId = new URLSearchParams(window.location.search).get('project')
    if (projectId) {
      void handleProjectClick(projectId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadProjects() {
    setLoading(true)
    try {
      const result = await getProjectsWithTimeTracking(statusFilter)
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
    const url = new URL(window.location.href)
    if (url.searchParams.has('project')) {
      url.searchParams.delete('project')
      const next = `${url.pathname}${url.search}${url.hash}`
      window.history.replaceState({}, '', next)
    }
  }

  const canDeleteCompleted = statusFilter === 'locked' && canDelete

  const requestDeleteProject = (project: Project) => {
    if (selectedProjectId === project.id) {
      handleCloseSheet()
    }
    setProjectToDelete(project)
  }

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return
    setDeleting(true)
    try {
      const result = await deleteCompletedProject(projectToDelete.id)
      if (result.error) {
        toast.error('Could not delete project', { description: result.error })
        return
      }
      toast.success(`Deleted ${result.name || projectToDelete.name}`)
      setProjects((current) => current.filter((p) => p.id !== projectToDelete.id))
      if (selectedProjectId === projectToDelete.id) {
        handleCloseSheet()
      }
      setProjectToDelete(null)
    } catch (error) {
      toast.error('Could not delete project', {
        description: error instanceof Error ? error.message : 'Something went wrong',
      })
    } finally {
      setDeleting(false)
    }
  }

  // Filter projects based on search query (but not client/designer filter yet)
  const searchFilteredProjects = useMemo(() => {
    return projects.filter((project) => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      const matchesName = project.name.toLowerCase().includes(q)
      const matchesClient = project.client_name?.toLowerCase().includes(q)
      const matchesAgency = project.agency?.toLowerCase().includes(q)
      const matchesDesigner = (project.designers || []).some((d) =>
        (d.full_name || d.email || '').toLowerCase().includes(q)
      )
      return matchesName || matchesClient || matchesAgency || matchesDesigner
    })
  }, [projects, searchQuery])

  const isLive = statusFilter === 'active'
  const statusScopedProjects = useMemo(
    () =>
      searchFilteredProjects.filter((p) => {
        const matchesStatus = isLive ? p.status === 'active' : p.status === 'locked'
        if (!matchesStatus) return false
        return jobScope === 'internal' ? isInternalJob(p) : !isInternalJob(p)
      }),
    [searchFilteredProjects, isLive, jobScope]
  )

  const statusProjects = useMemo(
    () =>
      statusScopedProjects.filter((project) => {
        const matchesClient = !selectedClient || project.client_name === selectedClient
        const matchesAgency = !selectedAgency || project.agency === selectedAgency
        const matchesDesigner =
          !selectedDesigner ||
          (project.designers || []).some((d) => d.id === selectedDesigner)
        return matchesClient && matchesAgency && matchesDesigner
      }),
    [statusScopedProjects, selectedClient, selectedAgency, selectedDesigner]
  )

  const matchingOthers = (skip: 'client' | 'agency' | 'designer') =>
    statusScopedProjects.filter((p) => {
      if (skip !== 'client' && selectedClient && p.client_name !== selectedClient) return false
      if (skip !== 'agency' && selectedAgency && p.agency !== selectedAgency) return false
      if (
        skip !== 'designer' &&
        selectedDesigner &&
        !(p.designers || []).some((d) => d.id === selectedDesigner)
      ) {
        return false
      }
      return true
    })

  const availableClients = uniqueSortedNames(
    matchingOthers('client').map((p) => p.client_name)
  )
  const availableAgencies = uniqueSortedNames(
    matchingOthers('agency').map((p) => p.agency)
  )
  const availableDesigners = (() => {
    const byId = new Map<string, ProjectDesigner>()
    matchingOthers('designer').forEach((project) => {
      ;(project.designers || []).forEach((designer) => {
        if (!byId.has(designer.id)) byId.set(designer.id, designer)
      })
    })
    if (selectedDesigner) {
      const fromAll = statusScopedProjects
        .flatMap((p) => p.designers || [])
        .find((d) => d.id === selectedDesigner)
      if (fromAll && !byId.has(fromAll.id)) byId.set(fromAll.id, fromAll)
    }
    return Array.from(byId.values()).sort((a, b) => {
      const nameA = a.full_name || a.email || ''
      const nameB = b.full_name || b.email || ''
      return nameA.localeCompare(nameB)
    })
  })()

  const hasActiveFilters = Boolean(searchQuery || selectedClient || selectedDesigner || selectedAgency)

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
                    <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                      {(['external', 'internal'] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            setJobScope(option)
                            setSelectedClient(null)
                            setSelectedAgency(null)
                            setSelectedDesigner(null)
                          }}
                          className={cn(
                            'px-2.5 py-1 text-sm font-medium rounded-[5px] transition-colors',
                            jobScope === option
                              ? 'bg-background shadow-sm text-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {option === 'external' ? 'External' : 'Internal'}
                        </button>
                      ))}
                    </div>
                    <Select
                      value={selectedClient ?? ALL_FILTER}
                      onValueChange={(value) => setSelectedClient(value === ALL_FILTER ? null : value)}
                    >
                      <SelectTrigger className="w-[200px]" size="sm" aria-label="Filter by client">
                        <SelectValue placeholder="All clients" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_FILTER}>All clients</SelectItem>
                        {withSelected(availableClients, selectedClient).map((client) => (
                          <SelectItem key={client} value={client}>
                            {client}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedAgency ?? ALL_FILTER}
                      onValueChange={(value) => setSelectedAgency(value === ALL_FILTER ? null : value)}
                    >
                      <SelectTrigger className="w-[200px]" size="sm" aria-label="Filter by agency">
                        <SelectValue placeholder="All agencies" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_FILTER}>All agencies</SelectItem>
                        {withSelected(availableAgencies, selectedAgency).map((agency) => (
                          <SelectItem key={agency} value={agency}>
                            {agency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedDesigner ?? ALL_FILTER}
                      onValueChange={(value) => setSelectedDesigner(value === ALL_FILTER ? null : value)}
                    >
                      <SelectTrigger className="w-[200px]" size="sm" aria-label="Filter by designer">
                        <SelectValue placeholder="All designers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_FILTER}>All designers</SelectItem>
                        {availableDesigners.map((designer) => (
                          <SelectItem key={designer.id} value={designer.id}>
                            {designerDisplayName(designer)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                </div>
                <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                  {canDeleteCompleted && (
                    <ReviewVsMondayButton
                      onDeleted={(ids) =>
                        setProjects((current) => current.filter((p) => !ids.includes(p.id)))
                      }
                    />
                  )}
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
              </div>
            </div>

            {statusProjects.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium">
                    {hasActiveFilters
                      ? 'No matching projects'
                      : isLive
                        ? jobScope === 'internal'
                          ? 'No live internal projects'
                          : 'No live projects'
                        : jobScope === 'internal'
                          ? 'No completed internal projects'
                          : 'No completed projects'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {hasActiveFilters
                      ? 'Try adjusting your search or filter criteria'
                      : jobScope === 'internal'
                        ? 'Internal jobs have Salo Creative as both client and agency.'
                        : isLive
                          ? 'Active projects will appear here once synced from Monday.com'
                          : 'Completed projects will appear here once synced from Monday.com'}
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
                                    onDelete={canDeleteCompleted ? () => requestDeleteProject(project) : undefined}
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
              {!loadingDetails && projectDetails?.project && (
                <SheetDescription className="text-sm">
                  {projectDetails.project.client_name || 'No client'}
                  {projectDetails.project.agency ? ` · ${projectDetails.project.agency}` : ''}
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
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Project details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <DetailStat
                        label="Quote value"
                        value={
                          Number.isFinite(projectDetails.project.quote_value)
                            ? formatGbp(projectDetails.project.quote_value)
                            : '—'
                        }
                      />
                      <DetailStat
                        label="Quoted hours"
                        value={
                          projectQuotedHours
                            ? `${Number(projectQuotedHours).toFixed(1)}h`
                            : '—'
                        }
                      />
                      <DetailStat
                        label="Timeline"
                        value={formatProjectTimeline(projectDetails)}
                      />
                      <DetailStat
                        label={projectDetails.project.status === 'locked' ? 'Completed' : 'Due'}
                        value={formatProjectDate(
                          projectDetails.project.status === 'locked'
                            ? projectDetails.project.completed_date
                            : projectDetails.project.due_date
                        )}
                      />
                      {projectDetails.project.status === 'locked' && projectDetails.project.due_date ? (
                        <DetailStat label="Due" value={formatProjectDate(projectDetails.project.due_date)} />
                      ) : null}
                      {projectDetails.project.monday_status ? (
                        <DetailStat label="Monday status" value={projectDetails.project.monday_status} />
                      ) : null}
                    </dl>
                  </CardContent>
                </Card>

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
                                {(task.timelineStart || task.timelineEnd) && (
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {formatDateRange(task.timelineStart, task.timelineEnd)}
                                  </div>
                                )}
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
                {canDeleteCompleted && projectDetails.project.status === 'locked' && (
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full"
                    onClick={() => {
                      const project = projects.find((p) => p.id === projectDetails.project.id)
                      if (project) requestDeleteProject(project)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete project
                  </Button>
                )}
                </div>
            ) : null}
            </div>
          </SheetContent>
        </Sheet>

        <Dialog
          open={projectToDelete != null}
          onOpenChange={(open) => {
            if (!open && !deleting) setProjectToDelete(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete completed project?</DialogTitle>
              <DialogDescription>
                {projectToDelete
                  ? `Delete “${projectToDelete.name}” from Studio? Logged time and invoices for this job will be removed. This cannot be undone. The Monday.com item is not deleted, and a full Monday sync could bring it back.`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setProjectToDelete(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleConfirmDelete()}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
  onDelete,
}: {
  project: Project
  onClick: () => void
  showHealth?: boolean
  onDelete?: () => void
}) {
  const stats = getProjectStats(project)
  const health = showHealth ? getProjectHealth(project) : null
  const { totalQuotedHours, totalLoggedHours, percentage } = stats
  const designers = project.designers || []
  const clientLine = [project.client_name, project.agency].filter(Boolean).join(' • ')
  const designerLabel = designers.map(designerShortName).join(', ')
  const isCompleted = project.status === 'locked'
  const timePercentClass = isCompleted ? completedBudgetPercentageTextClass(percentage) : undefined
  const progressClass = isCompleted
    ? completedBudgetProgressBarClass(percentage)
    : budgetProgressBarClass(percentage)

  const body = (
    <>
      <div className="flex-1 min-w-0 space-y-0.5">
        {clientLine && (
          <div className="text-xs text-muted-foreground truncate">{clientLine}</div>
        )}
        <div className="font-medium text-sm truncate">{project.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {designerLabel ? `${designerLabel} | ` : ''}
          Time {totalLoggedHours.toFixed(1)}h / {totalQuotedHours.toFixed(1)}h (
          <span className={timePercentClass}>{formatBudgetPercentage(percentage)}</span>
          )
        </div>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        {isCompleted ? (
          <Badge variant="outline" className="bg-muted text-xs font-medium">
            Completed
          </Badge>
        ) : showHealth && health ? (
          <HealthBadge health={health} />
        ) : null}
        <Progress
          value={budgetProgressValue(percentage)}
          className={cn('h-1.5 w-16', progressClass)}
        />
      </div>
    </>
  )

  if (onDelete) {
    return (
      <div className="flex items-stretch hover:bg-accent">
        <button
          type="button"
          onClick={onClick}
          className="flex-1 min-w-0 px-4 py-2.5 flex items-center gap-4 transition-colors text-left"
        >
          {body}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-auto w-10 shrink-0 rounded-none text-muted-foreground hover:bg-transparent hover:text-destructive"
          title={`Delete ${project.name}`}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Delete {project.name}</span>
        </Button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-4 py-2.5 flex items-center gap-4 hover:bg-accent transition-colors text-left"
    >
      {body}
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
    <Badge variant="outline" className={cn('shrink-0 gap-1 text-xs font-medium', config.className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}

function getStatus(percentage: number): 'over' | 'on-track' | 'under' {
  if (percentage >= 100) return 'over'
  if (percentage >= 80) return 'on-track'
  return 'under'
}

function formatProjectDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return format(parseISO(value.slice(0, 10)), 'd MMM yyyy')
  } catch {
    return value
  }
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const from = start ? formatProjectDate(start) : null
  const to = end ? formatProjectDate(end) : null
  if (from && to) return from === to ? from : `${from} – ${to}`
  return from || to || '—'
}

function formatProjectTimeline(details: {
  project: {
    due_date?: string | null
    completed_date?: string | null
    created_at?: string | null
    status?: string
  }
  tasksBreakdown: Array<{ timelineStart?: string | null; timelineEnd?: string | null }>
}): string {
  const starts = details.tasksBreakdown
    .map((task) => task.timelineStart)
    .filter((value): value is string => Boolean(value))
  const ends = details.tasksBreakdown
    .map((task) => task.timelineEnd)
    .filter((value): value is string => Boolean(value))

  const start =
    starts.sort()[0] ||
    details.project.created_at ||
    null
  const end =
    ends.sort().at(-1) ||
    (details.project.status === 'locked' ? details.project.completed_date : details.project.due_date) ||
    details.project.due_date ||
    null

  return formatDateRange(start, end)
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  )
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

function completedBudgetPercentageTextClass(percentage: number) {
  if (!Number.isFinite(percentage) || percentage > 120) return 'text-destructive'
  if (percentage > 100) return 'text-amber-600'
  return 'text-green-600'
}

function completedBudgetProgressBarClass(percentage: number) {
  if (!Number.isFinite(percentage) || percentage > 120) {
    return 'bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive'
  }
  if (percentage > 100) {
    return 'bg-amber-500/20 [&>[data-slot=progress-indicator]]:bg-amber-500'
  }
  return 'bg-green-600/20 [&>[data-slot=progress-indicator]]:bg-green-600'
}

function designerDisplayName(designer: ProjectDesigner) {
  return designer.full_name || designer.email || 'Unknown'
}

function designerShortName(designer: ProjectDesigner) {
  const name = designer.full_name || designer.email || '?'
  return name.split(/\s+/)[0]
}


