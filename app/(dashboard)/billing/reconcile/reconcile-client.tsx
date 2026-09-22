'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  acceptHighConfidenceXeroMatches,
  acceptXeroInvoiceMatch,
  acceptXeroInvoiceMatchToStudioInvoice,
  dismissXeroInvoices,
  getLatestXeroInvoiceStatusSync,
  getXeroReconcileSuggestions,
  type ReconcileResult,
  type ReconcileSuggestion,
  type XeroStatusSyncRun,
} from '@/app/actions/billing-reconcile'
import { markQuoteAsPaid } from '@/app/actions/invoices'
import { formatGbp, INVOICE_STATUS_LABELS } from '@/lib/billing/invoices'
import type { XeroSalesInvoice } from '@/lib/xero/sales-invoices'

const UNMATCHED_VISIBLE = 100

type LinkJob = ReconcileResult['openJobs'][number]
type LinkInvoice = LinkJob['invoices'][number]

function jobLinkValue(jobId: string) {
  return `job:${jobId}`
}

function invoiceLinkValue(invoiceId: string) {
  return `invoice:${invoiceId}`
}

function parseLinkValue(
  value: string
): { kind: 'job'; id: string } | { kind: 'invoice'; id: string } | null {
  if (!value) return null
  if (value.startsWith('invoice:')) return { kind: 'invoice', id: value.slice('invoice:'.length) }
  if (value.startsWith('job:')) return { kind: 'job', id: value.slice('job:'.length) }
  return { kind: 'job', id: value }
}

function amountsCloseEnough(a: number, b: number) {
  if (a <= 0 || b <= 0) return false
  const diff = Math.abs(a - b)
  return diff <= 1 || diff / Math.max(a, b) <= 0.02
}

function defaultLinkValue(jobId: string, xeroAmount: number, jobs: LinkJob[]) {
  const job = jobs.find((item) => item.id === jobId)
  const match = (job?.invoices ?? []).find((invoice) =>
    amountsCloseEnough(invoice.amount, xeroAmount)
  )
  return match ? invoiceLinkValue(match.id) : jobLinkValue(jobId)
}

function invoiceOptionLabel(invoice: LinkInvoice) {
  const number = invoice.invoice_number ? `${invoice.invoice_number} · ` : ''
  return `${number}${invoice.label} · ${formatGbp(invoice.amount)} · ${INVOICE_STATUS_LABELS[invoice.status]}`
}

function jobsFromMatches(suggestion: ReconcileSuggestion, openJobs: LinkJob[]): LinkJob[] {
  const byId = new Map(openJobs.map((job) => [job.id, job]))
  return suggestion.matches.map((match) => {
    const existing = byId.get(match.jobId)
    return (
      existing ?? {
        id: match.jobId,
        name: match.jobName,
        client_name: match.clientName,
        unbilled: match.unbilled,
        status: match.jobStatus,
        invoices: [],
      }
    )
  })
}

function JobLinkOptions({ jobs }: { jobs: LinkJob[] }) {
  return (
    <>
      {jobs.map((job) => {
        const invoices = job.invoices ?? []
        if (invoices.length === 0) {
          return (
            <SelectItem key={job.id} value={jobLinkValue(job.id)}>
              {job.name}
            </SelectItem>
          )
        }
        return (
          <SelectGroup key={job.id}>
            <SelectLabel>
              {job.name}
              {job.client_name ? ` · ${job.client_name}` : ''}
            </SelectLabel>
            <SelectItem value={jobLinkValue(job.id)}>New invoice on this job</SelectItem>
            {invoices.map((invoice) => (
              <SelectItem key={invoice.id} value={invoiceLinkValue(invoice.id)}>
                {invoiceOptionLabel(invoice)}
              </SelectItem>
            ))}
          </SelectGroup>
        )
      })}
    </>
  )
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'd MMM yyyy')
  } catch {
    return value
  }
}

