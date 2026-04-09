'use client'

import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CheckCircle2, Search, Star, StarOff } from 'lucide-react'
import { toggleFavoriteTask } from '@/app/actions/time-tracking'
import { cn } from '@/lib/utils'

interface Task {
  id: string
  name: string
  quoted_hours?: number | null
  logged_hours?: number | null
  time_left?: number | null
  monday_data?: Record<string, any> | null
  is_favorite?: boolean
}

interface Project {
  id: string
  name: string
  client_name?: string | null
  quoted_hours?: number | null
  total_logged_hours?: number | null
  tasks: Task[]
}

interface ProjectTaskSelectorProps {
  projects: Project[]
  onSelectTask: (task: Task, project: Project) => void
  showFavoritesOnly?: boolean
  boardType?: 'main' | 'flexi-design'
  onBoardTypeChange?: (boardType: 'main' | 'flexi-design') => void
  hideClientFilters?: boolean
}

export function ProjectTaskSelector({
  projects,
  onSelectTask,
  showFavoritesOnly = false,
  boardType = 'main',
  onBoardTypeChange,
  hideClientFilters = false,
}: ProjectTaskSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [favoritesOnly, setFavoritesOnly] = useState(showFavoritesOnly)

  // Filter projects based on search query (but not client filter yet, for getting available clients)
  const searchFilteredProjects = useMemo(() => {
    return projects
      .map((project) => {
        let filteredTasks = project.tasks

        // Filter by favorites
        if (favoritesOnly) {
          filteredTasks = filteredTasks.filter((task) => task.is_favorite)
        }

        // Filter by search query
        if (searchQuery) {
          const query = searchQuery.toLowerCase()
          filteredTasks = filteredTasks.filter(
            (task) =>
              task.name.toLowerCase().includes(query) ||
              project.name.toLowerCase().includes(query) ||
              project.client_name?.toLowerCase().includes(query)
          )
        }

        return {
          ...project,
          tasks: filteredTasks,
        }
      })
      .filter((project) => project.tasks.length > 0)
  }, [projects, searchQuery, favoritesOnly])

  // Filter projects based on search query AND selected client
  const filteredProjects = useMemo(() => {
    return searchFilteredProjects.filter((project) => {
      const matchesClient = !selectedClient || project.client_name === selectedClient
      return matchesClient
    })
  }, [searchFilteredProjects, selectedClient])

  // Get unique clients from search-filtered projects
  const getUniqueClients = () => {
    const clients = new Set<string>()
    searchFilteredProjects.forEach((project) => {
      if (project.client_name) {
        clients.add(project.client_name)
      }
    })
    return Array.from(clients).sort()
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

  const handleToggleFavorite = async (taskId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    await toggleFavoriteTask(taskId)
    // Refresh will be handled by parent component
  }

  const uniqueClients = getUniqueClients()

  const getCompletionFromStatus = (task: Task): boolean | null => {
    if (!task.monday_data || typeof task.monday_data !== 'object') return null

    const statusColumns = Object.values(task.monday_data).filter((column: any) => column?.type === 'status')
    if (statusColumns.length === 0) return null

    const completedPattern = /\b(done|complete|completed|closed)\b/i

    for (const column of statusColumns) {
      const textValue = typeof column?.text === 'string' ? column.text : ''
      const parsedValue = column?.value
      const labelFromValue =
        typeof parsedValue?.label === 'string'
          ? parsedValue.label
          : typeof parsedValue?.label?.text === 'string'
            ? parsedValue.label.text
            : ''

      if (completedPattern.test(textValue) || completedPattern.test(labelFromValue)) {
        return true
      }
    }

    return false
  }
  const projectHoursById = useMemo(() => {
    return projects.reduce<Record<string, { estimatedHours: number; remainingHours: number }>>((acc, project) => {
      const taskQuotedTotal = project.tasks.reduce((sum, task) => sum + (task.quoted_hours || 0), 0)
      const estimatedHours = taskQuotedTotal > 0 ? taskQuotedTotal : (project.quoted_hours || 0)
      const totalLoggedHours = project.total_logged_hours || 0

      acc[project.id] = {
        estimatedHours,
        remainingHours: Math.max(0, estimatedHours - totalLoggedHours),
      }

      return acc
    }, {})
  }, [projects])

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Projects & Tasks</h2>
            <p className="text-sm text-muted-foreground">Search and select a task to log time</p>
          </div>
          <Button
            variant={favoritesOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFavoritesOnly(!favoritesOnly)}
          >
            <Star className={cn('h-4 w-4 mr-2', favoritesOnly && 'fill-current')} />
            Favorites
          </Button>
        </div>
        {onBoardTypeChange && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Board:</span>
            <Tabs value={boardType} onValueChange={(value) => onBoardTypeChange(value as 'main' | 'flexi-design')}>
              <TabsList>
                <TabsTrigger value="main">Main Projects</TabsTrigger>
                <TabsTrigger value="flexi-design">Flexi-Design</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects, clients, or tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Client Quick Filters */}
        {!hideClientFilters && uniqueClients.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedClient === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedClient(null)}
              className="h-8"
            >
              All Clients
            </Button>
            {uniqueClients.map((client) => (
              <Button
                key={client}
                variant={selectedClient === client ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedClient(selectedClient === client ? null : client)}
                className="h-8"
              >
                {client}
              </Button>
            ))}
          </div>
        )}
        <hr className="my-2" />
        <div className="space-y-2 py-8">
          {filteredProjects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No tasks found</p>
              {searchQuery && (
                <p className="text-sm mt-2">Try adjusting your search query</p>
              )}
              {selectedClient && (
                <p className="text-sm mt-2">No tasks found for this client</p>
              )}
              {favoritesOnly && (
                <p className="text-sm mt-2">You don't have any favorite tasks yet</p>
              )}
            </div>
          ) : (
            filteredProjects.map((project) => (
              <div
                key={project.id}
                className="border rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => toggleProject(project.id)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent transition-colors text-left"
                >
                  <div className="flex-1">
                    <div className="font-medium">{project.name}</div>
                    {project.client_name && (
                      <div className="text-sm text-muted-foreground">
                        {project.client_name}
                      </div>
                    )}
                    {projectHoursById[project.id]?.estimatedHours > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {projectHoursById[project.id].remainingHours === projectHoursById[project.id].estimatedHours
                          ? 'Not started'
                          : `${projectHoursById[project.id].remainingHours.toFixed(1)}h remaining / ${projectHoursById[project.id].estimatedHours.toFixed(1)}h estimated`}
                      </div>
                    )}
                  </div>
                  <Badge variant="secondary">
                    {project.tasks.length} task{project.tasks.length !== 1 ? 's' : ''}
                  </Badge>
                </button>

                {expandedProjects.has(project.id) && (
                  <div className="border-t bg-muted/30">
                    {project.tasks.map((task) => {
                      const remainingHours = task.time_left ?? Math.max(0, (task.quoted_hours || 0) - (task.logged_hours || 0))
                      const completionFromStatus = getCompletionFromStatus(task)
                      const isCompleted = completionFromStatus ?? Boolean(task.quoted_hours && (task.logged_hours || 0) > 0 && remainingHours === 0)

                      return (
                        <div
                          key={task.id}
                          className={cn(
                            "w-full px-4 py-2 flex items-center justify-between transition-colors border-b last:border-b-0",
                            isCompleted ? "bg-green-500/10 hover:bg-green-500/15" : "hover:bg-accent"
                          )}
                        >
                          <button
                            onClick={() => onSelectTask(task, project)}
                            className="flex-1 text-left"
                          >
                            <div className="font-medium flex items-center gap-2">
                              {task.name}
                              {isCompleted && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Completed
                                </span>
                              )}
                            </div>
                            {task.quoted_hours && (
                              <div className={cn("text-xs text-muted-foreground", isCompleted && "text-green-700/90 dark:text-green-300")}>
                                {remainingHours === task.quoted_hours
                                  ? 'Not started'
                                  : `${remainingHours.toFixed(1)}h remaining / ${task.quoted_hours.toFixed(1)}h estimated`}
                              </div>
                            )}
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => handleToggleFavorite(task.id, e)}
                          >
                            {task.is_favorite ? (
                              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            ) : (
                              <StarOff className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

