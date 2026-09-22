'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getBillingJobs, type BillingJob } from '@/app/actions/invoices'
import { JobInvoiceSummarySheet } from '@/components/billing/job-invoice-summary-sheet'
import {
  buildCashflowGrid,
  formatMonthLabel,
  type CashflowItem,
} from '@/lib/billing/cashflow'
import {
  INVOICE_STATUS_LABELS,
  formatGbp,
  londonToday,
  type InvoiceStatus,
} from '@/lib/billing/invoices'
import { cn } from '@/lib/utils'

const STATUS_CHIP_CLASS: Record<InvoiceStatus, string> = {
  need_invoicing:
    'border-amber-200 bg-amber-50/90 text-amber-950 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100',
  waiting_payment:
    'border-sky-200 bg-sky-50/90 text-sky-950 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100',
  overdue:
    'border-red-200 bg-red-50/90 text-red-950 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100',
  paid:
    'border-emerald-200 bg-emerald-50/90 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100',
}

function InvoiceChip({
  item,
  onSelect,
}: {
  item: CashflowItem
  onSelect: (item: CashflowItem) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        'block w-full rounded-md border px-2 py-1.5 text-left transition-colors hover:brightness-95 dark:hover:brightness-110',
        STATUS_CHIP_CLASS[item.status]
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium tabular-nums">{formatGbp(item.amount)}</span>
        {item.source === 'unbilled' ? (
          <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">Unbilled</span>
        ) : item.status === 'paid' ? (
          <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">Paid</span>
        ) : null}
      </div>
      <div className="mt-0.5 truncate text-xs opacity-80">{item.projectName}</div>
      <div className="truncate text-[11px] opacity-70">{item.label}</div>
    </button>
  )
}

