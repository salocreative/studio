'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  approveExpenseCapture,
  flagExpenseCapture,
  getExpensesPage,
  rejectExpenseCapture,
} from '@/app/actions/expenses'
import type { ExpenseCapture, ExpenseCaptureStatus, VendorRule } from '@/lib/expenses/types'
import { EXPENSE_DOCUMENT_KIND_LABELS } from '@/lib/expenses/parse-document'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getXeroAuthUrlAction } from '@/app/actions/xero'
import { formatGbp } from '@/lib/billing/invoices'
import type { XeroAccountOption, XeroContactOption, XeroTrackingCategory } from '@/lib/xero/bills'
import { cn } from '@/lib/utils'
import { xeroBillUrl } from '@/lib/xero/urls'

const NONE = '__none__'
const NEEDS_REVIEW = 'needs_review'

const STATUS_LABELS: Record<ExpenseCaptureStatus, string> = {
  new: 'New',
  flagged_manual: 'Flagged',
  approved: 'Approved',
  pushed: 'Pushed',
  rejected: 'Rejected',
  push_failed: 'Push failed',
}

const REVIEW_STATUSES = new Set<ExpenseCaptureStatus>(['new', 'flagged_manual', 'push_failed'])

interface PageData {
  captures: ExpenseCapture[]
  vendorRules: VendorRule[]
  xero: {
    connected: boolean
    accounts: XeroAccountOption[]
    contacts: XeroContactOption[]
    tracking: XeroTrackingCategory[]
    error: string | null
    canAttachFiles: boolean
  }
}

interface Draft {
  amount: string
  invoiceDate: string
  accountCode: string
  trackingOptionId: string
  notes: string
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'd MMM yyyy')
  } catch {
    return value
  }
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  return value.slice(0, 10)
}

function draftFromCapture(capture: ExpenseCapture): Draft {
  const amount =
    capture.amount != null
      ? String(capture.amount)
      : capture.document_kind !== 'statement' && capture.last_approved_amount != null
        ? String(capture.last_approved_amount)
        : ''
  return {
    amount,
    invoiceDate: toDateInputValue(capture.invoice_date || capture.email_date),
    accountCode: capture.account_code || '',
    trackingOptionId: capture.tracking_option_id || '',
    notes: capture.notes || '',
  }
}

function capturePreviewSrc(id: string) {
  return `/api/expenses/captures/${encodeURIComponent(id)}/file`
}

