import { format, parseISO } from 'date-fns'
import {
  londonToday,
  roundGbp,
  type InvoiceStatus,
} from '@/lib/billing/invoices'

export const CASHFLOW_PAST_MONTHS = 3
export const CASHFLOW_FUTURE_MONTHS = 3

export const NO_CLIENT_NAME = 'No client'

export interface CashflowItem {
  id: string
  projectId: string
  projectName: string
  clientName: string
  label: string
  amount: number
  status: InvoiceStatus
  monthKey: string | null
  date: string | null
  source: 'invoice' | 'unbilled'
}

export interface CashflowClientRow {
  clientName: string
  itemsByMonth: Record<string, CashflowItem[]>
  unscheduled: CashflowItem[]
  total: number
}

export interface CashflowGrid {
  months: string[]
  currentMonth: string
  rows: CashflowClientRow[]
  totalsByMonth: Record<string, number>
  toSendByMonth: Record<string, number>
  paidByMonth: Record<string, number>
  grandTotal: number
  unscheduled: CashflowItem[]
}

export interface CashflowJobInput {
  id: string
  name: string
  client_name: string | null
  due_date: string | null
  completed_date: string | null
  unbilled: number
  invoices: Array<{
    id: string
    label: string
    amount: number
    effective_status: InvoiceStatus
    invoice_date: string | null
    due_date: string | null
    paid_date: string | null
    xero_invoice_id: string | null
  }>
}

export function monthKeyFromIsoDate(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 7) return null
  const key = iso.slice(0, 7)
  return /^\d{4}-\d{2}$/.test(key) ? key : null
}

export function cashflowMonthKeys(today: string = londonToday()): string[] {
  const [year, month] = today.split('-').map(Number)
  if (!year || !month) return []

  const keys: string[] = []
  for (let offset = -CASHFLOW_PAST_MONTHS; offset <= CASHFLOW_FUTURE_MONTHS; offset++) {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1))
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

export function formatMonthLabel(monthKey: string): string {
  try {
    return format(parseISO(`${monthKey}-01`), 'MMM yyyy')
  } catch {
    return monthKey
  }
}

/** Month to place the invoice: paid date when paid, otherwise invoice date, then payment due. */
export function invoiceScheduleDate(invoice: {
  effective_status?: InvoiceStatus
  paid_date?: string | null
  invoice_date: string | null
  due_date: string | null
}): string | null {
  if (invoice.effective_status === 'paid') {
    return invoice.paid_date || invoice.invoice_date || invoice.due_date
  }
  return invoice.invoice_date || invoice.due_date
}

function sortItems(a: CashflowItem, b: CashflowItem): number {
  const dateDelta = (a.date ?? '').localeCompare(b.date ?? '')
  if (dateDelta !== 0) return dateDelta
  const projectDelta = a.projectName.localeCompare(b.projectName)
  if (projectDelta !== 0) return projectDelta
  return a.label.localeCompare(b.label)
}

export function buildCashflowGrid(
  jobs: CashflowJobInput[],
  today: string = londonToday(),
  options?: { includePaid?: boolean }
): CashflowGrid {
  const includePaid = options?.includePaid !== false
  const months = cashflowMonthKeys(today)
  const monthSet = new Set(months)
  const currentMonth = months[CASHFLOW_PAST_MONTHS] ?? monthKeyFromIsoDate(today) ?? ''
  const items: CashflowItem[] = []

  for (const job of jobs) {
    const clientName = job.client_name?.trim() || NO_CLIENT_NAME
    for (const invoice of job.invoices) {
      if (invoice.effective_status === 'paid' && (!includePaid || !invoice.xero_invoice_id)) {
        continue
      }
      const date = invoiceScheduleDate(invoice)
      items.push({
        id: invoice.id,
        projectId: job.id,
        projectName: job.name,
        clientName,
        label: invoice.label,
        amount: invoice.amount,
        status: invoice.effective_status,
        monthKey: monthKeyFromIsoDate(date),
        date,
        source: 'invoice',
      })
    }
    if (job.unbilled > 0.009) {
      const date = job.due_date || job.completed_date
      items.push({
        id: `unbilled:${job.id}`,
        projectId: job.id,
        clientName,
        projectName: job.name,
        label: 'Unbilled remainder',
        amount: roundGbp(job.unbilled),
        status: 'need_invoicing',
        monthKey: monthKeyFromIsoDate(date),
        date,
        source: 'unbilled',
      })
    }
  }

  const inWindow = items.filter((item) => !item.monthKey || monthSet.has(item.monthKey))
  const unscheduled = inWindow
    .filter((item) => !item.monthKey && item.status !== 'paid')
    .sort(sortItems)

  const byClient = new Map<string, CashflowItem[]>()
  for (const item of inWindow) {
    const list = byClient.get(item.clientName) ?? []
    list.push(item)
    byClient.set(item.clientName, list)
  }

  const totalsByMonth: Record<string, number> = Object.fromEntries(months.map((month) => [month, 0]))
  const toSendByMonth: Record<string, number> = Object.fromEntries(months.map((month) => [month, 0]))
  const paidByMonth: Record<string, number> = Object.fromEntries(months.map((month) => [month, 0]))

  const rows: CashflowClientRow[] = Array.from(byClient.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clientName, clientItems]) => {
      const itemsByMonth: Record<string, CashflowItem[]> = Object.fromEntries(
        months.map((month) => [month, [] as CashflowItem[]])
      )
      const clientUnscheduled: CashflowItem[] = []
      let total = 0

      for (const item of clientItems) {
        if (!item.monthKey) {
          if (item.status !== 'paid') clientUnscheduled.push(item)
          continue
        }
        itemsByMonth[item.monthKey].push(item)
        totalsByMonth[item.monthKey] = roundGbp(totalsByMonth[item.monthKey] + item.amount)
        if (item.status === 'need_invoicing') {
          toSendByMonth[item.monthKey] = roundGbp(toSendByMonth[item.monthKey] + item.amount)
        }
        if (item.status === 'paid') {
          paidByMonth[item.monthKey] = roundGbp(paidByMonth[item.monthKey] + item.amount)
        }
        total = roundGbp(total + item.amount)
      }

      for (const month of months) {
        itemsByMonth[month].sort(sortItems)
      }
      clientUnscheduled.sort(sortItems)

      return {
        clientName,
        itemsByMonth,
        unscheduled: clientUnscheduled,
        total,
      }
    })
    .filter((row) => row.total > 0)

  const grandTotal = roundGbp(months.reduce((sum, month) => sum + totalsByMonth[month], 0))

  return {
    months,
    currentMonth,
    rows,
    totalsByMonth,
    toSendByMonth,
    paidByMonth,
    grandTotal,
    unscheduled,
  }
}
