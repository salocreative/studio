'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Pencil, Plus, Split, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import {
  createProjectInvoice,
  deleteProjectInvoice,
  getProjectInvoices,
  getXeroInvoiceOptions,
  markQuoteAsPaid,
  splitRemainingFiftyFifty,
  updateProjectInvoice,
  updateProjectInvoiceStatus,
  type BillingJob,
  type ProjectInvoice,
  type ProjectInvoiceInput,
} from '@/app/actions/invoices'
import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge'
import { ProjectSourceLinks } from '@/components/billing/project-source-links'
import { XeroInvoiceLink } from '@/components/billing/xero-invoice-link'
import { isStuckMondayStatus } from '@/lib/monday/status'
import {
  DUE_TERMS,
  DUE_TERMS_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  dueDateFromTerms,
  formatGbp,
  londonToday,
  type DueTerms,
  type InvoiceStatus,
} from '@/lib/billing/invoices'
import type { XeroInvoiceSetup } from '@/lib/xero/invoicing'
import { xeroInvoiceUrl } from '@/lib/xero/urls'

type InvoiceForm = {
  label: string
  amount: string
  status: InvoiceStatus
  invoice_number: string
  invoice_date: string
  due_date: string
  due_terms: DueTerms
  paid_date: string
  notes: string
}

const emptyForm: InvoiceForm = {
  label: '',
  amount: '',
  status: 'need_invoicing',
  invoice_number: '',
  invoice_date: '',
  due_date: '',
  due_terms: '30',
  paid_date: '',
  notes: '',
}

function formFromInvoice(invoice: ProjectInvoice): InvoiceForm {
  return {
    label: invoice.label,
    amount: String(invoice.amount),
    status: invoice.status,
    invoice_number: invoice.invoice_number || '',
    invoice_date: invoice.invoice_date || '',
    due_date: invoice.due_date || '',
    due_terms: '30',
    paid_date: invoice.paid_date || '',
    notes: invoice.notes || '',
  }
}

function parseForm(form: InvoiceForm): ProjectInvoiceInput | string {
  const amount = parseFloat(form.amount)
  if (!form.label.trim()) return 'Label is required'
  if (!Number.isFinite(amount) || amount <= 0) return 'Amount must be greater than zero'
  return {
    label: form.label,
    amount,
    status: form.status,
    invoice_number: form.invoice_number || null,
    invoice_date: form.invoice_date || null,
    due_date: form.due_date || null,
    paid_date: form.paid_date || null,
    notes: form.notes || null,
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'd MMM yyyy')
  } catch {
    return value
  }
}

