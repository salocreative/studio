import { addIsoDays, londonToday } from '@/lib/billing/invoices'

export { londonToday }

export const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly'] as const
export const PAYMENT_METHODS = ['invoice', 'stripe', 'other'] as const
export const HOSTING_STATUSES = ['active', 'paused', 'ended'] as const
export const HOSTING_CURRENCIES = ['GBP', 'USD'] as const
export const SUGGESTED_PLATFORMS = ['Flywheel', 'Framer', 'Vercel', 'Webflow'] as const

export type BillingCycle = (typeof BILLING_CYCLES)[number]
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export type HostingStatus = (typeof HOSTING_STATUSES)[number]
export type RenewalUrgency = 'due_soon' | 'scheduled' | 'none'

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  invoice: 'Invoice',
  stripe: 'Stripe',
  other: 'Other',
}

export const HOSTING_STATUS_LABELS: Record<HostingStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
}

export const DUE_SOON_DAYS = 30

export interface HostingSite {
  id: string
  client_name: string
  site_name: string
  domain: string | null
  platform: string | null
  started_on: string | null
  billing_cycle: BillingCycle
  amount: number
  currency: string
  payment_method: PaymentMethod
  stripe_reference: string | null
  status: HostingStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export function isBillingCycle(value: string): value is BillingCycle {
  return (BILLING_CYCLES as readonly string[]).includes(value)
}

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value)
}

export function isHostingStatus(value: string): value is HostingStatus {
  return (HOSTING_STATUSES as readonly string[]).includes(value)
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100
}

/** Amount charged on one billing cycle, expressed as a monthly figure. */
export function monthlyEquivalent(amount: number, cycle: BillingCycle): number {
  if (cycle === 'monthly') return amount
  if (cycle === 'quarterly') return amount / 3
  return amount / 12
}

/** Amount charged on one billing cycle, expressed as a yearly figure. */
export function annualEquivalent(amount: number, cycle: BillingCycle): number {
  if (cycle === 'yearly') return amount
  if (cycle === 'quarterly') return amount * 4
  return amount * 12
}

export function renewalUrgency(
  renewalOn: string | null,
  status: HostingStatus,
  today: string = londonToday()
): RenewalUrgency {
  if (status !== 'active' || !renewalOn) return 'none'
  if (renewalOn <= addIsoDays(today, DUE_SOON_DAYS)) return 'due_soon'
  return 'scheduled'
}

/** Add calendar months, keeping the original day and clamping short months. */
export function addMonthsClamped(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return isoDate
  const total = year * 12 + (month - 1) + months
  const nextYear = Math.floor(total / 12)
  const nextMonthIndex = ((total % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(nextYear, nextMonthIndex + 1, 0)).getUTCDate()
  const nextDay = Math.min(day, lastDay)
  const y = String(nextYear).padStart(4, '0')
  const m = String(nextMonthIndex + 1).padStart(2, '0')
  const d = String(nextDay).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function cycleMonths(cycle: BillingCycle): number {
  if (cycle === 'yearly') return 12
  if (cycle === 'quarterly') return 3
  return 1
}

/**
 * Next renewal on or after today.
 * The start date is the billing anchor: each cycle falls on that day of the month.
 */
export function upcomingRenewal(
  startedOn: string,
  cycle: BillingCycle,
  today: string = londonToday()
): string {
  const anchor = startedOn.slice(0, 10)
  if (anchor >= today) return anchor
  const step = cycleMonths(cycle)
  const [year, month] = anchor.split('-').map(Number)
  const [todayYear, todayMonth] = today.split('-').map(Number)
  if (!year || !month || !todayYear || !todayMonth) return anchor
  const elapsedMonths = todayYear * 12 + (todayMonth - 1) - (year * 12 + (month - 1))
  let steps = Math.ceil(elapsedMonths / step)
  if (steps < 0) steps = 0
  let candidate = addMonthsClamped(anchor, steps * step)
  if (candidate < today) candidate = addMonthsClamped(anchor, (steps + 1) * step)
  return candidate
}

export interface CurrencyIncome {
  currency: string
  monthly: number
  annual: number
  byCycle: Record<BillingCycle, number>
}

export interface HostingSummary {
  activeCount: number
  pausedCount: number
  dueSoonCount: number
  missingStartCount: number
  income: CurrencyIncome[]
}

export function summariseHosting(sites: HostingSite[], today: string = londonToday()): HostingSummary {
  const income = new Map<string, CurrencyIncome>()
  let activeCount = 0
  let pausedCount = 0
  let dueSoonCount = 0
  let missingStartCount = 0

  for (const site of sites) {
    if (site.status === 'paused') pausedCount += 1
    if (site.status !== 'active') continue
    activeCount += 1
    if (!site.started_on) {
      missingStartCount += 1
    } else {
      const urgency = renewalUrgency(
        upcomingRenewal(site.started_on, site.billing_cycle, today),
        site.status,
        today
      )
      if (urgency === 'due_soon') dueSoonCount += 1
    }

    const currency = site.currency || 'GBP'
    const current = income.get(currency) ?? {
      currency,
      monthly: 0,
      annual: 0,
      byCycle: { monthly: 0, quarterly: 0, yearly: 0 },
    }
    current.monthly += monthlyEquivalent(site.amount, site.billing_cycle)
    current.annual += annualEquivalent(site.amount, site.billing_cycle)
    current.byCycle[site.billing_cycle] += monthlyEquivalent(site.amount, site.billing_cycle)
    income.set(currency, current)
  }

  const ordered = Array.from(income.values())
    .map((row) => ({
      ...row,
      monthly: roundMoney(row.monthly),
      annual: roundMoney(row.annual),
      byCycle: {
        monthly: roundMoney(row.byCycle.monthly),
        quarterly: roundMoney(row.byCycle.quarterly),
        yearly: roundMoney(row.byCycle.yearly),
      },
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency))

  return { activeCount, pausedCount, dueSoonCount, missingStartCount, income: ordered }
}

export function formatMoney(amount: number, currency: string): string {
  const formatted = amount.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (currency === 'USD') return `$${formatted}`
  if (currency === 'GBP') return `£${formatted}`
  return `${currency} ${formatted}`
}

export function domainHref(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
}
