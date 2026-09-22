'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Loader2, Receipt, Search } from 'lucide-react'
import { toast } from 'sonner'
import { getBillingJobs, type BillingJob } from '@/app/actions/invoices'
import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge'
import { JobInvoiceSummarySheet } from '@/components/billing/job-invoice-summary-sheet'
import {
  INVOICE_STATUS_LABELS,
  formatGbp,
  type InvoiceStatus,
} from '@/lib/billing/invoices'
import { isStuckMondayStatus } from '@/lib/monday/status'
import { cn } from '@/lib/utils'

const ALL_FILTER = '__all__'

type JobLifecycleFilter = 'all' | 'active' | 'completed' | 'stuck'
type BillingStatusFilter = 'outstanding' | 'all' | InvoiceStatus

function uniqueSortedNames(values: (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((name): name is string => Boolean(name)))
  ).sort((a, b) => a.localeCompare(b))
}

function formatJobDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'd MMM yyyy')
  } catch {
    return value
  }
}

export function InvoicesPageClient() {
  const [jobs, setJobs] = useState<BillingJob[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<string | null>(null)
  const [lifecycleFilter, setLifecycleFilter] = useState<JobLifecycleFilter>('all')
  const [statusFilter, setStatusFilter] = useState<BillingStatusFilter>('outstanding')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [summaryJobId, setSummaryJobId] = useState<string | null>(null)

  useEffect(() => {
    void loadJobs()
  }, [])

  async function loadJobs(options?: { silent?: boolean }) {
    if (!options?.silent) setLoading(true)
    try {
      const result = await getBillingJobs()
      if (result.error) {
        toast.error('Could not load invoices', { description: result.error })
        setJobs([])
      } else {
        setJobs(result.jobs || [])
      }
    } catch (error) {
      console.error('Error loading billing jobs:', error)
      toast.error('Could not load invoices')
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }

  const filteredJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return jobs.filter((job) => {
      if (lifecycleFilter === 'active' && job.status !== 'active') return false
      if (lifecycleFilter === 'completed' && job.status !== 'locked') return false
      if (
        lifecycleFilter === 'stuck' &&
        (job.status !== 'active' || !isStuckMondayStatus(job.monday_status))
      ) {
        return false
      }
      if (statusFilter === 'outstanding' && job.billing_status === 'paid') return false
      if (statusFilter !== 'outstanding' && statusFilter !== 'all' && job.billing_status !== statusFilter) {
        return false
      }
      if (selectedClient && job.client_name !== selectedClient) return false
      const jobDate = job.completed_date || job.due_date
      if (dateFrom || dateTo) {
        if (!jobDate) return false
        if (dateFrom && jobDate < dateFrom) return false
        if (dateTo && jobDate > dateTo) return false
      }
      if (!q) return true
      return (
        job.name.toLowerCase().includes(q) ||
        (job.client_name?.toLowerCase().includes(q) ?? false) ||
        (job.agency?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [jobs, searchQuery, selectedClient, lifecycleFilter, statusFilter, dateFrom, dateTo])

  const clients = useMemo(() => uniqueSortedNames(jobs.map((job) => job.client_name)), [jobs])

  const summary = useMemo(() => {
    const byStatus: Record<InvoiceStatus, { jobs: number; amount: number }> = {
      need_invoicing: { jobs: 0, amount: 0 },
      waiting_payment: { jobs: 0, amount: 0 },
      overdue: { jobs: 0, amount: 0 },
      paid: { jobs: 0, amount: 0 },
    }
    let unbilled = 0
    let outstanding = 0
    for (const job of jobs) {
      byStatus[job.billing_status].jobs += 1
      unbilled += job.unbilled
      outstanding += job.outstanding_total
      byStatus.need_invoicing.amount += job.invoices
        .filter((invoice) => invoice.effective_status === 'need_invoicing')
        .reduce((sum, invoice) => sum + invoice.amount, 0)
      byStatus.need_invoicing.amount += job.unbilled
      byStatus.waiting_payment.amount += job.invoices
        .filter((invoice) => invoice.effective_status === 'waiting_payment')
        .reduce((sum, invoice) => sum + invoice.amount, 0)
      byStatus.overdue.amount += job.invoices
        .filter((invoice) => invoice.effective_status === 'overdue')
        .reduce((sum, invoice) => sum + invoice.amount, 0)
      byStatus.paid.amount += job.paid_total
    }
    return { byStatus, unbilled, outstanding, jobCount: jobs.length }
  }, [jobs])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background">
        <div className="flex min-h-16 items-center justify-between gap-3 px-6">
          <div>
            <h1 className="text-2xl font-semibold">Invoices</h1>
            <p className="text-sm text-muted-foreground">
              Keep on top of billing for active and completed jobs
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/billing/reconcile">Reconcile with Xero</Link>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                title="Overdue"
                jobs={summary.byStatus.overdue.jobs}
                amount={summary.byStatus.overdue.amount}
                tone="overdue"
              />
              <SummaryCard
                title="Need invoicing"
                jobs={summary.byStatus.need_invoicing.jobs}
                amount={summary.byStatus.need_invoicing.amount}
                tone="need_invoicing"
              />
              <SummaryCard
                title="Waiting payment"
                jobs={summary.byStatus.waiting_payment.jobs}
                amount={summary.byStatus.waiting_payment.amount}
                tone="waiting_payment"
              />
              <SummaryCard
                title="Outstanding"
                jobs={jobs.filter((job) => job.billing_status !== 'paid').length}
                amount={summary.outstanding}
                tone="outstanding"
              />
            </div>

            <Card>
              <CardHeader className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Jobs</CardTitle>
                    <CardDescription>Open a job for a summary and invoice actions.</CardDescription>
                  </div>
                </div>
                <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                  <div className="relative w-full lg:max-w-sm">
                    <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search jobs or clients"
                      className="pl-9"
                    />
                  </div>
                  <Select
                    value={lifecycleFilter}
                    onValueChange={(value) => setLifecycleFilter(value as JobLifecycleFilter)}
                  >
                    <SelectTrigger className="w-full lg:w-[160px]" size="sm" aria-label="Filter by job status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Active & completed</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="stuck">Stuck</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as BillingStatusFilter)}
                  >
                    <SelectTrigger className="w-full lg:w-[180px]" size="sm" aria-label="Filter by billing status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="outstanding">Outstanding</SelectItem>
                      <SelectItem value="all">All statuses</SelectItem>
                      {(Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[]).map((status) => (
                        <SelectItem key={status} value={status}>
                          {INVOICE_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={selectedClient ?? ALL_FILTER}
                    onValueChange={(value) => setSelectedClient(value === ALL_FILTER ? null : value)}
                  >
                    <SelectTrigger className="w-full lg:w-[200px]" size="sm" aria-label="Filter by client">
                      <SelectValue placeholder="All clients" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTER}>All clients</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client} value={client}>
                          {client}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(event) => setDateFrom(event.target.value)}
                      aria-label="From date"
                      className="h-8 w-[150px]"
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(event) => setDateTo(event.target.value)}
                      aria-label="To date"
                      className="h-8 w-[150px]"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredJobs.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <Receipt className="mx-auto mb-3 h-10 w-10 opacity-50" />
                    <p className="font-medium">No jobs match these filters</p>
                    <p className="mt-1 text-sm">
                      Active and completed Main-board jobs appear here once they are synced from Monday.
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Job</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Job status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Quote</TableHead>
                        <TableHead className="text-right">Invoiced</TableHead>
                        <TableHead className="text-right">Unbilled</TableHead>
                        <TableHead>Billing</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredJobs.map((job) => (
                          <TableRow
                            key={job.id}
                            className="cursor-pointer"
                            onClick={() => setSummaryJobId(job.id)}
                          >
                            <TableCell className="font-medium">
                              <div>{job.name}</div>
                              {job.invoice_count > 0 && (
                                <div className="text-xs text-muted-foreground">
                                  {job.invoice_count} invoice{job.invoice_count === 1 ? '' : 's'}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {job.client_name || '—'}
                            </TableCell>
                            <TableCell>
                              {isStuckMondayStatus(job.monday_status) && job.status === 'active' ? (
                                <Badge
                                  variant="outline"
                                  className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                                >
                                  Stuck
                                </Badge>
                              ) : (
                                <Badge variant="outline">
                                  {job.status === 'locked' ? 'Completed' : 'Active'}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatJobDate(job.completed_date || job.due_date)}
                            </TableCell>
                            <TableCell className="text-right">
                              {job.quote_value != null ? formatGbp(job.quote_value) : '—'}
                            </TableCell>
                            <TableCell className="text-right">{formatGbp(job.invoiced_total)}</TableCell>
                            <TableCell
                              className={cn(
                                'text-right',
                                job.unbilled > 0 ? 'font-medium' : 'text-muted-foreground'
                              )}
                            >
                              {formatGbp(job.unbilled)}
                            </TableCell>
                            <TableCell>
                              <InvoiceStatusBadge status={job.billing_status} />
                            </TableCell>
                          </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <JobInvoiceSummarySheet
        job={jobs.find((job) => job.id === summaryJobId) ?? null}
        open={summaryJobId !== null}
        onOpenChange={(open) => {
          if (!open) setSummaryJobId(null)
        }}
        onChanged={() => loadJobs({ silent: true })}
      />
    </div>
  )
}

function SummaryCard({
  title,
  jobs,
  amount,
  tone,
}: {
  title: string
  jobs: number
  amount: number
  tone: InvoiceStatus | 'outstanding'
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{formatGbp(amount)}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {jobs} job{jobs === 1 ? '' : 's'}
          {tone === 'need_invoicing' ? ' · includes unbilled quote value' : ''}
        </p>
      </CardContent>
    </Card>
  )
}
