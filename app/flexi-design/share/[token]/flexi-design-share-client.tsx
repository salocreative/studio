'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, Clock, TrendingUp } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { getFlexiDesignClientByToken } from '@/app/actions/flexi-design'
import { getFlexiDesignClientDataPublic } from '@/app/actions/flexi-design-public'

interface FlexiDesignShareClientProps {
  shareToken: string
}

interface Project {
  id: string
  name: string
  status: string
  quoted_hours: number | null
  created_at: string
  completed_date?: string | null
}

interface ClientData {
  id: string
  client_name: string
  remaining_hours: number
  total_hours_used: number
  completed_projects_count: number
  active_projects_count: number
  avg_hours_per_month: number
}

export default function FlexiDesignShareClient({ shareToken }: FlexiDesignShareClientProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clientData, setClientData] = useState<ClientData | null>(null)
  const [activeProjects, setActiveProjects] = useState<Project[]>([])
  const [completedProjects, setCompletedProjects] = useState<Project[]>([])

  useEffect(() => {
    loadData()
  }, [shareToken])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      // First, validate the share token and get client info
      const shareResult = await getFlexiDesignClientByToken(shareToken)
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

      // Then load the Flexi-Design client data using public version
      const dataResult = await getFlexiDesignClientDataPublic(shareResult.client.client_name)
      if (dataResult.error) {
        setError(dataResult.error)
      } else if (dataResult.success && dataResult.client) {
        setClientData(dataResult.client)
        setActiveProjects(dataResult.activeProjects || [])
        setCompletedProjects(dataResult.completedProjects || [])
      }
    } catch (error) {
      console.error('Error loading share data:', error)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  function formatDate(dateString: string): string {
    try {
      return format(parseISO(dateString), 'MMM d, yyyy')
    } catch {
      return dateString
    }
  }

  function formatCredits(credits: number): string {
    if (credits === 0) return '0'
    return credits.toFixed(1)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">Loading account information...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!clientData) {
    return null
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{clientData.client_name}</h1>
          <p className="text-muted-foreground">Flexi-Design Account Overview</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Remaining Credits */}
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Remaining Credits</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatCredits(clientData.remaining_hours)}</div>
              <p className="text-xs text-muted-foreground mt-1">Credits available</p>
            </CardContent>
          </Card>

          {/* Completed Projects */}
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Completed Projects</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{clientData.completed_projects_count}</div>
              <p className="text-xs text-muted-foreground mt-1">Projects finished</p>
            </CardContent>
          </Card>

          {/* Total Credits Used */}
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Total Credits Used</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatCredits(clientData.total_hours_used)}</div>
              <p className="text-xs text-muted-foreground mt-1">Credits consumed</p>
            </CardContent>
          </Card>

          {/* Avg Credits Per Month */}
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Avg Credits Per Month</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatCredits(clientData.avg_hours_per_month)}</div>
              <p className="text-xs text-muted-foreground mt-1">Monthly average</p>
            </CardContent>
          </Card>
        </div>

        {/* Active Projects */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Active Projects ({activeProjects.length})
            </CardTitle>
            <CardDescription>
              Projects currently in progress
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeProjects.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No active projects</p>
            ) : (
              <div className="space-y-3">
                {activeProjects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1">
                      <h3 className="font-medium">{project.name}</h3>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>Created {formatDate(project.created_at)}</span>
                        {project.quoted_hours !== null && (
                          <span>{formatCredits(project.quoted_hours)} credits</span>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary">{project.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Completed Projects */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Completed Projects ({completedProjects.length})
            </CardTitle>
            <CardDescription>
              Projects that have been finished
            </CardDescription>
          </CardHeader>
          <CardContent>
            {completedProjects.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No completed projects</p>
            ) : (
              <div className="space-y-3">
                {completedProjects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1">
                      <h3 className="font-medium">{project.name}</h3>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        {project.completed_date && (
                          <span>Completed {formatDate(project.completed_date)}</span>
                        )}
                        {project.quoted_hours !== null && (
                          <span>{formatCredits(project.quoted_hours)} credits</span>
                        )}
                      </div>
                    </div>
                    <Badge variant="default">{project.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
