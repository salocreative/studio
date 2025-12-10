'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Plus } from 'lucide-react'
import { getFlexiDesignClients, getFlexiDesignClientDetail, updateFlexiDesignClientCredit } from '@/app/actions/flexi-design'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface FlexiDesignClient {
  id: string
  client_name: string
  remaining_hours: number
  total_projects: number
  hours_used: number // logged hours for internal tracking
  quoted_hours_used?: number // quoted hours for credit deduction
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
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreditDialog, setShowCreditDialog] = useState(false)
  const [creditHours, setCreditHours] = useState('')
  const [creditDate, setCreditDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [selectedClientForCredit, setSelectedClientForCredit] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadClients()
  }, [])

  useEffect(() => {
    if (clientName) {
      loadClientDetail(clientName)
    } else {
      setClientDetail(null)
    }
  }, [clientName])

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
            description: 'Please run migration 004_add_flexi_design_clients.sql in Supabase Dashboard → SQL Editor.',
            duration: 10000
          })
        } else {
          toast.error('Error loading clients', { description: result.error })
        }
      } else if (result.clients) {
        setClients(result.clients)
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

  const getCreditStatusColor = (remainingHours: number, quotedHoursUsed: number) => {
    const totalDeposited = remainingHours + quotedHoursUsed
    if (totalDeposited === 0) return 'text-muted-foreground'
    const percentage = (quotedHoursUsed / totalDeposited) * 100
    if (percentage >= 90) return 'text-destructive'
    if (percentage >= 75) return 'text-orange-500'
    return 'text-foreground'
  }

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
            <Button onClick={() => handleAddCredit(clientDetail.client_name)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Credit
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground">Loading client details...</div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Remaining Hours
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={cn(
                      "text-3xl font-bold",
                      getCreditStatusColor(
                        clientDetail.remaining_hours, 
                        clientDetail.quoted_hours_used || 0
                      )
                    )}>
                      {clientDetail.remaining_hours.toFixed(1)}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-primary/20 bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      Quoted Hours (From Monday)
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Total estimated hours that affect credit
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold text-primary">
                      {(clientDetail.quoted_hours_used || 0).toFixed(1)}h
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Logged Hours (Performance)
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Actual time logged for tracking
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-medium text-muted-foreground">{clientDetail.hours_used.toFixed(1)}h</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total Projects
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{clientDetail.total_projects}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Credit Transactions List */}
              <Card>
                <CardHeader>
                  <CardTitle>Credit Transactions</CardTitle>
                  <CardDescription>History of all credit additions</CardDescription>
                </CardHeader>
                <CardContent>
                  {!clientDetail.credit_transactions || clientDetail.credit_transactions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No credit transactions yet
                    </div>
                  ) : (
                    <div className="space-y-2">
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
                              {format(new Date(transaction.transaction_date), 'MMM d, yyyy')}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Added {format(new Date(transaction.created_at), 'MMM d, yyyy')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Completed Projects */}
              {clientDetail.completed_projects && clientDetail.completed_projects.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Completed Projects</CardTitle>
                    <CardDescription>
                      Projects from the completed board
                      {clientDetail.completed_quoted_hours !== undefined && (
                        <span className="ml-2">
                          • Total Quoted: {clientDetail.completed_quoted_hours.toFixed(1)}h
                          {' • '}
                          Total Logged: {clientDetail.completed_logged_hours?.toFixed(1) || 0}h
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {clientDetail.completed_projects.map((project) => (
                        <div
                          key={project.id}
                          className="flex items-center justify-between p-4 border rounded-lg bg-muted/30"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-medium">{project.name}</div>
                              <Badge variant="secondary">Completed</Badge>
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {project.completed_date
                                ? `Completed: ${format(new Date(project.completed_date), 'MMM d, yyyy')}`
                                : `Created: ${format(new Date(project.created_at), 'MMM d, yyyy')}`}
                            </div>
                          </div>
                          <div className="text-right space-y-1">
                            {project.quoted_hours && (
                              <div>
                                <div className="font-medium">{project.quoted_hours.toFixed(1)}h</div>
                                <div className="text-xs text-muted-foreground">Quoted</div>
                              </div>
                            )}
                            <div>
                              <div className="font-medium">{project.total_logged_hours.toFixed(1)}h</div>
                              <div className="text-xs text-muted-foreground">Logged</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Active Projects List */}
              <Card>
                <CardHeader>
                  <CardTitle>Active Projects</CardTitle>
                  <CardDescription>Current projects for this client</CardDescription>
                </CardHeader>
                <CardContent>
                  {clientDetail.projects.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No active projects found for this client
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {clientDetail.projects.map((project) => (
                        <div
                          key={project.id}
                          className="flex items-center justify-between p-4 border rounded-lg"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="font-medium">{project.name}</div>
                              <Badge variant={project.status === 'active' ? 'default' : 'secondary'}>
                                {project.status}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              Created: {format(new Date(project.created_at), 'MMM d, yyyy')}
                            </div>
                          </div>
                          <div className="text-right space-y-2">
                            {project.quoted_hours && (
                              <div className="border-l-2 border-primary pl-3">
                                <div className="text-lg font-bold text-primary">{project.quoted_hours.toFixed(1)}h</div>
                                <div className="text-xs font-medium">Quoted (Monday)</div>
                              </div>
                            )}
                            <div className="text-muted-foreground">
                              <div className="text-sm">{project.total_logged_hours.toFixed(1)}h</div>
                              <div className="text-xs">Logged</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

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
            {clients.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center text-muted-foreground">
                    <p>No Flexi-Design clients found</p>
                    <p className="text-sm mt-2">Clients will appear here once they have projects or credits</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clients.map((client) => {
                  // Calculate credit usage based on quoted hours (not logged hours)
                  const quotedHoursUsed = client.quoted_hours_used || 0
                  const totalDeposited = client.remaining_hours + quotedHoursUsed
                  const creditPercentage = totalDeposited > 0 
                    ? (quotedHoursUsed / totalDeposited) * 100 
                    : 0

                  return (
                    <Card 
                      key={client.client_name}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => handleClientClick(client.client_name)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <CardTitle className="text-lg">{client.client_name}</CardTitle>
                            <CardDescription className="mt-1">
                              {client.total_projects} project{client.total_projects !== 1 ? 's' : ''}
                            </CardDescription>
                          </div>
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
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Remaining</span>
                            <span className={cn(
                              "font-semibold",
                              getCreditStatusColor(client.remaining_hours, quotedHoursUsed)
                            )}>
                              {client.remaining_hours.toFixed(1)}h
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">Quoted (From Monday)</span>
                            <span className="font-bold text-primary text-base">{(client.quoted_hours_used || 0).toFixed(1)}h</span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Logged (Performance)</span>
                            <span className="text-muted-foreground">{client.hours_used.toFixed(1)}h</span>
                          </div>
                          {totalDeposited > 0 && (
                            <div className="pt-2">
                              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                                <span>Credit Usage</span>
                                <span>{creditPercentage.toFixed(0)}%</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full transition-all",
                                    creditPercentage >= 90 
                                      ? "bg-destructive" 
                                      : creditPercentage >= 75 
                                      ? "bg-orange-500" 
                                      : "bg-primary"
                                  )}
                                  style={{ width: `${Math.min(creditPercentage, 100)}%` }}
                                />
                              </div>
                            </div>
                          )}
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

