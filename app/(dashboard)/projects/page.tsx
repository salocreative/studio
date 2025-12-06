'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { DoughnutChart } from '@/components/ui/doughnut-chart'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FolderKanban, AlertCircle, CheckCircle2, Clock, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { getProjectsWithTimeTracking } from '@/app/actions/projects'
import { cn } from '@/lib/utils'

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
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'live' | 'completed'>('live')

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

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
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
                        isExpanded={expandedProjects.has(project.id)}
                        onToggle={() => toggleProject(project.id)}
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
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredProjects
                    .filter(p => p.status === 'locked')
                    .map((project) => (
                      <ProjectCard 
                        key={project.id} 
                        project={project}
                        isExpanded={expandedProjects.has(project.id)}
                        onToggle={() => toggleProject(project.id)}
                      />
                    ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}

function ProjectCard({ 
  project, 
  isExpanded, 
  onToggle 
}: { 
  project: Project
  isExpanded: boolean
  onToggle: () => void
}) {
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
    <Card className={cn(isLocked && "opacity-90 border-muted")}>
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
          <div className="flex items-center justify-center py-2">
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

          {/* Tasks List */}
          {project.tasks.length > 0 && (
            <div className="border-t pt-4">
              <button
                onClick={onToggle}
                className="w-full flex items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>{project.tasks.length} Task{project.tasks.length !== 1 ? 's' : ''}</span>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              
              {isExpanded && (
                <div className="mt-3 space-y-2">
                  {project.tasks.map((task) => (
                    <div
                      key={task.id}
                      className="text-sm p-2 rounded bg-muted/50 border"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{task.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {task.logged_hours.toFixed(1)}h logged
                            {task.quoted_hours !== null && (
                              <> / {task.quoted_hours.toFixed(1)}h quoted</>
                            )}
                          </div>
                        </div>
                        {task.time_left !== null && (
                          <div className={cn(
                            "text-xs font-medium ml-2 px-2 py-1 rounded",
                            task.time_left < (task.quoted_hours || 0) * 0.2
                              ? "bg-orange-100 text-orange-700"
                              : "bg-green-100 text-green-700"
                          )}>
                            {task.time_left.toFixed(1)}h left
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
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

