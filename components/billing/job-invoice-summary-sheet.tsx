'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { CheckCircle2, ExternalLink, Loader2, Split } from 'lucide-react'
import { toast } from 'sonner'
import {
  markQuoteAsPaid,
  splitRemainingFiftyFifty,
  updateProjectInvoiceStatus,
  type BillingJob,
  type ProjectInvoice,
} from '@/app/actions/invoices'
import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge'
import { ProjectSourceLinks } from '@/components/billing/project-source-links'
import { XeroInvoiceLink } from '@/components/billing/xero-invoice-link'
import { isStuckMondayStatus } from '@/lib/monday/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  formatGbp,
  type InvoiceStatus,
} from '@/lib/billing/invoices'
import { cn } from '@/lib/utils'

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'd MMM yyyy')
  } catch {
    return value
  }
}

export function JobInvoiceSummarySheet({
  job,
  open,
  onOpenChange,
  highlightedInvoiceId,
  onChanged,
}: {
  job: BillingJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
  highlightedInvoiceId?: string | null
  onChanged?: () => void | Promise<void>
}) {
  const highlightRef = useRef<HTMLLIElement>(null)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    highlightRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open, highlightedInvoiceId, job?.id])

  async function refresh() {
    await onChanged?.()
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
      const result = await markQuoteAsPaid(job.id)
      if (result.error) {
        toast.error('Could not mark quote as paid', { description: result.error })
      } else {
        toast.success('Remaining quote marked as paid')
        await refresh()
      }
    } finally {
      setMarkingPaid(false)
    }
  }

  async function handleSplit() {
    if (!job || job.unbilled <= 0) return
    setSplitting(true)
    try {
      const result = await splitRemainingFiftyFifty(job.id)
      if (result.error) {
        toast.error('Could not split remaining amount', { description: result.error })
      } else {
        toast.success('Added 50% deposit and 50% on delivery')
        await refresh()
      }
    } finally {
      setSplitting(false)
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
        await refresh()
      }
    } finally {
      setUpdatingStatusId(null)
    }
  }

  const unbilledHighlighted = highlightedInvoiceId === `unbilled:${job?.id}`
  const hasQuickActions = Boolean(job && job.unbilled > 0.009)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        {!job ? (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">No job selected</p>
          </div>
        ) : (
          <>
            <SheetHeader className="border-b p-6 pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="text-lg leading-snug">{job.name}</SheetTitle>
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
              <SheetDescription>
                {job.client_name || 'No client'}
                {job.agency ? ` · ${job.agency}` : ''}
              </SheetDescription>
              <ProjectSourceLinks
                projectId={job.id}
                status={job.status}
                mondayUrl={job.monday_url}
                className="pt-1"
              />
            </SheetHeader>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <SummaryStat label="Quote" value={job.quote_value != null ? formatGbp(job.quote_value) : '—'} />
                <SummaryStat label="Invoiced" value={formatGbp(job.invoiced_total)} />
                <SummaryStat label="Unbilled" value={formatGbp(job.unbilled)} emphasise={job.unbilled > 0} />
                <SummaryStat label="Outstanding" value={formatGbp(job.outstanding_total)} emphasise={job.outstanding_total > 0} />
                <SummaryStat label="Due" value={formatDate(job.due_date)} />
                <SummaryStat label="Completed" value={formatDate(job.completed_date)} />
              </dl>

              {hasQuickActions ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleMarkPaid()}
                    disabled={markingPaid}
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
                    disabled={splitting}
                  >
                    {splitting ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Split className="mr-1 h-4 w-4" />
                    )}
                    Split remaining 50/50
                  </Button>
                </div>
              ) : null}

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Invoices</h3>
                {job.invoices.length === 0 && job.unbilled <= 0.009 ? (
                  <p className="text-sm text-muted-foreground">
                    No invoices yet. Open full details to add a deposit, monthly amount, or the full job value.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {job.invoices.map((invoice) => {
                      const highlighted = invoice.id === highlightedInvoiceId
                      return (
                        <li
                          key={invoice.id}
                          ref={highlighted ? highlightRef : undefined}
                          className={cn(
                            'rounded-lg border p-3',
                            highlighted && 'border-[#6405FF] ring-2 ring-[#6405FF]/20'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium">{invoice.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {invoice.invoice_number ? `#${invoice.invoice_number}` : 'No invoice number'}
                                {invoice.invoice_date ? ` · ${formatDate(invoice.invoice_date)}` : ''}
                                {invoice.due_date ? ` · due ${formatDate(invoice.due_date)}` : ''}
                                {invoice.xero_invoice_id ? (
                                  <>
                                    {' · '}
                                    <XeroInvoiceLink xeroInvoiceId={invoice.xero_invoice_id} />
                                  </>
                                ) : null}
                              </p>
                            </div>
                            <p className="shrink-0 font-medium tabular-nums">{formatGbp(invoice.amount)}</p>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
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
                              <SelectContent className="z-[70]">
                                {INVOICE_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {INVOICE_STATUS_LABELS[status]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {invoice.effective_status === 'overdue' && invoice.status !== 'overdue' ? (
                              <InvoiceStatusBadge status="overdue" />
                            ) : null}
                            {updatingStatusId === invoice.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                    {job.unbilled > 0.009 ? (
                      <li
                        ref={unbilledHighlighted ? highlightRef : undefined}
                        className={cn(
                          'rounded-lg border border-dashed p-3',
                          unbilledHighlighted && 'border-[#6405FF] ring-2 ring-[#6405FF]/20'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">Unbilled remainder</p>
                            <p className="text-xs text-muted-foreground">
                              Quote value not yet covered by an invoice
                            </p>
                          </div>
                          <p className="shrink-0 font-medium tabular-nums">{formatGbp(job.unbilled)}</p>
                        </div>
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
            </div>

            <SheetFooter className="border-t bg-background p-4">
              <Button asChild>
                <Link href={`/billing/${job.id}`}>
                  Open full details
                  <ExternalLink className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function SummaryStat({
  label,
  value,
  emphasise,
}: {
  label: string
  value: string
  emphasise?: boolean
}) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 font-medium tabular-nums', emphasise && 'text-foreground')}>{value}</dd>
    </div>
  )
}
