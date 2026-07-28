'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, CheckCircle2, Clock, History, Mail, ArrowLeft } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { getFlexiDesignClientByToken } from '@/app/actions/flexi-design'
import {
  getFlexiDesignClientDataPublic,
  getFlexiDesignGalleryByShareToken,
  getFlexiDesignInspoGalleryByShareToken,
  getFlexiDesignServicesByShareToken,
  type FlexiDesignPublicGalleryItem,
  type FlexiDesignPublicService,
} from '@/app/actions/flexi-design-public'
import { getFlexiServiceCategoryIcon } from '@/lib/flexi-design/service-categories'
import { SaloLogo } from '@/components/brand/salo-logo'
import { cn } from '@/lib/utils'

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

function FadeInSection({
  children,
  className,
  delayMs = 0,
}: {
  children: React.ReactNode
  className?: string
  delayMs?: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      { threshold: 0.02, rootMargin: '0px 0px -12% 0px' }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn(
        'transition-all duration-700 ease-out motion-reduce:transform-none motion-reduce:transition-none',
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
        className
      )}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  )
}

export default function FlexiDesignShareClient({ shareToken }: FlexiDesignShareClientProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clientData, setClientData] = useState<ClientData | null>(null)
  const [activeProjects, setActiveProjects] = useState<Project[]>([])
  const [completedProjects, setCompletedProjects] = useState<Project[]>([])
  const [creditTransactions, setCreditTransactions] = useState<CreditTransaction[]>([])
  const [galleryItems, setGalleryItems] = useState<FlexiDesignPublicGalleryItem[]>([])
  const [inspoGalleryItems, setInspoGalleryItems] = useState<FlexiDesignPublicGalleryItem[]>([])
  const [inspoLandscapeIds, setInspoLandscapeIds] = useState<Record<string, boolean>>({})
  const [inspoMarqueeSpeed, setInspoMarqueeSpeed] = useState<'slow' | 'medium' | 'fast'>('slow')
  const [services, setServices] = useState<FlexiDesignPublicService[]>([])
  const [servicesError, setServicesError] = useState<string | null>(null)
  const [selectedServiceCategory, setSelectedServiceCategory] = useState<string | null>(null)
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

      const [dataResult, galleryResult, servicesResult, inspoGalleryResult] = await Promise.all([
        getFlexiDesignClientDataPublic(shareResult.client.client_name),
        getFlexiDesignGalleryByShareToken(shareToken),
        getFlexiDesignServicesByShareToken(shareToken),
        getFlexiDesignInspoGalleryByShareToken(shareToken, 16),
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

      if (servicesResult.error) {
        console.error('Flexi services catalog error:', servicesResult.error)
        setServices([])
        setServicesError(servicesResult.error)
      } else if (servicesResult.success) {
        setServices(servicesResult.services || [])
        setServicesError(null)
      } else {
        setServices([])
        setServicesError('Unable to load services catalog')
      }
      setSelectedServiceCategory(null)

      if (inspoGalleryResult.success && inspoGalleryResult.items) {
        setInspoGalleryItems(inspoGalleryResult.items)
        setInspoLandscapeIds({})
      } else {
        setInspoGalleryItems([])
        setInspoLandscapeIds({})
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

  const serviceCategories = (() => {
    const counts = new Map<string, number>()
    for (const service of services) {
      counts.set(service.category, (counts.get(service.category) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => a.category.localeCompare(b.category))
  })()

  const selectedCategoryServices = selectedServiceCategory
    ? services.filter((service) => service.category === selectedServiceCategory)
    : []

  const SelectedCategoryIcon = selectedServiceCategory
    ? getFlexiServiceCategoryIcon(selectedServiceCategory)
    : null

  const inspoMarqueeItems = (() => {
    if (inspoGalleryItems.length === 0) return []
    const minItems = 10
    const repeats = Math.max(2, Math.ceil(minItems / inspoGalleryItems.length))
    return Array.from({ length: repeats }, (_, repeatIndex) =>
      inspoGalleryItems.map((item) => ({
        ...item,
        loopKey: `${item.id}-${repeatIndex}`,
      }))
    ).flat()
  })()

  const bannerRows = [0, 1, 2].map((rowIndex) => {
    const baseRow = galleryItems.filter((_, itemIndex) => itemIndex % 3 === rowIndex)
    if (baseRow.length === 0) return []

    const minItems = 12
    const repeats = Math.max(2, Math.ceil(minItems / baseRow.length))
    return Array.from({ length: repeats }, (_, repeatIndex) =>
      baseRow.map((item) => ({ ...item, loopKey: `${item.id}-${repeatIndex}` }))
    ).flat()
  })

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
      <section className="relative overflow-hidden bg-zinc-950">
        {galleryItems.length > 0 ? (
          <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-48">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_45%)]" />
            <div className="absolute inset-x-[-10%] top-14 z-0 space-y-6">
              {bannerRows.map((row, rowIndex) =>
                row.length > 0 ? (
                  <div
                    key={rowIndex}
                    style={{
                      transform: 'rotate(-5deg)',
                    }}
                    className="overflow-visible"
                  >
                    <div
                      className={cn(
                        'flex min-w-max gap-4 will-change-transform',
                        rowIndex % 2 === 0
                          ? 'animate-[marquee-left_140s_linear_infinite]'
                          : 'animate-[marquee-right_170s_linear_infinite]'
                      )}
                    >
                      {[...row, ...row].map((item, itemIndex) => (
                        <div
                          key={`${rowIndex}-${item.loopKey}-${itemIndex}`}
                          className="h-24 w-36 shrink-0 overflow-hidden rounded-md border border-white/10 bg-zinc-900/70 shadow-xl sm:h-28 sm:w-44 lg:h-32 lg:w-52"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                            decoding="async"
                            sizes="160px"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null
              )}
            </div>
            <div className="absolute inset-0 z-10 bg-gradient-to-b from-zinc-950/72 via-zinc-950/32 via-40% to-background" />
            <div className="absolute inset-x-0 bottom-0 z-20 h-[56%] bg-gradient-to-b from-transparent via-background/88 to-background md:h-[62%]" />
          </div>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_45%)]" />
        )}

        <div className="relative mx-auto flex min-h-[20rem] w-full max-w-7xl items-end px-4 py-16 md:min-h-[26rem] md:px-6 md:py-20 lg:min-h-[30rem] lg:px-8 lg:py-24">
          <div className="absolute left-4 top-5 md:left-6 md:top-6 lg:left-8">
            <SaloLogo className="h-5 w-auto text-zinc-200/90 md:h-6" title="Salo" />
          </div>
          <FadeInSection className="flex w-full flex-col items-start gap-5 md:flex-row md:items-end md:justify-between md:gap-4">
            <div className="space-y-2 pb-0 md:pb-1">
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-400">
                Flexi-Design
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-50 md:text-4xl lg:text-5xl">
                {clientData.client_name}
              </h1>
              <p className="max-w-2xl text-sm text-zinc-400 md:text-base">
                Account overview, active work, and recent history
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end">
              <Button variant="outline" asChild>
                <a
                  href="https://cal.com/carlcahill/flexi-design"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Book Call
                </a>
              </Button>
              <Button asChild>
                <a
                  href={`mailto:team@salo.uk?subject=${encodeURIComponent(
                    `New Brief — ${clientData.client_name}`
                  )}`}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  New Brief
                </a>
              </Button>
            </div>
          </FadeInSection>
        </div>
      </section>

      <style jsx>{`
        @keyframes marquee-left {
          from {
            transform: translate3d(0, 0, 0);
          }
          to {
            transform: translate3d(-50%, 0, 0);
          }
        }

        @keyframes marquee-right {
          from {
            transform: translate3d(-50%, 0, 0);
          }
          to {
            transform: translate3d(0, 0, 0);
          }
        }
      `}</style>

      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8 lg:px-8">

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="inspo">Inspo</TabsTrigger>
            <TabsTrigger value="history">
              History
              {completedProjects.length > 0 ? ` (${completedProjects.length})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <FadeInSection delayMs={40}>
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
              </FadeInSection>

              <FadeInSection delayMs={90}>
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>Completed Projects</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{clientData.completed_projects_count}</div>
                  <p className="text-xs text-muted-foreground mt-1">Projects finished</p>
                </CardContent>
              </Card>
              </FadeInSection>

              <FadeInSection delayMs={140}>
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
              </FadeInSection>

              <FadeInSection delayMs={190}>
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
              </FadeInSection>
            </div>

            {/* Active Projects */}
            <FadeInSection delayMs={120}>
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
                    {activeProjects.map((project, index) => (
                      <div
                        key={project.id}
                        className="flex items-center justify-between rounded-lg border p-4 transition-all duration-500 hover:bg-muted/50 motion-reduce:transition-none"
                        style={{
                          transitionDelay: `${Math.min(index * 45, 180)}ms`,
                          contentVisibility: 'auto',
                          containIntrinsicSize: '96px',
                        }}
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
            </FadeInSection>

            {/* Gallery — same content width as sections above */}
            {galleryItems.length > 0 && (
              <FadeInSection className="space-y-6 border-t border-border pt-8" delayMs={160}>
                <div className="space-y-1">
                  <h2 className="text-2xl font-semibold tracking-tight">Gallery</h2>
                  <p className="text-sm text-muted-foreground">
                    Selected work for {clientData.client_name}
                  </p>
                </div>

                <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [column-fill:_balance]">
                  {galleryItems.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className="group mb-4 block w-full break-inside-avoid overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm transition-all duration-700 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none"
                      onClick={() => setViewingGalleryItem(item)}
                      style={{
                        transitionDelay: `${Math.min(index * 35, 210)}ms`,
                        contentVisibility: 'auto',
                        containIntrinsicSize: '320px',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.title || 'Gallery image'}
                        className="w-full bg-muted object-cover transition-all duration-700 group-hover:scale-[1.01]"
                        loading="lazy"
                        decoding="async"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
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
              </FadeInSection>
            )}
          </TabsContent>

          <TabsContent value="inspo" className="mt-0 space-y-6">
            <FadeInSection delayMs={60}>
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-lg font-medium text-foreground">Want more ideas?</p>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                    We are building out this area to surface inspiration, concepts, and strategic
                    directions tailored to your brand. For now, the best next step is a quick call
                    so we can build more context around your goals, audience, and market strategy.
                  </p>
                  <div className="mt-6">
                    <Button variant="outline" asChild>
                      <a
                        href="https://cal.com/carlcahill/flexi-design"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Book a Call
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </FadeInSection>

            <FadeInSection delayMs={100}>
              <Card>
                <CardHeader>
                  <CardTitle>All the ways Salo can help</CardTitle>
                  <CardDescription>
                    Browse our Flexi-Design deliverables by category. Credit figures are estimates
                    and may vary with scope and complexity.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {servicesError ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Couldn’t load the services catalog ({servicesError}). If you just ran the
                      migration, reload the Supabase API schema and confirm{' '}
                      <code className="rounded bg-muted px-1">flexi_design_services</code> has rows.
                    </p>
                  ) : services.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Service catalog is empty. Run migration{' '}
                      <code className="rounded bg-muted px-1">068_flexi_design_services_reseed.sql</code>{' '}
                      (or the seed section of 067) in Supabase, then refresh.
                    </p>
                  ) : selectedServiceCategory && SelectedCategoryIcon ? (
                    <div className="space-y-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2 w-fit"
                          onClick={() => setSelectedServiceCategory(null)}
                        >
                          <ArrowLeft className="mr-2 h-4 w-4" />
                          All categories
                        </Button>
                        <div className="flex items-center gap-2">
                          <SelectedCategoryIcon className="h-5 w-5 text-muted-foreground" />
                          <h3 className="text-lg font-semibold">{selectedServiceCategory}</h3>
                          <span className="text-sm text-muted-foreground">
                            {selectedCategoryServices.length} service
                            {selectedCategoryServices.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {selectedCategoryServices.map((service) => (
                          <div
                            key={service.id}
                            className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <h4 className="font-medium text-foreground">{service.title}</h4>
                              {service.description && (
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {service.description}
                                </p>
                              )}
                            </div>
                            <div className="shrink-0 text-right sm:pt-0.5">
                              <div className="text-sm font-semibold tabular-nums text-primary">
                                ~{formatCredits(service.credit_estimate)} credit
                                {Number(service.credit_estimate) === 1 ? '' : 's'}
                              </div>
                              <div className="text-xs text-muted-foreground">estimate</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {serviceCategories.map(({ category, count }) => {
                        const Icon = getFlexiServiceCategoryIcon(category)
                        return (
                          <button
                            key={category}
                            type="button"
                            onClick={() => setSelectedServiceCategory(category)}
                            className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground transition-colors group-hover:border-foreground/20">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 pt-0.5">
                              <div className="font-medium text-foreground">{category}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {count} deliverable{count !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </FadeInSection>

            {inspoMarqueeItems.length > 0 && (
              <FadeInSection delayMs={140} className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2">
                <section className="bg-black py-10 md:py-12">
                  <div className="mx-auto mb-6 flex max-w-7xl items-end justify-between gap-4 px-4 md:px-6 lg:px-8">
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
                        Studio inspiration
                      </h2>
                      <p className="mt-1 text-sm text-zinc-400">
                        A random selection of Flexi-Design work from across the studio.
                      </p>
                    </div>
                    <div
                      className="flex shrink-0 items-center rounded-md border border-zinc-800 bg-zinc-950 p-0.5"
                      role="group"
                      aria-label="Marquee speed"
                    >
                      {(
                        [
                          { id: 'slow', label: 'Slow' },
                          { id: 'medium', label: 'Medium' },
                          { id: 'fast', label: 'Fast' },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setInspoMarqueeSpeed(option.id)}
                          className={cn(
                            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                            inspoMarqueeSpeed === option.id
                              ? 'bg-zinc-100 text-zinc-950'
                              : 'text-zinc-400 hover:text-zinc-200'
                          )}
                          aria-pressed={inspoMarqueeSpeed === option.id}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-black via-black/80 to-transparent sm:w-24 md:w-32" />
                    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-black via-black/80 to-transparent sm:w-24 md:w-32" />

                    <div className="overflow-hidden py-2">
                      <div
                        className={cn(
                          'flex min-w-max items-center gap-4 will-change-transform px-4 motion-reduce:animate-none sm:gap-5',
                          inspoMarqueeSpeed === 'slow' &&
                            'animate-[marquee-left_180s_linear_infinite]',
                          inspoMarqueeSpeed === 'medium' &&
                            'animate-[marquee-left_100s_linear_infinite]',
                          inspoMarqueeSpeed === 'fast' &&
                            'animate-[marquee-left_55s_linear_infinite]'
                        )}
                      >
                        {[...inspoMarqueeItems, ...inspoMarqueeItems].map((item, itemIndex) => {
                          const isLandscape = inspoLandscapeIds[item.id] === true
                          return (
                            <button
                              key={`${item.loopKey}-${itemIndex}`}
                              type="button"
                              className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() =>
                                setViewingGalleryItem({
                                  id: item.id,
                                  title: item.title,
                                  caption: item.caption,
                                  storage_path: item.storage_path,
                                  mime_type: item.mime_type,
                                  url: item.url,
                                })
                              }
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={item.url}
                                alt={item.title || 'Studio inspiration'}
                                className={cn(
                                  'h-auto rounded-md',
                                  isLandscape
                                    ? 'w-[22rem] sm:w-[26rem] lg:w-[30rem]'
                                    : 'w-44 sm:w-52 lg:w-60'
                                )}
                                loading="lazy"
                                decoding="async"
                                onLoad={(event) => {
                                  const image = event.currentTarget
                                  const landscape = image.naturalWidth > image.naturalHeight
                                  setInspoLandscapeIds((current) => {
                                    if (current[item.id] === landscape) return current
                                    return { ...current, [item.id]: landscape }
                                  })
                                }}
                              />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              </FadeInSection>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-4 lg:items-start">
              <FadeInSection delayMs={60} className="lg:col-span-3">
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
                      <p className="text-muted-foreground text-center py-8">
                        No completed projects
                      </p>
                    ) : (
                      <div className="space-y-6">
                        {completedProjectsByMonth.map((group, groupIndex) => (
                          <div
                            key={group.monthKey}
                            className="space-y-3"
                            style={{
                              contentVisibility: 'auto',
                              containIntrinsicSize: '240px',
                            }}
                          >
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
                              {group.projects.map((project, index) => (
                                <div
                                  key={project.id}
                                  className="flex items-center justify-between rounded-lg border p-4 transition-all duration-500 hover:bg-muted/50 motion-reduce:transition-none"
                                  style={{
                                    transitionDelay: `${Math.min(groupIndex * 40 + index * 30, 220)}ms`,
                                  }}
                                >
                                  <div className="flex-1">
                                    <h3 className="font-medium">{project.name}</h3>
                                    <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
                                      {project.completed_date && (
                                        <span>
                                          Completed {formatDate(project.completed_date)}
                                        </span>
                                      )}
                                      {project.quoted_hours !== null && (
                                        <span>
                                          {formatCredits(project.quoted_hours)} credits
                                        </span>
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
              </FadeInSection>

              <FadeInSection delayMs={100} className="lg:col-span-1">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <History className="h-5 w-5 shrink-0" />
                      Credit History
                    </CardTitle>
                    <CardDescription>Credit additions</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {creditTransactions.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No credit transactions yet
                      </p>
                    ) : (
                      <div className="max-h-[36rem] space-y-2 overflow-y-auto">
                        {creditTransactions.map((transaction) => (
                          <div
                            key={transaction.id}
                            className="rounded-lg border p-3"
                          >
                            <div className="font-medium text-green-500">
                              +{formatCredits(transaction.hours)} credits
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {formatDate(transaction.transaction_date)}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground/80">
                              Added {formatDate(transaction.created_at)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </FadeInSection>
            </div>
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

    </div>
  )
}
