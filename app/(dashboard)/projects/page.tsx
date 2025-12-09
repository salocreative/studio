'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { DoughnutChart } from '@/components/ui/doughnut-chart'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { FolderKanban, AlertCircle, CheckCircle2, Clock, Search, X, Loader2, ChevronRight } from 'lucide-react'
import { getProjectsWithTimeTracking, getProjectDetails } from '@/app/actions/projects'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'

interface Project {
  id: string
  name: string
  client_name: string | null
  status: 'active' | 'archived' | 'locked'
  quoted_hours: number | null
  total_logged_hours: number
  tasks: Array<{
    id: string
    name: string
    quoted_hours: number | null
    logged_hours: number
    time_left: number | null
  }>
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'live' | 'completed'>('live')
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

  // Filter projects based on search query (but not client filter yet, for getting available clients)
  const searchFilteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const matchesSearch = 
        !searchQuery ||
        project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (project.client_name && project.client_name.toLowerCase().includes(searchQuery.toLowerCase()))
      
      return matchesSearch
    })
  }, [projects, searchQuery])

  // Filter projects based on search query AND selected client
  const filteredProjects = useMemo(() => {
    return searchFilteredProjects.filter((project) => {
      const matchesClient = !selectedClient || project.client_name === selectedClient
      return matchesClient
    })
  }, [searchFilteredProjects, selectedClient])

  // Get unique clients from search-filtered projects (respecting current tab but not client filter)
  const getUniqueClients = (statusFilter: 'active' | 'locked') => {
    const filtered = searchFilteredProjects.filter(p => 
      statusFilter === 'active' ? p.status === 'active' : p.status === 'locked'
    )
    const clients = new Set<string>()
    filtered.forEach(project => {
      if (project.client_name) {
        clients.add(project.client_name)
      }
    })
    return Array.from(clients).sort()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="text-sm text-muted-foreground">
              View project status and time tracking
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading projects...</p>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'live' | 'completed')} className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="live">
                Live
                {filteredProjects.filter(p => p.status === 'active').length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {filteredProjects.filter(p => p.status === 'active').length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="completed">
                Completed
                {filteredProjects.filter(p => p.status === 'locked').length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {filteredProjects.filter(p => p.status === 'locked').length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Search and Filters */}
            <div className="mb-6 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search projects & tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
                    onClick={() => setSearchQuery('')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              {/* Client Quick Filters - Show clients from current tab's filtered results */}
              <ClientFilters
                clients={getUniqueClients(activeTab === 'live' ? 'active' : 'locked')}
                selectedClient={selectedClient}
                onSelectClient={setSelectedClient}
              />
            </div>

            <TabsContent value="live" className="mt-0">
              {filteredProjects.filter(p => p.status === 'active').length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-lg font-medium">
                      {searchQuery || selectedClient ? 'No matching projects' : 'No live projects'}
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      {searchQuery || selectedClient
                        ? 'Try adjusting your search or filter criteria'
                        : 'Active projects will appear here once synced from Monday.com'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredProjects
                    .filter(p => p.status === 'active')
                    .map((project) => (
                      <ProjectCard 
                        key={project.id} 
                        project={project}
                        onClick={() => handleProjectClick(project.id)}
                      />
                    ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="completed" className="mt-0">
              {filteredProjects.filter(p => p.status === 'locked').length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-lg font-medium">
                      {searchQuery || selectedClient ? 'No matching projects' : 'No completed projects'}
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      {searchQuery || selectedClient
                        ? 'Try adjusting your search or filter criteria'
                        : 'Completed projects (from completed boards) will appear here'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {filteredProjects
                        .filter(p => p.status === 'locked')
                        .map((project) => (
                          <ProjectListItem
                            key={project.id}
                            project={project}
                            onClick={() => handleProjectClick(project.id)}
                          />
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
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
                                    task.percentage >= 100 ? "text-destructive" :
                                    task.percentage >= 80 ? "text-green-600" :
                                    "text-muted-foreground"
                                  )}>
                                    {task.percentage.toFixed(0)}%
                                  </span>
                                )}
                                {task.quotedHours !== null && (
                                  <Progress 
                                    value={Math.min(100, task.percentage || 0)} 
                                    className="h-1.5 w-16"
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
                        {projectDetails.userTotals.map((user: any) => (
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
                                  {projectDetails.project.quoted_hours && (
                                    <div className="text-xs text-muted-foreground">
                                      {((user.totalHours / projectDetails.project.quoted_hours) * 100).toFixed(0)}%
                                    </div>
                                  )}
                                </div>
                                {projectDetails.project.quoted_hours && (
                                  <Progress 
                                    value={Math.min(100, (user.totalHours / projectDetails.project.quoted_hours) * 100)} 
                                    className="h-1.5 w-16"
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
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
                </div>
            ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
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

function ProjectCard({ 
  project, 
  onClick 
}: { 
  project: Project
  onClick: () => void
}) {
  const { totalQuotedHours, totalLoggedHours, percentage, status, isOverBudget } = getProjectStats(project)
  
  // Data for doughnut chart
  // If over budget, show: quoted hours (gray), over-budget hours (red)
  // If under budget, show: logged hours (purple), remaining hours (gray)
  // Special case: if no quoted hours but we have logged hours, show all as over budget
  const chartData = isOverBudget
    ? totalQuotedHours === 0 && totalLoggedHours > 0
      ? [
          // No quoted hours - show all logged hours as over budget
          {
            name: 'Over Budget',
            value: totalLoggedHours,
            color: '#EF4444', // red-500
          },
        ]
      : [
          {
            name: 'Quoted Hours',
            value: totalQuotedHours,
            color: '#E5E7EB',
          },
          {
            name: 'Over Budget',
            value: totalLoggedHours - totalQuotedHours,
            color: '#EF4444', // red-500
          },
        ]
    : [
        {
          name: 'Time Spent',
          value: totalLoggedHours,
          color: '#6405FF',
        },
        {
          name: 'Time Remaining',
          value: Math.max(0, totalQuotedHours - totalLoggedHours),
          color: '#E5E7EB',
        },
      ]
  
  // For chart percentage display: show logged/quoted percentage
  // If no quoted hours but we have logged hours, show 100%+ (over budget)
  const chartPercentage = totalQuotedHours > 0 
    ? (totalLoggedHours / totalQuotedHours) * 100 
    : (totalLoggedHours > 0 ? 150 : 0) // Show as over budget if we have hours but no quoted hours

  const isLocked = project.status === 'locked'

  return (
    <Card 
      className={cn(
        isLocked && "opacity-90 border-muted",
        "cursor-pointer hover:shadow-md transition-shadow"
      )}
      onClick={onClick}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{project.name}</CardTitle>
            {project.client_name && (
              <CardDescription className="mt-1">
                {project.client_name}
              </CardDescription>
            )}
          </div>
          {project.status === 'locked' && (
            <Badge variant="outline" className="bg-muted">
              Completed
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Doughnut Chart */}
          <div className="flex items-center justify-center py-0">
            <div className="relative">
              <DoughnutChart 
                data={chartData} 
                showPercentage={false}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div 
                  className={cn(
                    "text-2xl font-bold",
                    isOverBudget && "text-destructive"
                  )}
                >
                  {chartPercentage.toFixed(0)}%
                </div>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">Time Tracked</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {totalLoggedHours.toFixed(1)}h / {totalQuotedHours.toFixed(1)}h
                </span>
                <span className={cn(
                  "font-semibold",
                  percentage > 100 ? "text-destructive" : "text-muted-foreground"
                )}>
                  {percentage.toFixed(0)}%
                </span>
              </div>
            </div>
            <Progress value={Math.min(100, percentage)} className="h-2" />
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
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

          {/* Tasks Count */}
          {project.tasks.length > 0 && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{project.tasks.length} Task{project.tasks.length !== 1 ? 's' : ''}</span>
                <span className="text-xs">Click to view details</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ProjectListItem({
  project,
  onClick,
}: {
  project: Project
  onClick: () => void
}) {
  const { totalQuotedHours, totalLoggedHours, percentage, status, isOverBudget } = getProjectStats(project)

  return (
    <button
      onClick={onClick}
      className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <div className="font-medium text-base">{project.name}</div>
          {project.status === 'locked' && (
            <Badge variant="outline" className="bg-muted text-xs">
              Completed
            </Badge>
          )}
        </div>
        {project.client_name && (
          <div className="text-sm text-muted-foreground mb-2">
            {project.client_name}
          </div>
        )}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Time:</span>
            <span className="font-medium">
              {totalLoggedHours.toFixed(1)}h / {totalQuotedHours.toFixed(1)}h
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Tasks:</span>
            <span>{project.tasks.length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {status === 'over' && (
              <>
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className={cn(
                  "text-sm font-semibold",
                  isOverBudget && "text-destructive"
                )}>
                  {percentage.toFixed(0)}%
                </span>
                <span className="text-sm text-destructive">Over budget</span>
              </>
            )}
            {status === 'on-track' && (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-semibold">{percentage.toFixed(0)}%</span>
                <span className="text-sm text-green-600">On track</span>
              </>
            )}
            {status === 'under' && (
              <>
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{percentage.toFixed(0)}%</span>
                <span className="text-sm text-muted-foreground">Under budget</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="ml-4">
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </div>
    </button>
  )
}

function getStatus(percentage: number): 'over' | 'on-track' | 'under' {
  if (percentage >= 100) return 'over'
  if (percentage >= 80) return 'on-track'
  return 'under'
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
        All Clients
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

