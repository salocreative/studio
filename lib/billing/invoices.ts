export const INVOICE_STATUSES = [
  'need_invoicing',
  'waiting_payment',
  'overdue',
  'paid',
] as const

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  need_invoicing: 'Need invoicing',
  waiting_payment: 'Waiting payment',
  overdue: 'Overdue',
  paid: 'Paid',
}

export const INVOICE_STATUS_PRIORITY: Record<InvoiceStatus, number> = {
  overdue: 0,
  need_invoicing: 1,
  waiting_payment: 2,
  paid: 3,
}

export function londonToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
}

export function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const DUE_TERMS = ['30', '14', '0'] as const
export type DueTerms = (typeof DUE_TERMS)[number]

export const DUE_TERMS_LABELS: Record<DueTerms, string> = {
  '30': '30 days',
  '14': '14 days',
  '0': 'Immediate',
}

export function dueDateFromTerms(invoiceDate: string, terms: DueTerms): string {
  return addIsoDays(invoiceDate, Number(terms))
}

export function roundGbp(amount: number): number {
  return Math.round(amount * 100) / 100
}

export function toGbpNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(n) ? n : 0
}

export function formatGbp(amount: number): string {
  return `£${amount.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value)
}

/** Waiting-payment invoices past their due date count as overdue. */
export function effectiveInvoiceStatus(
  status: InvoiceStatus,
  dueDate: string | null,
  today: string = londonToday()
): InvoiceStatus {
  if (status === 'waiting_payment' && dueDate && dueDate < today) {
    return 'overdue'
  }
  return status
}

export function invoiceStatusBadgeClass(status: InvoiceStatus): string {
  switch (status) {
    case 'overdue':
      return 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
    case 'need_invoicing':
      return 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
    case 'waiting_payment':
      return 'border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300'
    case 'paid':
      return 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
  }
}

export interface InvoiceAmounts {
  amount: number
  status: InvoiceStatus
  due_date: string | null
}

export interface ProjectBillingRollup {
  invoicedTotal: number
  unbilled: number
  paidTotal: number
  outstandingTotal: number
  byStatus: Record<InvoiceStatus, number>
  billingStatus: InvoiceStatus
}

export function projectBillingRollup(
  quoteValue: number | null,
  invoices: InvoiceAmounts[],
  today: string = londonToday()
): ProjectBillingRollup {
  const invoicedTotal = roundGbp(invoices.reduce((sum, invoice) => sum + invoice.amount, 0))
  const unbilled =
    quoteValue != null ? roundGbp(Math.max(0, quoteValue - invoicedTotal)) : 0

  const byStatus: Record<InvoiceStatus, number> = {
    need_invoicing: 0,
    waiting_payment: 0,
    overdue: 0,
    paid: 0,
  }

  for (const invoice of invoices) {
    const status = effectiveInvoiceStatus(invoice.status, invoice.due_date, today)
    byStatus[status] = roundGbp(byStatus[status] + invoice.amount)
  }

  let billingStatus: InvoiceStatus
  if (byStatus.overdue > 0) {
    billingStatus = 'overdue'
  } else if (byStatus.need_invoicing > 0 || unbilled > 0.009 || invoices.length === 0) {
    billingStatus = 'need_invoicing'
  } else if (byStatus.waiting_payment > 0) {
    billingStatus = 'waiting_payment'
  } else {
    billingStatus = 'paid'
  }

  const outstandingTotal = roundGbp(
    byStatus.need_invoicing + byStatus.waiting_payment + byStatus.overdue + unbilled
  )

  return {
    invoicedTotal,
    unbilled,
    paidTotal: byStatus.paid,
    outstandingTotal,
    byStatus,
    billingStatus,
  }
}