export function BillingReconcileClient() {
  const [result, setResult] = useState<ReconcileResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState(false)
  const [bulkAccepting, setBulkAccepting] = useState(false)
  const [selectedJobs, setSelectedJobs] = useState<Record<string, string>>({})
  const [unmatchedLinks, setUnmatchedLinks] = useState<Record<string, string>>({})
  const [jobSearch, setJobSearch] = useState('')
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<XeroStatusSyncRun | null>(null)

  useEffect(() => {
    void getLatestXeroInvoiceStatusSync().then((response) => {
      if (response.run) setLastSync(response.run)
    })
  }, [])

  async function loadMatches() {
    setLoading(true)
    try {
      const response = await getXeroReconcileSuggestions()
      if (response.error || !response.result) {
        toast.error('Could not match Xero invoices', { description: response.error })
        setResult(null)
      } else {
        setResult(response.result)
        const defaults: Record<string, string> = {}
        for (const suggestion of [...response.result.high, ...response.result.possible]) {
          if (suggestion.matches[0]) {
            defaults[suggestion.invoice.xero_invoice_id] = defaultLinkValue(
              suggestion.matches[0].jobId,
              suggestion.invoice.amount,
              response.result.openJobs
            )
          }
        }
        setSelectedJobs(defaults)
        setUnmatchedLinks({})
        const updates = response.result.updates ?? []
        if (updates.length > 0) {
          setLastSync({
            source: 'reconcile',
            ranAt: new Date().toISOString(),
            updated: updates.length,
            checked: 0,
            changes: updates,
          })
          const names = updates
            .slice(0, 3)
            .map((change) => change.invoiceNumber || change.label)
            .join(', ')
          toast.success(
            updates.length === 1
              ? `${names} is now ${INVOICE_STATUS_LABELS[updates[0].toStatus].toLowerCase()} in Studio`
              : `Updated ${updates.length} Studio invoices from Xero`,
            {
              description: updates.length === 1 ? updates[0].jobName || undefined : names,
              duration: 8000,
            }
          )
        }
      }
    } catch (error) {
      console.error(error)
      toast.error('Could not match Xero invoices')
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  function removeInvoice(xeroInvoiceId: string, studioInvoiceId?: string) {
    setResult((current) => {
      if (!current) return current
      return {
        ...current,
        high: current.high.filter((item) => item.invoice.xero_invoice_id !== xeroInvoiceId),
        possible: current.possible.filter((item) => item.invoice.xero_invoice_id !== xeroInvoiceId),
        unmatchedInvoices: current.unmatchedInvoices.filter(
          (item) => item.xero_invoice_id !== xeroInvoiceId
        ),
        alreadyLinked: current.alreadyLinked + 1,
        openJobs: current.openJobs.map((job) =>
          studioInvoiceId
            ? {
                ...job,
                invoices: (job.invoices ?? []).filter((invoice) => invoice.id !== studioInvoiceId),
              }
            : job
        ),
      }
    })
  }

  function removeDismissed(xeroInvoiceIds: string[]) {
    const hidden = new Set(xeroInvoiceIds)
    setResult((current) => {
      if (!current) return current
      return {
        ...current,
        high: current.high.filter((item) => !hidden.has(item.invoice.xero_invoice_id)),
        possible: current.possible.filter((item) => !hidden.has(item.invoice.xero_invoice_id)),
        unmatchedInvoices: current.unmatchedInvoices.filter(
          (item) => !hidden.has(item.xero_invoice_id)
        ),
        dismissed: (current.dismissed || 0) + hidden.size,
      }
    })
  }

  async function dismiss(ids: string[]) {
    if (ids.length === 0) return
    setDismissing(true)
    try {
      const response = await dismissXeroInvoices(ids)
      if (response.error) {
        toast.error('Could not dismiss invoices', { description: response.error })
      } else {
        toast.success(
          ids.length === 1
            ? 'Invoice dismissed from Reconcile'
            : `Dismissed ${ids.length} invoices from Reconcile`
        )
        removeDismissed(ids)
      }
    } finally {
      setDismissing(false)
    }
  }

  async function accept(target: string, invoice: XeroSalesInvoice) {
    const parsed = parseLinkValue(target)
    if (!parsed) return
    setAcceptingId(invoice.xero_invoice_id)
    try {
      const response =
        parsed.kind === 'invoice'
          ? await acceptXeroInvoiceMatchToStudioInvoice(parsed.id, invoice)
          : await acceptXeroInvoiceMatch(parsed.id, invoice)
      if (response.error) {
        toast.error('Could not link invoice', { description: response.error })
      } else {
        toast.success(
          parsed.kind === 'invoice'
            ? `Linked ${invoice.invoice_number || 'Xero invoice'} to the existing Studio invoice`
            : `Linked ${invoice.invoice_number || 'Xero invoice'}`
        )
        removeInvoice(invoice.xero_invoice_id, parsed.kind === 'invoice' ? parsed.id : undefined)
      }
    } finally {
      setAcceptingId(null)
    }
  }

  async function acceptAllHigh() {
    if (!result?.high.length) return
    if (
      !confirm(
        `Link ${result.high.length} high-confidence Xero invoice${result.high.length === 1 ? '' : 's'} to the suggested jobs?`
      )
    ) {
      return
    }
    setBulkAccepting(true)
    try {
      const response = await acceptHighConfidenceXeroMatches(
        result.high.map((suggestion) => {
          const value =
            selectedJobs[suggestion.invoice.xero_invoice_id] ||
            defaultLinkValue(
              suggestion.matches[0].jobId,
              suggestion.invoice.amount,
              result.openJobs
            )
          const parsed = parseLinkValue(value)
          return parsed?.kind === 'invoice'
            ? { studioInvoiceId: parsed.id, invoice: suggestion.invoice }
            : {
                projectId: parsed?.id || suggestion.matches[0].jobId,
                invoice: suggestion.invoice,
              }
        })
      )
      toast.success(`Linked ${response.accepted} invoice${response.accepted === 1 ? '' : 's'}`)
      if (response.errors.length > 0) {
        toast.error(response.errors.slice(0, 3).join('\n'))
      }
      await loadMatches()
    } finally {
      setBulkAccepting(false)
    }
  }

  async function markPaid(jobId: string, jobName: string, amount: number) {
    if (
      !confirm(
        `Mark the remaining ${formatGbp(amount)} on "${jobName}" as paid in Studio? Use this when the job was already billed in Xero.`
      )
    ) {
      return
    }
    setMarkingId(jobId)
    try {
      const response = await markQuoteAsPaid(jobId)
      if (response.error) {
        toast.error('Could not mark as paid', { description: response.error })
      } else {
        toast.success(`Marked ${formatGbp(response.amount || amount)} as paid`)
        setResult((current) =>
          current
            ? {
                ...current,
                unmatchedJobs: current.unmatchedJobs.filter((job) => job.id !== jobId),
                openJobs: current.openJobs.filter((job) => job.id !== jobId),
              }
            : current
        )
      }
    } finally {
      setMarkingId(null)
    }
  }

  const filteredOpenJobs = useMemo(() => {
    if (!result) return []
    const q = jobSearch.trim().toLowerCase()
    if (!q) return result.openJobs.slice(0, 12)
    return result.openJobs
      .filter((job) => {
        if (job.name.toLowerCase().includes(q)) return true
        if (job.client_name?.toLowerCase().includes(q)) return true
        return (job.invoices ?? []).some(
          (invoice) =>
            invoice.label.toLowerCase().includes(q) ||
            (invoice.invoice_number?.toLowerCase().includes(q) ?? false)
        )
      })
      .slice(0, 12)
  }, [result, jobSearch])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background">
        <div className="flex min-h-16 flex-col justify-center gap-1 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Reconcile with Xero</h1>
            <p className="text-sm text-muted-foreground">
              Match raised Xero invoices to Studio jobs, then confirm. Nothing is linked until you accept.
            </p>
          </div>
          <Button type="button" onClick={() => void loadMatches()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {loaded ? 'Reload from Xero' : 'Fetch Xero invoices'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {!loaded && !loading && (
            <Card>
              <CardHeader>
                <CardTitle>Ready to match</CardTitle>
                <CardDescription>
                  This pulls ACCREC invoices from Xero (paid and awaiting payment) and suggests Studio jobs
                  from client/agency, amount, and invoice reference. High-confidence matches still need a
                  click. If Xero will not load, reconnect it in Settings first.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {lastSync && lastSync.changes.length > 0 && !loading ? (
            <XeroUpdatesCard run={lastSync} />
          ) : null}

          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-6 w-6 animate-spin" />
              Fetching invoices from Xero and scoring jobs…
            </div>
          )}

          {result && !loading && (
            <>
              {result.truncated && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Xero returned a large set; some older invoices may be missing from this pass.
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <Stat label="High confidence" value={String(result.high.length)} />
                <Stat label="Possible matches" value={String(result.possible.length)} />
                <Stat label="Unmatched Xero invoices" value={String(result.unmatchedInvoices.length)} />
                <Stat label="Already linked" value={String(result.alreadyLinked)} />
                <Stat label="Dismissed" value={String(result.dismissed || 0)} />
              </div>
              {result.tenantName && (
                <p className="text-sm text-muted-foreground">Xero organisation: {result.tenantName}</p>
              )}

              <Tabs defaultValue="high">
                <TabsList>
                  <TabsTrigger value="high">High ({result.high.length})</TabsTrigger>
                  <TabsTrigger value="possible">Possible ({result.possible.length})</TabsTrigger>
                  <TabsTrigger value="unmatched">Unmatched Xero ({result.unmatchedInvoices.length})</TabsTrigger>
                  <TabsTrigger value="jobs">Unmatched jobs ({result.unmatchedJobs.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="high">
                  <SuggestionTable
                    suggestions={result.high}
                    selectedJobs={selectedJobs}
                    openJobs={result.openJobs}
                    acceptingId={acceptingId}
                    onSelectJob={(invoiceId, jobId) =>
                      setSelectedJobs((current) => ({ ...current, [invoiceId]: jobId }))
                    }
                    onAccept={(suggestion) =>
                      void accept(
                        selectedJobs[suggestion.invoice.xero_invoice_id] ||
                          defaultLinkValue(
                            suggestion.matches[0].jobId,
                            suggestion.invoice.amount,
                            result.openJobs
                          ),
                        suggestion.invoice
                      )
                    }
                    headerAction={
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void acceptAllHigh()}
                        disabled={bulkAccepting || result.high.length === 0}
                      >
                        {bulkAccepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Accept all high confidence
                      </Button>
                    }
                  />
                </TabsContent>

                <TabsContent value="possible">
                  <SuggestionTable
                    suggestions={result.possible}
                    selectedJobs={selectedJobs}
                    openJobs={result.openJobs}
                    acceptingId={acceptingId}
                    onSelectJob={(invoiceId, jobId) =>
                      setSelectedJobs((current) => ({ ...current, [invoiceId]: jobId }))
                    }
                    onAccept={(suggestion) =>
                      void accept(
                        selectedJobs[suggestion.invoice.xero_invoice_id] ||
                          defaultLinkValue(
                            suggestion.matches[0].jobId,
                            suggestion.invoice.amount,
                            result.openJobs
                          ),
                        suggestion.invoice
                      )
                    }
                  />
                </TabsContent>

                <TabsContent value="unmatched">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <CardTitle>Unmatched Xero invoices</CardTitle>
                          <CardDescription>
                            Newest first. Search a Studio job, or pick an invoice already created on that
                            job. Historic Xero invoices that will never match can be dismissed.
                          </CardDescription>
                        </div>
                        {result.unmatchedInvoices.length > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={dismissing}
                            onClick={() => {
                              const visible = result.unmatchedInvoices
                                .slice(0, UNMATCHED_VISIBLE)
                                .map((invoice) => invoice.xero_invoice_id)
                              if (
                                confirm(
                                  `Dismiss the ${visible.length} unmatched invoice${visible.length === 1 ? '' : 's'} currently shown? They stay in Xero but leave this list.`
                                )
                              ) {
                                void dismiss(visible)
                              }
                            }}
                          >
                            {dismissing ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <X className="mr-1 h-4 w-4" />
                            )}
                            Dismiss visible
                          </Button>
                        )}
                      </div>
                      <Input
                        value={jobSearch}
                        onChange={(event) => setJobSearch(event.target.value)}
                        placeholder="Search jobs or invoices"
                        className="max-w-sm"
                      />
                    </CardHeader>
                    <CardContent>
                      {result.unmatchedInvoices.length === 0 ? (
                        <p className="py-8 text-center text-muted-foreground">No unmatched Xero invoices.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Invoice</TableHead>
                              <TableHead>Contact</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead>Link to job</TableHead>
                              <TableHead className="w-24 text-right"> </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {result.unmatchedInvoices.slice(0, UNMATCHED_VISIBLE).map((invoice) => (
                              <TableRow key={invoice.xero_invoice_id}>
                                <TableCell>
                                  <div className="font-medium">{invoice.invoice_number || '—'}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatDate(invoice.invoice_date)}
                                    {invoice.reference ? ` · ${invoice.reference}` : ''}
                                  </div>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {invoice.contact_name || '—'}
                                </TableCell>
                                <TableCell className="text-right">{formatGbp(invoice.amount)}</TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <Select
                                      value={unmatchedLinks[invoice.xero_invoice_id] || ''}
                                      onValueChange={(value) =>
                                        setUnmatchedLinks((current) => ({
                                          ...current,
                                          [invoice.xero_invoice_id]: value,
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="w-[320px]" size="sm">
                                        <SelectValue placeholder="Choose a job or invoice" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <JobLinkOptions jobs={filteredOpenJobs} />
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={
                                        !unmatchedLinks[invoice.xero_invoice_id] ||
                                        acceptingId === invoice.xero_invoice_id
                                      }
                                      onClick={() =>
                                        void accept(unmatchedLinks[invoice.xero_invoice_id], invoice)
                                      }
                                    >
                                      Link
                                    </Button>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={dismissing}
                                    onClick={() => void dismiss([invoice.xero_invoice_id])}
                                  >
                                    Dismiss
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                      {result.unmatchedInvoices.length > UNMATCHED_VISIBLE && (
                        <p className="mt-3 text-sm text-muted-foreground">
                          Showing the {UNMATCHED_VISIBLE} most recent unmatched invoices. Dismiss or
                          link some to bring older ones into view.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="jobs">
                  <Card>
                    <CardHeader>
                      <CardTitle>Jobs still unbilled</CardTitle>
                      <CardDescription>
                        No Xero invoice was suggested for these. For old completed work already billed,
                        mark the remaining quote as paid in Studio.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {result.unmatchedJobs.length === 0 ? (
                        <p className="py-8 text-center text-muted-foreground">
                          Every outstanding job has a suggested Xero invoice.
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Job</TableHead>
                              <TableHead>Client</TableHead>
                              <TableHead className="text-right">Unbilled</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {result.unmatchedJobs.map((job) => (
                              <TableRow key={job.id}>
                                <TableCell>
                                  <Link href={`/billing/${job.id}`} className="font-medium hover:underline">
                                    {job.name}
                                  </Link>
                                  <div className="text-xs text-muted-foreground">
                                    {job.status === 'locked' ? 'Completed' : 'Active'}
                                  </div>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {job.client_name || '—'}
                                </TableCell>
                                <TableCell className="text-right">{formatGbp(job.unbilled)}</TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={markingId === job.id}
                                    onClick={() => void markPaid(job.id, job.name, job.unbilled)}
                                  >
                                    {markingId === job.id ? (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Mark remaining paid
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function XeroUpdatesCard({ run }: { run: XeroStatusSyncRun }) {
  const when = (() => {
    try {
      return format(parseISO(run.ranAt), 'd MMM yyyy, HH:mm')
    } catch {
      return run.ranAt
    }
  })()
  const recent = Date.now() - new Date(run.ranAt).getTime() < 10 * 60 * 1000
  const title = recent
    ? 'Updated from Xero'
    : run.source === 'cron'
      ? 'Overnight Xero refresh'
      : 'Last Xero refresh'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {run.changes.length === 1
            ? 'This Studio invoice was brought in line with Xero.'
            : `${run.changes.length} Studio invoices were brought in line with Xero.`}
          {recent ? '' : ` ${when}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {run.changes.map((change) => {
            const statusChanged = change.fromStatus !== change.toStatus
            return (
              <li key={change.id} className="text-sm">
                <Link
                  href={`/billing/${change.projectId}`}
                  className="font-medium hover:underline"
                >
                  {change.invoiceNumber || change.label}
                </Link>
                {change.jobName ? (
                  <span className="text-muted-foreground"> · {change.jobName}</span>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  {statusChanged
                    ? `${INVOICE_STATUS_LABELS[change.fromStatus]} → ${INVOICE_STATUS_LABELS[change.toStatus]}`
                    : change.toStatus === 'paid' && change.paidDate
                      ? `Paid ${formatDate(change.paidDate)}`
                      : 'Details updated from Xero'}
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

function SuggestionTable({
  suggestions,
  selectedJobs,
  openJobs,
  acceptingId,
  onSelectJob,
  onAccept,
  headerAction,
}: {
  suggestions: ReconcileSuggestion[]
  selectedJobs: Record<string, string>
  openJobs: LinkJob[]
  acceptingId: string | null
  onSelectJob: (invoiceId: string, jobId: string) => void
  onAccept: (suggestion: ReconcileSuggestion) => void
  headerAction?: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Suggested matches</CardTitle>
          <CardDescription>
            Check the job, or pick a Studio invoice already created on it, then accept.
          </CardDescription>
        </div>
        {headerAction}
      </CardHeader>
      <CardContent>
        {suggestions.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nothing in this pile.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Xero invoice</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Suggested job</TableHead>
                <TableHead>Why</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map((suggestion) => {
                const linkJobs = jobsFromMatches(suggestion, openJobs)
                const selectedId =
                  selectedJobs[suggestion.invoice.xero_invoice_id] ||
                  defaultLinkValue(
                    suggestion.matches[0].jobId,
                    suggestion.invoice.amount,
                    openJobs
                  )
                const parsed = parseLinkValue(selectedId)
                const selectedJobId =
                  parsed?.kind === 'invoice'
                    ? linkJobs.find((job) =>
                        (job.invoices ?? []).some((invoice) => invoice.id === parsed.id)
                      )?.id || suggestion.matches[0].jobId
                    : parsed?.id || suggestion.matches[0].jobId
                const selected = suggestion.matches.find((match) => match.jobId === selectedJobId)
                const selectedInvoice =
                  parsed?.kind === 'invoice'
                    ? linkJobs
                        .flatMap((job) => job.invoices ?? [])
                        .find((invoice) => invoice.id === parsed.id)
                    : undefined
                return (
                  <TableRow key={suggestion.invoice.xero_invoice_id}>
                    <TableCell>
                      <div className="font-medium">
                        {suggestion.invoice.invoice_number || suggestion.invoice.xero_invoice_id}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {suggestion.invoice.contact_name || 'No contact'}
                        {' · '}
                        {formatDate(suggestion.invoice.invoice_date)}
                        <Badge variant="outline" className="ml-2">
                          {suggestion.invoice.status === 'PAID' ? 'Paid' : 'Awaiting payment'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatGbp(suggestion.invoice.amount)}</TableCell>
                    <TableCell>
                      <Select
                        value={selectedId}
                        onValueChange={(value) =>
                          onSelectJob(suggestion.invoice.xero_invoice_id, value)
                        }
                      >
                        <SelectTrigger className="w-[300px]" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <JobLinkOptions jobs={linkJobs} />
                        </SelectContent>
                      </Select>
                      {selectedInvoice ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Existing Studio invoice · {formatGbp(selectedInvoice.amount)}
                        </div>
                      ) : selected ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {selected.clientName || 'No client'} · unbilled {formatGbp(selected.unbilled)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(selected?.reasons || suggestion.matches[0].reasons).map((reason) => (
                          <Badge key={reason} variant="secondary">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        disabled={acceptingId === suggestion.invoice.xero_invoice_id}
                        onClick={() => onAccept(suggestion)}
                      >
                        {acceptingId === suggestion.invoice.xero_invoice_id && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Accept
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