function SummaryCard({
  title,
  amount,
  hint,
}: {
  title: string
  amount: number
  hint: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{formatGbp(amount)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

export default function ForecastPageClient() {
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<BillingJob[]>([])
  const [summaryJobId, setSummaryJobId] = useState<string | null>(null)
  const [highlightedInvoiceId, setHighlightedInvoiceId] = useState<string | null>(null)
  const [showPaid, setShowPaid] = useState(true)

  useEffect(() => {
    void load()
  }, [])

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) setLoading(true)
    try {
      const result = await getBillingJobs()
      if (result.error) {
        toast.error('Could not load forecast', { description: result.error })
        setJobs([])
      } else {
        setJobs(result.jobs ?? [])
      }
    } catch (error) {
      console.error('Error loading cashflow forecast:', error)
      toast.error('Could not load forecast')
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }

  function openItem(item: CashflowItem) {
    setSummaryJobId(item.projectId)
    setHighlightedInvoiceId(item.id)
  }

  const grid = useMemo(
    () => buildCashflowGrid(jobs, londonToday(), { includePaid: showPaid }),
    [jobs, showPaid]
  )
  const currentIndex = grid.months.indexOf(grid.currentMonth)
  const pastMonths = grid.months.slice(0, Math.max(currentIndex, 0))
  const futureMonths = grid.months.slice(currentIndex + 1)

  const thisMonthTotal = grid.totalsByMonth[grid.currentMonth] ?? 0
  const thisMonthToSend = grid.toSendByMonth[grid.currentMonth] ?? 0
  const pastToSend = pastMonths.reduce((sum, month) => sum + (grid.toSendByMonth[month] ?? 0), 0)
  const nextToSend = futureMonths.reduce((sum, month) => sum + (grid.toSendByMonth[month] ?? 0), 0)
  const unscheduledTotal = grid.unscheduled.reduce((sum, item) => sum + item.amount, 0)

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b bg-background">
          <div className="flex h-16 items-center px-6">
            <div>
              <h1 className="text-2xl font-semibold">Forecast</h1>
              <p className="text-sm text-muted-foreground">Cashflow by client and month</p>
            </div>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background">
        <div className="flex min-h-16 items-center justify-between gap-3 px-6 py-3">
            <div>
              <h1 className="text-2xl font-semibold">Forecast</h1>
              <p className="text-sm text-muted-foreground">
                Invoices by client and month, three months either side of this month. Paid only
                when linked to Xero.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Label htmlFor="show-paid" className="text-sm font-medium">
                Show paid
              </Label>
              <Switch id="show-paid" checked={showPaid} onCheckedChange={setShowPaid} />
            </div>
          </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Late to send"
              amount={pastToSend}
              hint="Need invoicing in the past three months"
            />
            <SummaryCard
              title="This month"
              amount={thisMonthTotal}
              hint={`${formatGbp(thisMonthToSend)} still to send`}
            />
            <SummaryCard
              title="Next three months"
              amount={nextToSend}
              hint="Invoices still due to be sent"
            />
            <SummaryCard
              title="Unscheduled"
              amount={unscheduledTotal}
              hint="No invoice or due date yet"
            />
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(
              (showPaid
                ? ['need_invoicing', 'waiting_payment', 'overdue', 'paid']
                : ['need_invoicing', 'waiting_payment', 'overdue']) as InvoiceStatus[]
            ).map((status) => (
              <span key={status} className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    'inline-block size-2.5 rounded-sm border',
                    STATUS_CHIP_CLASS[status]
                  )}
                />
                {INVOICE_STATUS_LABELS[status]}
              </span>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Cashflow</CardTitle>
              <CardDescription>
                Clients down the side, months across. Open an invoice for a summary before going
                to full details. Use Show paid for Xero-linked invoices on their paid date. Unbilled
                quote remainder is included where the job has a due or completed date.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0 sm:px-0">
              {grid.rows.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">
                  No invoices fall in this window. Add invoices on the{' '}
                  <Link href="/billing" className="underline underline-offset-2">
                    Invoices
                  </Link>{' '}
                  page to see them here.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] border-collapse text-sm">
                    <thead>
                      <tr className="border-y">
                        <th className="sticky left-0 z-20 min-w-[180px] bg-background px-4 py-2.5 text-left font-medium shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                          Client
                        </th>
                        {grid.months.map((month) => {
                          const isCurrent = month === grid.currentMonth
                          return (
                            <th
                              key={month}
                              className={cn(
                                'min-w-[160px] px-2 py-2.5 text-right font-medium',
                                isCurrent && 'bg-[#6405FF]/10 text-[#6405FF]'
                              )}
                            >
                              {formatMonthLabel(month)}
                              {isCurrent ? (
                                <span className="ml-1 text-[10px] font-normal uppercase tracking-wide">
                                  Now
                                </span>
                              ) : null}
                            </th>
                          )
                        })}
                        <th className="min-w-[120px] px-4 py-2.5 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grid.rows.map((row) => (
                        <tr key={row.clientName} className="border-b align-top">
                          <td className="sticky left-0 z-10 bg-background px-4 py-3 font-medium shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                            {row.clientName}
                          </td>
                          {grid.months.map((month) => {
                            const items = row.itemsByMonth[month] ?? []
                            const monthTotal = items.reduce((sum, item) => sum + item.amount, 0)
                            const isCurrent = month === grid.currentMonth
                            return (
                              <td
                                key={month}
                                className={cn('px-2 py-2', isCurrent && 'bg-[#6405FF]/5')}
                              >
                                {items.length === 0 ? (
                                  <span className="block py-1 text-right text-muted-foreground">—</span>
                                ) : (
                                  <div className="space-y-1.5">
                                    {items.map((item) => (
                                      <InvoiceChip key={item.id} item={item} onSelect={openItem} />
                                    ))}
                                    {items.length > 1 ? (
                                      <p className="px-1 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                                        {formatGbp(monthTotal)}
                                      </p>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-4 py-3 text-right font-medium tabular-nums">
                            {row.total > 0 ? formatGbp(row.total) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/40 font-medium">
                        <td className="sticky left-0 z-10 bg-muted/40 px-4 py-3 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                          Total
                        </td>
                        {grid.months.map((month) => (
                          <td
                            key={month}
                            className={cn(
                              'px-2 py-3 text-right tabular-nums',
                              month === grid.currentMonth && 'bg-[#6405FF]/10'
                            )}
                          >
                            {(grid.totalsByMonth[month] ?? 0) > 0
                              ? formatGbp(grid.totalsByMonth[month] ?? 0)
                              : '—'}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right tabular-nums">
                          {grid.grandTotal > 0 ? formatGbp(grid.grandTotal) : '—'}
                        </td>
                      </tr>
                      {showPaid ? (
                      <tr className="border-t text-muted-foreground">
                        <td className="sticky left-0 z-10 bg-background px-4 py-2 text-xs shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                          Of which paid
                        </td>
                        {grid.months.map((month) => (
                          <td
                            key={month}
                            className={cn(
                              'px-2 py-2 text-right text-xs tabular-nums',
                              month === grid.currentMonth && 'bg-[#6405FF]/5'
                            )}
                          >
                            {(grid.paidByMonth[month] ?? 0) > 0
                              ? formatGbp(grid.paidByMonth[month] ?? 0)
                              : '—'}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right text-xs tabular-nums">
                          {Object.values(grid.paidByMonth).some((value) => value > 0)
                            ? formatGbp(
                                Object.values(grid.paidByMonth).reduce(
                                  (sum, value) => sum + value,
                                  0
                                )
                              )
                            : '—'}
                        </td>
                      </tr>
                      ) : null}
                      <tr className="border-t text-muted-foreground">
                        <td className="sticky left-0 z-10 bg-background px-4 py-2 text-xs shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]">
                          Of which to send
                        </td>
                        {grid.months.map((month) => (
                          <td
                            key={month}
                            className={cn(
                              'px-2 py-2 text-right text-xs tabular-nums',
                              month === grid.currentMonth && 'bg-[#6405FF]/5'
                            )}
                          >
                            {(grid.toSendByMonth[month] ?? 0) > 0
                              ? formatGbp(grid.toSendByMonth[month] ?? 0)
                              : '—'}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right text-xs tabular-nums">
                          {Object.values(grid.toSendByMonth).some((value) => value > 0)
                            ? formatGbp(
                                Object.values(grid.toSendByMonth).reduce(
                                  (sum, value) => sum + value,
                                  0
                                )
                              )
                            : '—'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {grid.unscheduled.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Unscheduled</CardTitle>
                <CardDescription>
                  Need invoicing, but no invoice date or due date to place on the grid.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {grid.unscheduled.map((item) => (
                    <InvoiceChip key={item.id} item={item} onSelect={openItem} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <JobInvoiceSummarySheet
        job={jobs.find((job) => job.id === summaryJobId) ?? null}
        open={summaryJobId !== null}
        highlightedInvoiceId={highlightedInvoiceId}
        onOpenChange={(open) => {
          if (!open) {
            setSummaryJobId(null)
            setHighlightedInvoiceId(null)
          }
        }}
        onChanged={() => load({ silent: true })}
      />
    </div>
  )
}