export function ProjectInvoicesClient({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [job, setJob] = useState<BillingJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectInvoice | null>(null)
  const [form, setForm] = useState<InvoiceForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)
  const [xeroSetup, setXeroSetup] = useState<XeroInvoiceSetup | null>(null)
  const [xeroLoading, setXeroLoading] = useState(false)
  const [createInXero, setCreateInXero] = useState(true)
  const [accountCode, setAccountCode] = useState('')
  const [taxType, setTaxType] = useState('')

  useEffect(() => {
    void load()
  }, [projectId])

  async function load() {
    setLoading(true)
    try {
      const result = await getProjectInvoices(projectId)
      if (result.error) {
        toast.error('Could not load invoices', { description: result.error })
        setJob(null)
      } else if (result.job) {
        setJob(result.job)
      }
    } catch (error) {
      console.error('Error loading project invoices:', error)
      toast.error('Could not load invoices')
    } finally {
      setLoading(false)
    }
  }

  async function loadXeroSetup() {
    if (xeroSetup || xeroLoading) return xeroSetup
    setXeroLoading(true)
    try {
      const result = await getXeroInvoiceOptions()
      if ('error' in result) {
        toast.error('Could not load Xero accounts', { description: result.error })
        return null
      }
      if (!result.setup) {
        return null
      }
      setXeroSetup(result.setup)
      if (result.setup.defaultAccountCode) setAccountCode(result.setup.defaultAccountCode)
      if (result.setup.defaultTaxType) setTaxType(result.setup.defaultTaxType)
      return result.setup
    } finally {
      setXeroLoading(false)
    }
  }

  function applyDueTerms(invoiceDate: string, terms: DueTerms) {
    if (!invoiceDate) return ''
    return dueDateFromTerms(invoiceDate, terms)
  }

  async function openCreate() {
    setEditing(null)
    const invoiceDate = londonToday()
    const setup = await loadXeroSetup()
    const connected = Boolean(setup?.connected)
    setCreateInXero(connected)
    setForm({
      ...emptyForm,
      amount: job && job.unbilled > 0 ? String(job.unbilled) : '',
      status: connected ? 'waiting_payment' : 'need_invoicing',
      invoice_date: invoiceDate,
      due_terms: '30',
      due_date: applyDueTerms(invoiceDate, '30'),
    })
    setDialogOpen(true)
  }

  function openEdit(invoice: ProjectInvoice) {
    setEditing(invoice)
    setForm(formFromInvoice(invoice))
    setDialogOpen(true)
  }

  async function handleSave() {
    const parsed = parseForm(form)
    if (typeof parsed === 'string') {
      toast.error(parsed)
      return
    }

    setSaving(true)
    try {
      const result = editing
        ? await updateProjectInvoice(editing.id, parsed)
        : await createProjectInvoice(
            projectId,
            parsed,
            createInXero && xeroSetup?.connected
              ? { accountCode, taxType }
              : null
          )

      if (result.error) {
        toast.error(editing ? 'Could not update invoice' : 'Could not add invoice', {
          description: result.error,
        })
      } else {
        toast.success(
          editing
            ? 'Invoice updated'
            : 'xeroInvoiceNumber' in result && result.xeroInvoiceNumber
              ? `Invoice added in Xero as ${result.xeroInvoiceNumber}`
              : 'Invoice added'
        )
        setDialogOpen(false)
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleSplit() {
    setSplitting(true)
    try {
      const result = await splitRemainingFiftyFifty(projectId)
      if (result.error) {
        toast.error('Could not split remaining amount', { description: result.error })
      } else {
        toast.success('Added 50% deposit and 50% on delivery')
        await load()
      }
    } finally {
      setSplitting(false)
    }
  }

  async function handleMarkPaid() {
    if (!job || job.unbilled <= 0) return
    if (
      !confirm(
        `Mark the remaining ${formatGbp(job.unbilled)} as paid in Studio? Use this when the job was already billed in Xero.`
      )
    ) {
      return
    }
    setMarkingPaid(true)
    try {
      const result = await markQuoteAsPaid(projectId)
      if (result.error) {
        toast.error('Could not mark quote as paid', { description: result.error })
      } else {
        toast.success('Remaining quote marked as paid')
        await load()
      }
    } finally {
      setMarkingPaid(false)
    }
  }

  async function handleDelete(invoice: ProjectInvoice) {
    if (!confirm(`Delete "${invoice.label}"?`)) return
    setDeletingId(invoice.id)
    try {
      const result = await deleteProjectInvoice(invoice.id)
      if (result.error) {
        toast.error('Could not delete invoice', { description: result.error })
      } else {
        toast.success('Invoice deleted')
        await load()
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function handleStatusChange(invoice: ProjectInvoice, status: InvoiceStatus) {
    if (status === invoice.status) return
    setUpdatingStatusId(invoice.id)
    try {
      const result = await updateProjectInvoiceStatus(invoice.id, status)
      if (result.error) {
        toast.error('Could not update status', { description: result.error })
      } else {
        toast.success('Status updated')
        await load()
      }
    } finally {
      setUpdatingStatusId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-medium">Job not found</p>
        <Button variant="outline" onClick={() => router.push('/billing')}>
          Back to invoices
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background">
        <div className="flex min-h-16 flex-col justify-center gap-1 px-6 py-3">
          <Link
            href="/billing"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Invoices
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{job.name}</h1>
            {isStuckMondayStatus(job.monday_status) && job.status === 'active' ? (
              <Badge
                variant="outline"
                className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
              >
                Stuck
              </Badge>
            ) : (
              <Badge variant="outline">{job.status === 'locked' ? 'Completed' : 'Active'}</Badge>
            )}
            <InvoiceStatusBadge status={job.billing_status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {job.client_name || 'No client'}
            {job.agency ? ` · ${job.agency}` : ''}
          </p>
          <ProjectSourceLinks
            projectId={job.id}
            status={job.status}
            mondayUrl={job.monday_url}
            className="pt-1"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Quote value" value={job.quote_value != null ? formatGbp(job.quote_value) : '—'} />
            <StatCard label="Invoiced" value={formatGbp(job.invoiced_total)} />
            <StatCard label="Unbilled" value={formatGbp(job.unbilled)} />
            <StatCard label="Paid" value={formatGbp(job.paid_total)} />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Invoices</CardTitle>
                  <CardDescription>
                    Split a job into deposits, monthly amounts, or a final invoice.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleMarkPaid()}
                    disabled={markingPaid || job.unbilled <= 0}
                  >
                    {markingPaid ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                    )}
                    Mark remaining paid
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSplit()}
                    disabled={splitting || job.unbilled <= 0}
                  >
                    {splitting ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Split className="mr-1 h-4 w-4" />
                    )}
                    Split remaining 50/50
                  </Button>
                  <Button type="button" size="sm" onClick={() => void openCreate()}>
                    <Plus className="mr-1 h-4 w-4" />
                    Add invoice
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {job.invoices.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <p>No invoices yet</p>
                  <p className="mt-1 text-sm">
                    Add one for a deposit, a monthly amount, or the full job value.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-28 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {job.invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>
                          <div className="font-medium">{invoice.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {invoice.invoice_number ? `#${invoice.invoice_number}` : 'No invoice number'}
                            {invoice.invoice_date ? ` · ${formatDate(invoice.invoice_date)}` : ''}
                            {invoice.xero_invoice_id ? (
                              <>
                                {' · '}
                                <XeroInvoiceLink xeroInvoiceId={invoice.xero_invoice_id} />
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatGbp(invoice.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(invoice.due_date)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Select
                              value={invoice.status}
                              disabled={updatingStatusId === invoice.id}
                              onValueChange={(value) =>
                                void handleStatusChange(invoice, value as InvoiceStatus)
                              }
                            >
                              <SelectTrigger
                                className="w-[170px]"
                                size="sm"
                                aria-label={`Status for ${invoice.label}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {INVOICE_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {INVOICE_STATUS_LABELS[status]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {invoice.effective_status === 'overdue' && invoice.status !== 'overdue' && (
                              <InvoiceStatusBadge status="overdue" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {invoice.xero_invoice_id ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                asChild
                              >
                                <a
                                  href={xeroInvoiceUrl(invoice.xero_invoice_id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Open ${invoice.label} in Xero`}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(invoice)}
                              aria-label={`Edit ${invoice.label}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => void handleDelete(invoice)}
                              disabled={deletingId === invoice.id}
                              aria-label={`Delete ${invoice.label}`}
                            >
                              {deletingId === invoice.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit invoice' : 'Add invoice'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update this Studio invoice. Changes are not pushed back to Xero.'
                : 'Use this for a deposit, a monthly amount, or a final invoice against this job.'}
            </DialogDescription>
            {editing?.xero_invoice_id ? (
              <XeroInvoiceLink xeroInvoiceId={editing.xero_invoice_id} className="text-sm" />
            ) : null}
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="invoice-label">Label</Label>
              <Input
                id="invoice-label"
                value={form.label}
                onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="50% deposit"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="invoice-amount">Amount (£, ex VAT)</Label>
                <Input
                  id="invoice-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, status: value as InvoiceStatus }))
                  }
                >
                  <SelectTrigger aria-label="Invoice status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVOICE_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {INVOICE_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="invoice-date">Invoice date</Label>
                <Input
                  id="invoice-date"
                  type="date"
                  value={form.invoice_date}
                  onChange={(event) => {
                    const invoiceDate = event.target.value
                    setForm((current) => ({
                      ...current,
                      invoice_date: invoiceDate,
                      due_date: applyDueTerms(invoiceDate, current.due_terms),
                    }))
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label>Due</Label>
                <Select
                  value={form.due_terms}
                  onValueChange={(value) => {
                    const terms = value as DueTerms
                    setForm((current) => ({
                      ...current,
                      due_terms: terms,
                      due_date: applyDueTerms(current.invoice_date || londonToday(), terms),
                    }))
                  }}
                >
                  <SelectTrigger aria-label="Due terms">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DUE_TERMS.map((terms) => (
                      <SelectItem key={terms} value={terms}>
                        {DUE_TERMS_LABELS[terms]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="due-date">Due date</Label>
              <Input
                id="due-date"
                type="date"
                value={form.due_date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, due_date: event.target.value }))
                }
              />
            </div>
            {(!createInXero || editing) && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="invoice-number">Invoice number</Label>
                  <Input
                    id="invoice-number"
                    value={form.invoice_number}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, invoice_number: event.target.value }))
                    }
                    placeholder="Optional"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="paid-date">Paid date</Label>
                  <Input
                    id="paid-date"
                    type="date"
                    value={form.paid_date}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, paid_date: event.target.value }))
                    }
                  />
                </div>
              </div>
            )}
            {!editing && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="create-in-xero">Create in Xero</Label>
                    <p className="text-xs text-muted-foreground">
                      {xeroSetup?.connected
                        ? `Raises an authorised invoice in ${xeroSetup.tenantName || 'Xero'}.`
                        : 'Connect Xero in Settings to raise invoices there.'}
                    </p>
                  </div>
                  <Switch
                    id="create-in-xero"
                    checked={createInXero && Boolean(xeroSetup?.connected)}
                    disabled={!xeroSetup?.connected || xeroLoading}
                    onCheckedChange={(checked) => {
                      setCreateInXero(checked)
                      if (checked) {
                        setForm((current) =>
                          current.status === 'need_invoicing'
                            ? { ...current, status: 'waiting_payment' }
                            : current
                        )
                      }
                    }}
                  />
                </div>
                {createInXero && xeroSetup?.connected && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Account</Label>
                      <Select value={accountCode} onValueChange={setAccountCode}>
                        <SelectTrigger aria-label="Xero account">
                          <SelectValue placeholder={xeroLoading ? 'Loading…' : 'Choose account'} />
                        </SelectTrigger>
                        <SelectContent>
                          {xeroSetup.accounts.map((account) => (
                            <SelectItem key={account.code} value={account.code}>
                              {account.code} - {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Tax rate</Label>
                      <Select value={taxType} onValueChange={setTaxType}>
                        <SelectTrigger aria-label="Tax rate">
                          <SelectValue placeholder={xeroLoading ? 'Loading…' : 'Choose tax rate'} />
                        </SelectTrigger>
                        <SelectContent>
                          {xeroSetup.taxRates.map((rate) => (
                            <SelectItem key={rate.taxType} value={rate.taxType}>
                              {rate.name}
                              {rate.rate ? ` (${rate.rate}%)` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="invoice-notes">Notes</Label>
              <Textarea
                id="invoice-notes"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Optional"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || xeroLoading}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save invoice' : createInXero && xeroSetup?.connected ? 'Add in Xero' : 'Add invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
