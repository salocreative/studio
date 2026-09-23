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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatGbp } from '@/lib/billing/invoices'
import type { XeroAccountOption, XeroContactOption, XeroTrackingCategory } from '@/lib/xero/bills'
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

function draftFromCapture(capture: ExpenseCapture): Draft {
  return {
    amount: capture.amount != null ? String(capture.amount) : '',
    invoiceDate: capture.invoice_date || capture.email_date || '',
    accountCode: capture.account_code || '',
    trackingOptionId: capture.tracking_option_id || '',
    notes: capture.notes || '',
  }
}

export function ExpensesPageClient() {
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState(NEEDS_REVIEW)
  const [vendorFilter, setVendorFilter] = useState(NONE)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

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
          <Tabs defaultValue="subscriptions" className="mx-auto max-w-7xl">
            <TabsList>
              <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
              <TabsTrigger value="xero-review">Xero Review</TabsTrigger>
            </TabsList>
            <TabsContent value="subscriptions" className="mt-4" />
            <TabsContent value="xero-review" className="mt-4">
              {data.xero.error && (
                <p className="mb-4 text-sm text-muted-foreground">{data.xero.error}</p>
              )}
              <Card>
                <CardHeader className="space-y-4">
                  <div>
                    <CardTitle>Captured invoices</CardTitle>
                    <CardDescription>
                      Amount and invoice date are entered here. Nothing is sent to Xero until you approve it.
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
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vendor</TableHead>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Coding</TableHead>
                          <TableHead className="w-[220px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((capture) => {
                          const draft = drafts[capture.id] || draftFromCapture(capture)
                          const locked = capture.status === 'pushed' || capture.status === 'rejected'
                          const busy = busyId === capture.id
                          return (
                            <TableRow key={capture.id}>
                              <TableCell className="align-top">
                                <div className="font-medium">{capture.vendor_name}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Email {formatDate(capture.email_date)}
                                </div>
                                <Badge variant="outline" className="mt-2">
                                  {STATUS_LABELS[capture.status]}
                                </Badge>
                                {capture.push_error && (
                                  <p className="mt-2 max-w-[220px] text-xs text-destructive">{capture.push_error}</p>
                                )}
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="space-y-2">
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
                                    aria-label="Amount"
                                    onChange={(event) => patchDraft(capture.id, { amount: event.target.value })}
                                  />
                                  <Input
                                    type="date"
                                    value={draft.invoiceDate}
                                    disabled={locked}
                                    aria-label="Invoice date"
                                    onChange={(event) => patchDraft(capture.id, { invoiceDate: event.target.value })}
                                  />
                                  <a
                                    href={capture.file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                                  >
                                    Document
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                  {capture.xero_bill_id && (
                                    <a
                                      href={xeroBillUrl(capture.xero_bill_id)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ml-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                                    >
                                      Xero
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="space-y-2">
                                  <Select
                                    value={draft.accountCode || NONE}
                                    onValueChange={(value) =>
                                      patchDraft(capture.id, { accountCode: value === NONE ? '' : value })
                                    }
                                    disabled={locked || data.xero.accounts.length === 0}
                                  >
                                    <SelectTrigger className="w-full" size="sm" aria-label="Account code">
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
                                        patchDraft(capture.id, { trackingOptionId: value === NONE ? '' : value })
                                      }
                                      disabled={locked}
                                    >
                                      <SelectTrigger className="w-full" size="sm" aria-label="Tracking category">
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
                              </TableCell>
                              <TableCell className="align-top">
                                {!locked && (
                                  <div className="flex flex-col gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={busy}
                                      onClick={() =>
                                        void runAction(capture.id, () => approveExpenseCapture(capturePayload(capture)))
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
                                        void runAction(capture.id, () => flagExpenseCapture(capture.id, draft.notes || null))
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
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
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