function CapturePreview({ capture }: { capture: ExpenseCapture | null }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(false)
    const timer = window.setTimeout(() => setReady(true), 8000)
    return () => window.clearTimeout(timer)
  }, [capture?.id])

  if (!capture) {
    return (
      <aside className="flex h-[min(70vh,52rem)] min-h-[24rem] items-center justify-center rounded-lg border bg-muted/20 px-6 text-center text-sm text-muted-foreground">
        Select a capture to preview the document.
      </aside>
    )
  }

  return (
    <aside className="flex h-[min(70vh,52rem)] min-h-[24rem] flex-col overflow-hidden rounded-lg border bg-muted/20 xl:sticky xl:top-4">
      <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{capture.file_name || capture.vendor_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {EXPENSE_DOCUMENT_KIND_LABELS[capture.document_kind]} · {capture.vendor_name}
          </p>
        </div>
        <a
          href={capture.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Open
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {!ready && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <iframe
          key={capture.id}
          title={capture.file_name || `${capture.vendor_name} document`}
          src={capturePreviewSrc(capture.id)}
          className="h-full w-full border-0"
          sandbox={capture.file_type === 'html' ? 'allow-same-origin' : undefined}
          onLoad={() => setReady(true)}
        />
      </div>
    </aside>
  )
}

export function ExpensesPageClient() {
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState(NEEDS_REVIEW)
  const [vendorFilter, setVendorFilter] = useState(NONE)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const result = await getExpensesPage()
      if (result.error || !result.captures || !result.vendorRules || !result.xero) {
        setLoadError(result.error || 'Could not load expenses')
        setData(null)
      } else {
        setLoadError(null)
        setData({ captures: result.captures, vendorRules: result.vendorRules, xero: result.xero })
        setDrafts(Object.fromEntries(result.captures.map((capture) => [capture.id, draftFromCapture(capture)])))
      }
    } catch (error) {
      console.error('Error loading expenses:', error)
      setLoadError('Could not load expenses')
    } finally {
      setLoading(false)
    }
  }

  const captures = data?.captures || []
  const vendors = useMemo(
    () => Array.from(new Set(captures.map((capture) => capture.vendor_name))).sort((a, b) => a.localeCompare(b)),
    [captures]
  )
  const filtered = captures.filter((capture) => {
    if (statusFilter === NEEDS_REVIEW && !REVIEW_STATUSES.has(capture.status)) return false
    if (statusFilter !== NEEDS_REVIEW && statusFilter !== 'all' && capture.status !== statusFilter) return false
    if (vendorFilter !== NONE && capture.vendor_name !== vendorFilter) return false
    return true
  })
  const previewCapture = filtered.find((capture) => capture.id === previewId) || filtered[0] || null

  useEffect(() => {
    if (!previewCapture) {
      if (previewId) setPreviewId(null)
      return
    }
    if (previewId !== previewCapture.id) setPreviewId(previewCapture.id)
  }, [previewCapture, previewId])

  function patchDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  }

  async function runAction(id: string, action: () => Promise<{ error?: string; success?: true }>) {
    setBusyId(id)
    try {
      const result = await action()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Updated')
        await load()
      }
    } catch (error) {
      console.error(error)
      toast.error('Something went wrong')
    } finally {
      setBusyId(null)
    }
  }

  function capturePayload(capture: ExpenseCapture) {
    const draft = drafts[capture.id] || draftFromCapture(capture)
    const amount = draft.amount.trim() === '' ? null : Number(draft.amount)
    return {
      id: capture.id,
      amount: amount != null && Number.isFinite(amount) ? amount : null,
      invoiceDate: draft.invoiceDate || null,
      accountCode: draft.accountCode || null,
      trackingOptionId: draft.trackingOptionId || null,
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background">
        <div className="flex min-h-16 items-center justify-between gap-3 px-6">
          <div>
            <h1 className="text-2xl font-semibold">Expenses</h1>
            <p className="text-sm text-muted-foreground">
              Review captured invoices, then push them to Xero as bills.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && !data ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-sm text-muted-foreground">{loadError}</p>
        ) : data ? (
          <Tabs defaultValue="subscriptions" className="mx-auto w-full max-w-[100rem]">
            <TabsList>
              <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
              <TabsTrigger value="xero-review">Xero Review</TabsTrigger>
            </TabsList>
            <TabsContent value="subscriptions" className="mt-4" />
            <TabsContent value="xero-review" className="mt-4">
              {data.xero.error && (
                <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50 sm:flex-row sm:items-center sm:justify-between">
                  <p>{data.xero.error}</p>
                  {!data.xero.canAttachFiles && data.xero.connected && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void getXeroAuthUrlAction().then((result) => {
                          if ('authUrl' in result && result.authUrl) {
                            window.location.href = result.authUrl
                            return
                          }
                          toast.error(result.error || 'Could not start Xero reconnect')
                        })
                      }}
                    >
                      Reconnect Xero
                    </Button>
                  )}
                </div>
              )}
              <Card>
                <CardHeader className="space-y-4">
                  <div>
                    <CardTitle>Captured invoices</CardTitle>
                    <CardDescription>
                      Amount and invoice date are entered here. Click a capture to preview it beside the list.
                      Nothing is sent to Xero until you approve it.
                    </CardDescription>
                  </div>
                  <div className="flex flex-col gap-3 lg:flex-row">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-full lg:w-[200px]" size="sm" aria-label="Filter by status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NEEDS_REVIEW}>Needs review</SelectItem>
                        <SelectItem value="all">All statuses</SelectItem>
                        {(Object.keys(STATUS_LABELS) as ExpenseCaptureStatus[]).map((status) => (
                          <SelectItem key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={vendorFilter} onValueChange={setVendorFilter}>
                      <SelectTrigger className="w-full lg:w-[220px]" size="sm" aria-label="Filter by vendor">
                        <SelectValue placeholder="All vendors" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>All vendors</SelectItem>
                        {vendors.map((vendor) => (
                          <SelectItem key={vendor} value={vendor}>
                            {vendor}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  {filtered.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                      No captured invoices in this view. They appear after the filer saves a document.
                    </p>
                  ) : (
                    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
                      <div className="min-w-0 space-y-3">
                        {filtered.map((capture) => {
                          const draft = drafts[capture.id] || draftFromCapture(capture)
                          const locked = capture.status === 'pushed' || capture.status === 'rejected'
                          const busy = busyId === capture.id
                          const selected = previewCapture?.id === capture.id
                          return (
                            <article
                              key={capture.id}
                              className={cn(
                                'cursor-pointer rounded-lg border bg-background p-4 shadow-xs transition-colors',
                                selected && 'border-primary/40 bg-muted/40'
                              )}
                              onClick={() => setPreviewId(capture.id)}
                              onFocusCapture={() => setPreviewId(capture.id)}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-medium">{capture.vendor_name}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    Email {formatDate(capture.email_date)}
                                    {capture.same_email_count > 1
                                      ? ` · ${capture.same_email_count} documents`
                                      : ''}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="outline">{STATUS_LABELS[capture.status]}</Badge>
                                  {capture.document_kind !== 'other' && (
                                    <Badge
                                      variant={capture.document_kind === 'statement' ? 'secondary' : 'outline'}
                                    >
                                      {EXPENSE_DOCUMENT_KIND_LABELS[capture.document_kind]}
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              <div className="mt-2 break-words text-sm text-muted-foreground">
                                {capture.file_name || 'Document'}
                              </div>
                              {capture.xero_bill_id ? (
                                <a
                                  href={xeroBillUrl(capture.xero_bill_id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  Xero
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : null}
                              {capture.document_kind === 'statement' && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  This looks like a statement, not a bill.
                                </p>
                              )}
                              {capture.push_error && (
                                <p className="mt-2 text-xs text-destructive">{capture.push_error}</p>
                              )}

                              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <label className="block min-w-0 space-y-1">
                                  <span className="text-xs font-medium text-muted-foreground">Amount</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={draft.amount}
                                    disabled={locked}
                                    placeholder={
                                      capture.last_approved_amount != null
                                        ? `Last ${formatGbp(capture.last_approved_amount)}`
                                        : 'Amount'
                                    }
                                    className="w-full min-w-0"
                                    onChange={(event) =>
                                      patchDraft(capture.id, { amount: event.target.value })
                                    }
                                  />
                                  {capture.amount == null &&
                                    capture.document_kind !== 'statement' &&
                                    capture.last_approved_amount != null && (
                                      <span className="block text-xs text-muted-foreground">
                                        Last approved amount
                                      </span>
                                    )}
                                </label>
                                <label className="block min-w-0 space-y-1">
                                  <span className="text-xs font-medium text-muted-foreground">Invoice date</span>
                                  <Input
                                    type="date"
                                    value={toDateInputValue(draft.invoiceDate)}
                                    disabled={locked}
                                    className="w-full min-w-0"
                                    onChange={(event) =>
                                      patchDraft(capture.id, { invoiceDate: event.target.value })
                                    }
                                  />
                                </label>
                                <div className="min-w-0 space-y-1 sm:col-span-2">
                                  <span className="text-xs font-medium text-muted-foreground">Coding</span>
                                  <Select
                                    value={draft.accountCode || NONE}
                                    onValueChange={(value) =>
                                      patchDraft(capture.id, { accountCode: value === NONE ? '' : value })
                                    }
                                    disabled={locked || data.xero.accounts.length === 0}
                                  >
                                    <SelectTrigger className="w-full min-w-0 overflow-hidden" size="sm">
                                      <SelectValue placeholder="Account" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={NONE}>No account</SelectItem>
                                      {data.xero.accounts.map((account) => (
                                        <SelectItem key={account.code} value={account.code}>
                                          {account.code} {account.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {data.xero.tracking.length > 0 && (
                                    <Select
                                      value={draft.trackingOptionId || NONE}
                                      onValueChange={(value) =>
                                        patchDraft(capture.id, {
                                          trackingOptionId: value === NONE ? '' : value,
                                        })
                                      }
                                      disabled={locked}
                                    >
                                      <SelectTrigger className="w-full min-w-0 overflow-hidden" size="sm">
                                        <SelectValue placeholder="Tracking" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={NONE}>No tracking</SelectItem>
                                        {data.xero.tracking.flatMap((category) =>
                                          category.options.map((option) => (
                                            <SelectItem key={option.id} value={option.id}>
                                              {category.name}: {option.name}
                                            </SelectItem>
                                          ))
                                        )}
                                      </SelectContent>
                                    </Select>
                                  )}
                                  {!capture.xero_contact_id && capture.status !== 'pushed' && (
                                    <p className="text-xs text-muted-foreground">
                                      This vendor has no Xero contact yet.
                                    </p>
                                  )}
                                </div>
                              </div>

                              {!locked && (
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() =>
                                      void runAction(capture.id, () =>
                                        approveExpenseCapture(capturePayload(capture))
                                      )
                                    }
                                  >
                                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Approve and push
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() =>
                                      void runAction(capture.id, () =>
                                        flagExpenseCapture(capture.id, draft.notes || null)
                                      )
                                    }
                                  >
                                    Flag
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() =>
                                      void runAction(capture.id, () =>
                                        rejectExpenseCapture(capture.id, draft.notes || null)
                                      )
                                    }
                                  >
                                    Reject
                                  </Button>
                                </div>
                              )}
                            </article>
                          )
                        })}
                      </div>
                      <CapturePreview capture={previewCapture} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : null}
      </div>
    </div>
  )
}
