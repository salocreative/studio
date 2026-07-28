'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Plus, History, Link as LinkIcon, Copy, Check, Loader2, Pencil, Trash2 } from 'lucide-react'
import { 
  getFlexiDesignClients, 
  getFlexiDesignClientDetail, 
  updateFlexiDesignClientCredit,
  getFlexiDesignShareLinks,
  createFlexiDesignShareLink,
  deactivateFlexiDesignShareLink,
  updateFlexiDesignCreditTransaction,
  deleteFlexiDesignCreditTransaction,
  type FlexiDesignShareLink,
  type FlexiDesignClientsSummary,
} from '@/app/actions/flexi-design'
import { FlexiClientFilesTab } from './flexi-client-files-tab'
import { FlexiClientGalleryTab } from './flexi-client-gallery-tab'
import { FlexiClientContactsTab } from './flexi-client-contacts-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { format, differenceInMonths, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface FlexiDesignClient {
  id: string
  client_name: string
  remaining_hours: number
  total_credits?: number
  total_projects: number
  active_projects?: number
  hours_used: number // logged hours for internal tracking
  quoted_hours_used?: number // quoted hours for credit deduction
  last_credit_hours?: number | null
  last_credit_date?: string | null
  avg_credit_purchase?: number | null
}

interface FlexiDesignProject {
  id: string
  name: string
  status: 'active' | 'archived' | 'locked'
  total_logged_hours: number
  quoted_hours?: number | null
  created_at: string
  completed_date?: string | null
}

interface ClientDetail {
  id: string
  client_name: string
  remaining_hours: number
  hours_used: number // logged hours for internal tracking
  quoted_hours_used?: number // quoted hours for credit deduction
  total_projects: number
  projects: FlexiDesignProject[]
  credit_transactions?: Array<{
    id: string
    hours: number
    transaction_date: string
    created_at: string
    created_by: string | null
  }>
  completed_projects?: FlexiDesignProject[]
  completed_quoted_hours?: number
  completed_logged_hours?: number
}

function FlexiDesignPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientName = searchParams.get('client')
  
  const [clients, setClients] = useState<FlexiDesignClient[]>([])
  const [listSummary, setListSummary] = useState<FlexiDesignClientsSummary>({
    active_projects: 0,
    completed_projects: 0,
    credits_used: 0,
    unused_credits: 0,
    time_logged_this_week: 0,
  })
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreditDialog, setShowCreditDialog] = useState(false)
  const [showCreditHistoryDialog, setShowCreditHistoryDialog] = useState(false)
  const [creditHours, setCreditHours] = useState('')
  const [creditDate, setCreditDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [selectedClientForCredit, setSelectedClientForCredit] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shareLinks, setShareLinks] = useState<FlexiDesignShareLink[]>([])
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [creatingLink, setCreatingLink] = useState(false)
  const [copiedLink, setCopiedLink] = useState<string | null>(null)
  const [showEditTransactionDialog, setShowEditTransactionDialog] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<NonNullable<ClientDetail['credit_transactions']>[number] | null>(null)
  const [editTransactionHours, setEditTransactionHours] = useState('')
  const [editTransactionDate, setEditTransactionDate] = useState('')
  const [savingTransaction, setSavingTransaction] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  useEffect(() => {
    if (clientName) {
      loadClientDetail(clientName)
    } else {
      setClientDetail(null)
      setShareLinks([])
    }
  }, [clientName])

  useEffect(() => {
    if (clientDetail?.client_name) {
      loadShareLinks()
    }
  }, [clientDetail?.id, clientDetail?.client_name])

  async function loadClients() {
    setLoading(true)
    setError(null)
    try {
      const result = await getFlexiDesignClients()
      if (result.error) {
        console.error('Error loading clients:', result.error)
        setError(result.error)
        // Show toast for migration errors
        if (result.error.includes('table not found') || result.error.includes('migration')) {
          toast.error('Database Setup Required', { 
            description: 'Please run the Flexi-Design clients migrations in Supabase Dashboard → SQL Editor.',
            duration: 10000
          })
        } else {
          toast.error('Error loading clients', { description: result.error })
        }
      } else if (result.clients) {
        setClients(result.clients)
        if (result.summary) {
          setListSummary(result.summary)
        }
        setError(null)
      }
    } catch (error) {
      console.error('Error loading clients:', error)
      const errorMsg = error instanceof Error ? error.message : 'An unexpected error occurred'
      setError(errorMsg)
      toast.error('Error loading clients', { description: errorMsg })
    } finally {
      setLoading(false)
    }
  }

  async function loadClientDetail(clientNameParam: string) {
    setDetailLoading(true)
    try {
      const result = await getFlexiDesignClientDetail(clientNameParam)
      if (result.error) {
        console.error('Error loading client detail:', result.error)
        toast.error('Error loading client details', { description: result.error })
      } else if (result.client) {
        setClientDetail(result.client)
      }
    } catch (error) {
      console.error('Error loading client detail:', error)
      toast.error('Error loading client details')
    } finally {
      setDetailLoading(false)
    }
  }

  async function loadShareLinks() {
    // Only load if we have client detail with ID
    if (!clientDetail?.id) return
    
    try {
      const result = await getFlexiDesignShareLinks(clientDetail.id)
      if (result.error) {
        console.error('Error loading share links:', result.error)
      } else if (result.success && result.shareLinks) {
        setShareLinks(result.shareLinks)
      }
    } catch (error) {
      console.error('Error loading share links:', error)
    }
  }

  async function handleCreateShareLink() {
    if (!clientDetail?.client_name) return
    setCreatingLink(true)
    try {
      const result = await createFlexiDesignShareLink(clientDetail.client_name)
      if (result.error) {
        toast.error('Error creating share link', { description: result.error })
      } else if (result.success && result.shareLink) {
        toast.success('Share link created successfully')
        await loadShareLinks()
      }
    } catch (error) {
      console.error('Error creating share link:', error)
      toast.error('Error creating share link')
    } finally {
      setCreatingLink(false)
    }
  }

  async function handleDeactivateLink(linkId: string) {
    try {
      const result = await deactivateFlexiDesignShareLink(linkId)
      if (result.error) {
        toast.error('Error deactivating link', { description: result.error })
      } else {
        toast.success('Share link deactivated')
        await loadShareLinks()
      }
    } catch (error) {
      console.error('Error deactivating link:', error)
      toast.error('Error deactivating link')
    }
  }

  function openEditTransactionDialog(transaction: NonNullable<ClientDetail['credit_transactions']>[number]) {
    setEditingTransaction(transaction)
    setEditTransactionHours(String(transaction.hours))
    setEditTransactionDate(transaction.transaction_date)
    setShowEditTransactionDialog(true)
  }

  async function handleSaveEditedTransaction() {
    if (!editingTransaction) return

    const hours = parseFloat(editTransactionHours)
    if (Number.isNaN(hours)) {
      toast.error('Please enter a valid number of hours')
      return
    }

    setSavingTransaction(true)
    try {
      const result = await updateFlexiDesignCreditTransaction(editingTransaction.id, {
        hours,
        transaction_date: editTransactionDate,
      })

      if (result.error) {
        toast.error('Error updating transaction', { description: result.error })
        return
      }

      toast.success('Transaction updated')

      if (clientName) {
        await loadClientDetail(clientName)
      }

      setShowEditTransactionDialog(false)
      setEditingTransaction(null)
    } catch (error) {
      console.error('Error updating transaction:', error)
      toast.error('Error updating transaction')
    } finally {
      setSavingTransaction(false)
    }
  }

  async function handleDeleteTransaction(transactionId: string) {
    const confirmed = window.confirm('Delete this credit entry? This cannot be undone.')
    if (!confirmed) return

    try {
      const result = await deleteFlexiDesignCreditTransaction(transactionId)
      if (result.error) {
        toast.error('Error deleting transaction', { description: result.error })
        return
      }
      toast.success('Transaction deleted')

      if (clientName) {
        await loadClientDetail(clientName)
      }
    } catch (error) {
      console.error('Error deleting transaction:', error)
      toast.error('Error deleting transaction')
    }
  }

  function handleCopyLink(token: string, linkId: string) {
    const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/flexi-design/share/${token}`
    navigator.clipboard.writeText(shareUrl)
    setCopiedLink(linkId)
    toast.success('Link copied to clipboard')
    setTimeout(() => setCopiedLink(null), 2000)
  }

  const handleClientClick = (clientName: string) => {
    router.push(`/flexi-design?client=${encodeURIComponent(clientName)}`)
  }

  const handleAddCredit = (clientName: string) => {
    setSelectedClientForCredit(clientName)
    setCreditHours('')
    setCreditDate(format(new Date(), 'yyyy-MM-dd'))
    setShowCreditDialog(true)
  }

  const handleSaveCredit = async () => {
    if (!selectedClientForCredit || !creditHours) {
      toast.error('Please enter hours to add')
      return
    }

    const hours = parseFloat(creditHours)
    if (isNaN(hours) || hours <= 0) {
      toast.error('Please enter a valid number of hours')
      return
    }

    try {
      const result = await updateFlexiDesignClientCredit(selectedClientForCredit, hours, creditDate)
      if (result.error) {
        toast.error('Error updating credit', { description: result.error })
      } else {
        toast.success(`Added ${hours} hours to ${selectedClientForCredit}`)
        const wasViewingClient = selectedClientForCredit === clientName
        setShowCreditDialog(false)
        setCreditHours('')
        setSelectedClientForCredit(null)
        setCreditDate(format(new Date(), 'yyyy-MM-dd'))
        
        // Reload clients and client detail if viewing that client
        await loadClients()
        if (wasViewingClient && clientName) {
          await loadClientDetail(clientName)
        }
      }
    } catch (error) {
      console.error('Error updating credit:', error)
      toast.error('Error updating credit')
    }
  }

  // Balance health is remaining vs the client's average credit purchase size.
  // Fallback target when no purchase history: 40.
  const CREDIT_BALANCE_FALLBACK_TARGET = 40

  type CreditBalanceTone = 'healthy' | 'watch' | 'low' | 'critical'

  function getCreditBalanceTarget(avgCreditPurchase?: number | null) {
    const avg = Number(avgCreditPurchase)
    if (!Number.isFinite(avg) || avg <= 0) return CREDIT_BALANCE_FALLBACK_TARGET
    return avg
  }

  function getCreditBalanceTone(
    remainingHours: number,
    avgCreditPurchase?: number | null
  ): CreditBalanceTone {
    const target = getCreditBalanceTarget(avgCreditPurchase)
    if (remainingHours < 0) return 'critical'
    if (remainingHours < target * 0.25) return 'low'
    if (remainingHours < target * 0.5) return 'watch'
    return 'healthy'
  }

  function getCreditStatusColor(remainingHours: number, avgCreditPurchase?: number | null) {
    switch (getCreditBalanceTone(remainingHours, avgCreditPurchase)) {
      case 'critical':
        return 'text-destructive'
      case 'low':
        return 'text-orange-500'
      case 'watch':
        return 'text-amber-600 dark:text-amber-500'
      case 'healthy':
        return 'text-emerald-600 dark:text-emerald-500'
    }
  }

  function getCreditBalanceBarClass(remainingHours: number, avgCreditPurchase?: number | null) {
    switch (getCreditBalanceTone(remainingHours, avgCreditPurchase)) {
      case 'critical':
        return 'bg-destructive'
      case 'low':
        return 'bg-orange-500'
      case 'watch':
        return 'bg-amber-500'
      case 'healthy':
        return 'bg-emerald-500'
    }
  }

  function getCreditBalanceLabel(remainingHours: number, avgCreditPurchase?: number | null) {
    switch (getCreditBalanceTone(remainingHours, avgCreditPurchase)) {
      case 'critical':
        return 'Overdrawn'
      case 'low':
        return 'Low'
      case 'watch':
        return 'Watch'
      case 'healthy':
        return 'Healthy'
    }
  }

  function getCreditBalancePercent(remainingHours: number, avgCreditPurchase?: number | null) {
    if (remainingHours <= 0) return 0
    const target = getCreditBalanceTarget(avgCreditPurchase)
    return Math.min(100, (remainingHours / target) * 100)
  }

  function formatBalanceTarget(avgCreditPurchase?: number | null) {
    const target = getCreditBalanceTarget(avgCreditPurchase)
    return target >= 10 ? target.toFixed(0) : target.toFixed(1)
  }

  // Group completed projects by completion month (falling back to created_at)
  const completedProjectsByMonth = (() => {
    if (!clientDetail?.completed_projects || clientDetail.completed_projects.length === 0) {
      return [] as Array<{
        monthKey: string
        monthLabel: string
        projects: FlexiDesignProject[]
        totalQuoted: number
        totalLogged: number
      }>
    }

    const groups = new Map<string, { monthLabel: string; monthDate: Date; projects: FlexiDesignProject[]; totalQuoted: number; totalLogged: number }>()

    for (const project of clientDetail.completed_projects) {
      const dateSource = project.completed_date || project.created_at
      if (!dateSource) continue
      const date = parseISO(dateSource)
      if (Number.isNaN(date.getTime())) continue

      const monthKey = format(date, 'yyyy-MM')
      const monthLabel = format(date, 'MMMM yyyy')
      const existing = groups.get(monthKey)
      if (existing) {
        existing.projects.push(project)
        existing.totalQuoted += project.quoted_hours || 0
        existing.totalLogged += project.total_logged_hours || 0
      } else {
        groups.set(monthKey, {
          monthLabel,
          monthDate: new Date(date.getFullYear(), date.getMonth(), 1),
          projects: [project],
          totalQuoted: project.quoted_hours || 0,
          totalLogged: project.total_logged_hours || 0,
        })
      }
    }

    return Array.from(groups.entries())
      .map(([monthKey, value]) => ({ monthKey, ...value }))
      .sort((a, b) => b.monthDate.getTime() - a.monthDate.getTime())
  })()

  // Calculate average hours per month
  const calculateAvgHoursPerMonth = () => {
    if (!clientDetail) return 0
    
    // Get the earliest date from projects or credit transactions
    const allDates: Date[] = []
    
    // Add project creation dates
    clientDetail.projects.forEach(p => {
      if (p.created_at) allDates.push(parseISO(p.created_at))
    })
    
    // Add completed project dates
    clientDetail.completed_projects?.forEach(p => {
      if (p.completed_date) {
        allDates.push(parseISO(p.completed_date))
      } else if (p.created_at) {
        allDates.push(parseISO(p.created_at))
      }
    })
    
    // Add credit transaction dates
    clientDetail.credit_transactions?.forEach(tx => {
      if (tx.transaction_date) allDates.push(parseISO(tx.transaction_date))
    })
    
    if (allDates.length === 0) return 0
    
    const earliestDate = new Date(Math.min(...allDates.map(d => d.getTime())))
    const now = new Date()
    const monthsDiff = differenceInMonths(now, earliestDate)
    
    // Ensure at least 1 month to avoid division by zero
    const months = Math.max(1, monthsDiff + 1)
    
    // quoted_hours_used from the server is already active + completed quoted (credit consumption)
    const totalQuoted = clientDetail.quoted_hours_used || 0

    return totalQuoted / months
  }

  // Average size of credit purchases — same basis as the client list balance target
  const detailAvgCreditPurchase = (() => {
    if (!clientDetail) return null
    const txs = clientDetail.credit_transactions || []
    if (txs.length === 0) return null
    const totalDeposited = txs.reduce((sum, tx) => sum + (Number(tx.hours) || 0), 0)
    return totalDeposited / txs.length
  })()

  if (clientDetail) {
    // Show client detail view
    return (
      <div className="flex flex-col h-full">
        <div className="border-b bg-background">
          <div className="flex h-16 items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push('/flexi-design')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold">{clientDetail.client_name}</h1>
                <p className="text-sm text-muted-foreground">Flexi-Design Client Details</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setShowShareDialog(true)}
              >
                <LinkIcon className="mr-2 h-4 w-4" />
                Share Link
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowCreditHistoryDialog(true)}
              >
                <History className="mr-2 h-4 w-4" />
                Credit History
              </Button>
              <Button onClick={() => handleAddCredit(clientDetail.client_name)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Credit
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground">Loading client details...</div>
            </div>
          ) : (
            <Tabs defaultValue="projects" className="space-y-6">
              <TabsList>
                <TabsTrigger value="projects">Projects</TabsTrigger>
                <TabsTrigger value="files">Files</TabsTrigger>
                <TabsTrigger value="gallery">Gallery</TabsTrigger>
                <TabsTrigger value="contacts">Contacts</TabsTrigger>
              </TabsList>

              <TabsContent value="projects" className="mt-0 space-y-6">
              {/* Summary Stats - 4 boxes */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Box 1: Remaining Hours */}
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Remaining Hours
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={cn(
                      "text-3xl font-bold",
                      getCreditStatusColor(
                        clientDetail.remaining_hours,
                        detailAvgCreditPurchase
                      )
                    )}>
                      {clientDetail.remaining_hours.toFixed(1)}
                    </div>
                  </CardContent>
                </Card>

                {/* Box 2: Total Projects */}
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Completed projects
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{clientDetail.completed_projects?.length}</div>
                  </CardContent>
                </Card>

                {/* Box 3: Quoted total (credits consumed) — server already sums active + completed quoted */}
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total quoted (credits)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {(clientDetail.quoted_hours_used || 0).toFixed(1)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Logged:{' '}
                      {((clientDetail.hours_used || 0) + (clientDetail.completed_logged_hours || 0)).toFixed(1)}h
                    </p>
                  </CardContent>
                </Card>

                {/* Box 4: Avg Hours Per Month */}
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Avg hours per month
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {calculateAvgHoursPerMonth().toFixed(1)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Projects in Two Columns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Active Projects */}
                <Card>
                  <CardHeader>
                    <CardTitle>Active Projects</CardTitle>
                    <CardDescription>Current projects for this client</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {clientDetail.projects.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No active projects found
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {clientDetail.projects.map((project) => (
                          <div
                            key={project.id}
                            className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{project.name}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {format(new Date(project.created_at), 'MMM d, yyyy')}
                                {project.total_logged_hours > 0 && (
                                  <span className="ml-2">• {project.total_logged_hours.toFixed(1)} logged</span>
                                )}
                              </div>
                            </div>
                            {project.quoted_hours && (
                              <div className="ml-4 text-right">
                                <div className="text-lg font-bold text-primary">
                                  {project.quoted_hours.toFixed(1)}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Right: Completed Projects */}
                <Card>
                  <CardHeader>
                    <CardTitle>Completed Projects</CardTitle>
                    <CardDescription>Grouped by completion month</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {completedProjectsByMonth.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No completed projects found
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {completedProjectsByMonth.map((group) => (
                          <div key={group.monthKey} className="space-y-2">
                            <div className="flex items-center justify-between border-b pb-1.5">
                              <div className="flex items-baseline gap-2">
                                <div className="font-semibold text-sm">{group.monthLabel}</div>
                                <div className="text-xs text-muted-foreground">
                                  {group.projects.length} project{group.projects.length !== 1 ? 's' : ''}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-bold text-primary">
                                  {group.totalQuoted.toFixed(1)} credits
                                </div>
                                {group.totalLogged > 0 && (
                                  <div className="text-[10px] text-muted-foreground leading-tight">
                                    {group.totalLogged.toFixed(1)}h logged
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {group.projects.map((project) => (
                                <div
                                  key={project.id}
                                  className="flex items-center justify-between p-3 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">{project.name}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                      {project.completed_date
                                        ? format(new Date(project.completed_date), 'MMM d, yyyy')
                                        : format(new Date(project.created_at), 'MMM d, yyyy')}
                                      {project.total_logged_hours > 0 && (
                                        <span className="ml-2">• {project.total_logged_hours.toFixed(1)} logged</span>
                                      )}
                                    </div>
                                  </div>
                                  {project.quoted_hours && (
                                    <div className="ml-4 text-right">
                                      <div className="text-lg font-bold text-primary">
                                        {project.quoted_hours.toFixed(1)}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
              </TabsContent>

              <TabsContent value="files" className="mt-0">
                <FlexiClientFilesTab clientId={clientDetail.id} />
              </TabsContent>

              <TabsContent value="gallery" className="mt-0">
                <FlexiClientGalleryTab clientId={clientDetail.id} />
              </TabsContent>

              <TabsContent value="contacts" className="mt-0">
                <FlexiClientContactsTab clientId={clientDetail.id} />
              </TabsContent>
            </Tabs>
          )}
        </div>

        {/* Share Link Dialog */}
        <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share Flexi-Design Account</DialogTitle>
              <DialogDescription>
                Create a public link to share this Flexi-Design account overview with the client.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {shareLinks.filter(link => link.is_active).length > 0 && (
                <div className="space-y-2">
                  <Label>Active Share Links</Label>
                  <div className="space-y-2">
                    {shareLinks.filter(link => link.is_active).map((link) => {
                      const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/flexi-design/share/${link.share_token}`
                      return (
                        <div key={link.id} className="flex items-center gap-2 p-2 border rounded">
                          <Input value={shareUrl} readOnly className="flex-1 font-mono text-xs" />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopyLink(link.share_token, link.id)}
                          >
                            {copiedLink === link.id ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeactivateLink(link.id)}
                            title="Deactivate link"
                          >
                            <LinkIcon className="h-4 w-4" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowShareDialog(false)}>
                  Close
                </Button>
                <Button onClick={handleCreateShareLink} disabled={creatingLink}>
                  {creatingLink ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Share Link
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Credit Dialog */}
        <Dialog open={showCreditDialog} onOpenChange={setShowCreditDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Credit Hours</DialogTitle>
              <DialogDescription>
                Add credit hours to {selectedClientForCredit}. Common blocks: 20, 40, 60, 80 hours.
              </DialogDescription>
            </DialogHeader>
              <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="hours">Hours to Add</Label>
                <Input
                  id="hours"
                  type="number"
                  placeholder="e.g., 20, 40, 60, 80"
                  value={creditHours}
                  onChange={(e) => setCreditHours(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreditHours('20')}
                >
                  20h
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreditHours('40')}
                >
                  40h
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreditHours('60')}
                >
                  60h
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreditHours('80')}
                >
                  80h
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="credit-date">Credit Date</Label>
                <Input
                  id="credit-date"
                  type="date"
                  value={creditDate}
                  onChange={(e) => setCreditDate(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreditDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveCredit}>
                Add Credit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Credit History Dialog */}
        <Dialog open={showCreditHistoryDialog} onOpenChange={setShowCreditHistoryDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Credit History</DialogTitle>
              <DialogDescription>
                History of all credit additions for {clientDetail.client_name}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {!clientDetail.credit_transactions || clientDetail.credit_transactions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No credit transactions yet
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {clientDetail.credit_transactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-green-600">
                          +{transaction.hours.toFixed(1)} hours
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5">
                          Transaction Date: {format(new Date(transaction.transaction_date), 'MMM d, yyyy')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-muted-foreground mr-2">
                          Added {format(new Date(transaction.created_at), 'MMM d, yyyy')}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditTransactionDialog(transaction)}
                          title="Edit credit entry"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteTransaction(transaction.id)}
                          title="Delete credit entry"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
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

        {/* Edit Credit Transaction Dialog */}
        <Dialog open={showEditTransactionDialog} onOpenChange={setShowEditTransactionDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit credit entry</DialogTitle>
              <DialogDescription>
                Update hours or transaction date.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="edit-hours">Hours</Label>
                <Input
                  id="edit-hours"
                  type="number"
                  value={editTransactionHours}
                  onChange={(e) => setEditTransactionHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-date">Transaction date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={editTransactionDate}
                  onChange={(e) => setEditTransactionDate(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowEditTransactionDialog(false)
                  setEditingTransaction(null)
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveEditedTransaction} disabled={savingTransaction}>
                {savingTransaction ? 'Saving...' : 'Save changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // Show client list view
  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-2xl font-semibold">Flexi-Design</h1>
            <p className="text-sm text-muted-foreground">Manage client credits and view project logs</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center text-muted-foreground">Loading clients...</div>
          </div>
        ) : error ? (
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive">Database Setup Required</CardTitle>
              <CardDescription>
                The Flexi-Design clients table has not been created yet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <p className="mb-2">To enable Flexi-Design client management, please run the database migration:</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Open your Supabase Dashboard</li>
                  <li>Go to SQL Editor</li>
                  <li>Open the migration file: <code className="bg-muted px-1 rounded">supabase/migrations/004_add_flexi_design_clients.sql</code></li>
                  <li>Copy and paste the SQL into the SQL Editor</li>
                  <li>Click &quot;Run&quot; to execute the migration</li>
                </ol>
                <p className="mt-4 text-xs">
                  Error: {error}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  {
                    label: 'Active projects',
                    value: String(listSummary.active_projects),
                  },
                  {
                    label: 'Completed projects',
                    value: String(listSummary.completed_projects),
                  },
                  {
                    label: 'Credits used',
                    value: listSummary.credits_used.toFixed(1),
                  },
                  {
                    label: 'Unused credits',
                    value: listSummary.unused_credits.toFixed(1),
                    className:
                      listSummary.unused_credits < 0
                        ? 'text-destructive'
                        : undefined,
                  },
                  {
                    label: 'Time logged this week',
                    value: `${listSummary.time_logged_this_week.toFixed(1)}h`,
                  },
                ] as Array<{ label: string; value: string; className?: string }>
              ).map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                  <div
                    className={cn(
                      'mt-0.5 text-base font-semibold tabular-nums',
                      stat.className
                    )}
                  >
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {clients.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center text-muted-foreground">
                    <p>No Flexi-Design clients found</p>
                    <p className="text-sm mt-2">
                      Clients will appear here once they have projects or credits. Hide inactive
                      clients in Settings.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clients.map((client) => {
                  const activeProjects = client.active_projects ?? 0
                  const avgPurchase = client.avg_credit_purchase
                  const balancePercent = getCreditBalancePercent(client.remaining_hours, avgPurchase)
                  const balanceLabel = getCreditBalanceLabel(client.remaining_hours, avgPurchase)
                  const balanceTargetLabel = formatBalanceTarget(avgPurchase)

                  const lastCreditLabel = (() => {
                    if (!client.last_credit_date) return '—'
                    const hours =
                      client.last_credit_hours == null
                        ? null
                        : Number(client.last_credit_hours)
                    const dateLabel = (() => {
                      try {
                        return format(
                          parseISO(String(client.last_credit_date).slice(0, 10)),
                          'd MMM yyyy'
                        )
                      } catch {
                        return String(client.last_credit_date)
                      }
                    })()
                    if (hours == null || Number.isNaN(hours)) return dateLabel
                    return `${hours.toFixed(1)}h · ${dateLabel}`
                  })()

                  return (
                    <Card
                      key={client.client_name}
                      className="cursor-pointer gap-2 py-5 hover:shadow-md transition-shadow"
                      onClick={() => handleClientClick(client.client_name)}
                    >
                      <CardHeader className="pb-0">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-lg">{client.client_name}</CardTitle>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAddCredit(client.client_name)
                            }}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4 pt-0">
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <div className="text-xs text-muted-foreground">Active</div>
                            <div className="mt-0.5 text-lg font-semibold tabular-nums">
                              {activeProjects}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Completed</div>
                            <div className="mt-0.5 text-lg font-semibold tabular-nums">
                              {Math.max(0, client.total_projects - activeProjects)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Credits</div>
                            <div
                              className={cn(
                                'mt-0.5 text-lg font-semibold tabular-nums',
                                getCreditStatusColor(client.remaining_hours, avgPurchase)
                              )}
                            >
                              {client.remaining_hours.toFixed(1)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs">
                          <span className="text-muted-foreground">Last credit added</span>
                          <span className="text-right font-medium tabular-nums text-foreground">
                            {lastCreditLabel}
                          </span>
                        </div>

                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                            <span>Credit balance</span>
                            <span>
                              {balanceLabel}
                              {client.remaining_hours > 0
                                ? ` · ${client.remaining_hours.toFixed(1)} / ${balanceTargetLabel} avg`
                                : ''}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                'h-full transition-all',
                                getCreditBalanceBarClass(client.remaining_hours, avgPurchase)
                              )}
                              style={{
                                width:
                                  client.remaining_hours < 0
                                    ? '100%'
                                    : `${balancePercent}%`,
                              }}
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Credit Dialog */}
        <Dialog open={showCreditDialog} onOpenChange={setShowCreditDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Credit Hours</DialogTitle>
              <DialogDescription>
                Add credit hours to {selectedClientForCredit}. Common blocks: 20, 40, 60, 80 hours.
              </DialogDescription>
            </DialogHeader>
              <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="hours">Hours to Add</Label>
                <Input
                  id="hours"
                  type="number"
                  placeholder="e.g., 20, 40, 60, 80"
                  value={creditHours}
                  onChange={(e) => setCreditHours(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreditHours('20')}
                >
                  20h
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreditHours('40')}
                >
                  40h
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreditHours('60')}
                >
                  60h
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreditHours('80')}
                >
                  80h
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="credit-date">Credit Date</Label>
                <Input
                  id="credit-date"
                  type="date"
                  value={creditDate}
                  onChange={(e) => setCreditDate(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreditDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveCredit}>
                Add Credit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

export default function FlexiDesignPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col h-full">
        <div className="border-b bg-background">
          <div className="flex h-16 items-center justify-between px-6">
            <div>
              <h1 className="text-2xl font-semibold">Flexi-Design</h1>
              <p className="text-sm text-muted-foreground">Manage client credits and view project logs</p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-center py-12">
            <div className="text-center text-muted-foreground">Loading...</div>
          </div>
        </div>
      </div>
    }>
      <FlexiDesignPageContent />
    </Suspense>
  )
}

