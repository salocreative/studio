'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, CheckCircle2, Clock, History } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { getFlexiDesignClientByToken } from '@/app/actions/flexi-design'
import {
  getFlexiDesignClientDataPublic,
  getFlexiDesignGalleryByShareToken,
  type FlexiDesignPublicGalleryItem,
} from '@/app/actions/flexi-design-public'

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

interface CreditTransaction {
  id: string
  hours: number
  transaction_date: string
  created_at: string
}

export default function FlexiDesignShareClient({ shareToken }: FlexiDesignShareClientProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clientData, setClientData] = useState<ClientData | null>(null)
  const [activeProjects, setActiveProjects] = useState<Project[]>([])
  const [completedProjects, setCompletedProjects] = useState<Project[]>([])
  const [creditTransactions, setCreditTransactions] = useState<CreditTransaction[]>([])
  const [galleryItems, setGalleryItems] = useState<FlexiDesignPublicGalleryItem[]>([])
  const [showCreditHistoryDialog, setShowCreditHistoryDialog] = useState(false)
  const [viewingGalleryItem, setViewingGalleryItem] = useState<FlexiDesignPublicGalleryItem | null>(
    null
  )
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    loadData()
  }, [shareToken])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
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

      const [dataResult, galleryResult] = await Promise.all([
        getFlexiDesignClientDataPublic(shareResult.client.client_name),
        getFlexiDesignGalleryByShareToken(shareToken),
      ])

      if (dataResult.error) {
        setError(dataResult.error)
      } else if (dataResult.success && dataResult.client) {
        setClientData(dataResult.client)
        setActiveProjects(dataResult.activeProjects || [])
        setCompletedProjects(dataResult.completedProjects || [])
        setCreditTransactions(dataResult.creditTransactions || [])
      }

      if (galleryResult.success && galleryResult.items) {
        setGalleryItems(galleryResult.items)
      } else {
        setGalleryItems([])
      }
    } catch (err) {
      console.error('Error loading share data:', err)
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

  const completedProjectsByMonth = (() => {
    const groups = new Map<
      string,
      { monthLabel: string; monthDate: Date; projects: Project[]; totalQuoted: number }
    >()

    for (const project of completedProjects) {
      const dateSource = project.completed_date || project.created_at
      if (!dateSource) continue
      try {
        const date = parseISO(dateSource)
        if (Number.isNaN(date.getTime())) continue

        const monthKey = format(date, 'yyyy-MM')
        const monthLabel = format(date, 'MMMM yyyy')
        const existing = groups.get(monthKey)
        if (existing) {
          existing.projects.push(project)
          existing.totalQuoted += project.quoted_hours || 0
        } else {
          groups.set(monthKey, {
            monthLabel,
            monthDate: new Date(date.getFullYear(), date.getMonth(), 1),
            projects: [project],
            totalQuoted: project.quoted_hours || 0,
          })
        }
      } catch {
        continue
      }
    }

    return Array.from(groups.entries())
      .map(([monthKey, value]) => ({ monthKey, ...value }))
      .sort((a, b) => b.monthDate.getTime() - a.monthDate.getTime())
  })()

  if (loading) {
    return (
      <div className="dark min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">Loading account information...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dark min-h-screen bg-background text-foreground flex items-center justify-center p-4">
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
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8 lg:px-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">{clientData.client_name}</h1>
            <p className="text-muted-foreground">Flexi-Design Account Overview</p>
          </div>
          <Button variant="outline" onClick={() => setShowCreditHistoryDialog(true)}>
            <History className="mr-2 h-4 w-4" />
            Credit History
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="history">
              History
              {completedProjects.length > 0 ? ` (${completedProjects.length})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>Remaining Credits</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {formatCredits(clientData.remaining_hours)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Credits available</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>Completed Projects</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{clientData.completed_projects_count}</div>
                  <p className="text-xs text-muted-foreground mt-1">Projects finished</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>Total Credits Used</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {formatCredits(clientData.total_hours_used)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Credits consumed</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>Avg Credits Per Month</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {formatCredits(clientData.avg_hours_per_month)}
                  </div>
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
                <CardDescription>Projects currently in progress</CardDescription>
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

            {/* Gallery — same content width as sections above */}
            {galleryItems.length > 0 && (
              <section className="space-y-6 border-t border-border pt-8">
                <div className="space-y-1">
                  <h2 className="text-2xl font-semibold tracking-tight">Gallery</h2>
                  <p className="text-sm text-muted-foreground">
                    Selected work for {clientData.client_name}
                  </p>
                </div>

                <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
                  {galleryItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-lg border border-border bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setViewingGalleryItem(item)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.title || 'Gallery image'}
                        className="w-full object-cover transition-opacity hover:opacity-90"
                        loading="lazy"
                      />
                      {(item.title || item.caption) && (
                        <div className="px-3 py-2">
                          {item.title && (
                            <div className="truncate text-sm font-medium">{item.title}</div>
                          )}
                          {item.caption && (
                            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {item.caption}
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  Completed Projects ({completedProjects.length})
                </CardTitle>
                <CardDescription>Grouped by completion month</CardDescription>
              </CardHeader>
              <CardContent>
                {completedProjects.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No completed projects</p>
                ) : (
                  <div className="space-y-6">
                    {completedProjectsByMonth.map((group) => (
                      <div key={group.monthKey} className="space-y-3">
                        <div className="flex items-center justify-between border-b pb-2">
                          <div className="flex items-baseline gap-2">
                            <h3 className="font-semibold">{group.monthLabel}</h3>
                            <span className="text-sm text-muted-foreground">
                              {group.projects.length} project
                              {group.projects.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="text-sm font-semibold text-primary">
                            {formatCredits(group.totalQuoted)} credits
                          </div>
                        </div>
                        <div className="space-y-3">
                          {group.projects.map((project) => (
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
                                <Badge variant="default">Completed</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Gallery lightbox */}
      <Dialog
        open={!!viewingGalleryItem}
        onOpenChange={(open) => !open && setViewingGalleryItem(null)}
      >
        <DialogContent className="dark max-w-4xl">
          <DialogHeader>
            <DialogTitle>{viewingGalleryItem?.title || 'Gallery image'}</DialogTitle>
            {viewingGalleryItem?.caption && (
              <DialogDescription>{viewingGalleryItem.caption}</DialogDescription>
            )}
          </DialogHeader>
          {viewingGalleryItem && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={viewingGalleryItem.url}
              alt={viewingGalleryItem.title || 'Gallery image'}
              className="max-h-[75vh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Credit History Dialog */}
      <Dialog open={showCreditHistoryDialog} onOpenChange={setShowCreditHistoryDialog}>
        <DialogContent className="dark max-w-2xl">
          <DialogHeader>
            <DialogTitle>Credit History</DialogTitle>
            <DialogDescription>
              History of all credit additions for {clientData.client_name}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {creditTransactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No credit transactions yet</div>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {creditTransactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-green-600">
                        +{formatCredits(transaction.hours)} credits
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        Transaction Date: {formatDate(transaction.transaction_date)}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Added {formatDate(transaction.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreditHistoryDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
