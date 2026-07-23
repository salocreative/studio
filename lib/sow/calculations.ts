export const VAT_RATE = 0.2

export interface SowLineItemInput {
  title: string
  description?: string | null
  quantity: number
  is_days: boolean
  timeline_start?: string | null
  timeline_end?: string | null
}

export interface SowPaymentMilestoneInput {
  label: string
  percentage: number
  due_date?: string | null
}

export const DEFAULT_PAYMENT_SCHEDULE: SowPaymentMilestoneInput[] = [
  { label: 'Up front', percentage: 50, due_date: null },
  { label: 'On completion', percentage: 50, due_date: null },
]

export interface ComputedLineItem extends SowLineItemInput {
  hours: number
  unit_rate_gbp: number
  line_total_gbp: number
}

export interface SowTotals {
  subtotal_gbp: number
  vat_amount_gbp: number
  total_gbp: number
  total_hours: number
}

export function computeLineItem(
  input: SowLineItemInput,
  hoursPerDay: number,
  hourlyRate: number
): ComputedLineItem {
  const hours = input.is_days ? input.quantity * hoursPerDay : input.quantity
  const lineTotal = hours * hourlyRate
  return {
    ...input,
    hours,
    unit_rate_gbp: hourlyRate,
    line_total_gbp: Math.round(lineTotal * 100) / 100,
  }
}

export function computeSowTotals(
  lineItems: Array<{ hours: number; line_total_gbp: number }>,
  includeVat: boolean
): SowTotals {
  const subtotal = lineItems.reduce((sum, item) => sum + item.line_total_gbp, 0)
  const totalHours = lineItems.reduce((sum, item) => sum + item.hours, 0)
  const vatAmount = includeVat ? subtotal * VAT_RATE : 0
  const total = subtotal + vatAmount

  return {
    subtotal_gbp: Math.round(subtotal * 100) / 100,
    vat_amount_gbp: Math.round(vatAmount * 100) / 100,
    total_gbp: Math.round(total * 100) / 100,
    total_hours: Math.round(totalHours * 100) / 100,
  }
}

export function hourlyRateFromQuoteRate(dayRateGbp: number, hoursPerDay: number): number {
  if (!hoursPerDay) return 0
  return dayRateGbp / hoursPerDay
}

/** When a quoted day rate is set below (or above) base, scale share-view hours so money still matches base × true effort. */
export function getRateMultiplier(
  baseDayRate: number,
  quotedDayRate: number | null | undefined
): number {
  if (quotedDayRate == null || !(quotedDayRate > 0) || !(baseDayRate > 0)) return 1
  if (Math.abs(quotedDayRate - baseDayRate) < 0.005) return 1
  return baseDayRate / quotedDayRate
}

/** Round to the nearest whole or half hour/day (e.g. 17.28 → 17.5, 2.88 → 3). */
export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2
}

export function scaleForQuote(value: number, multiplier: number): number {
  return roundToHalf(value * multiplier)
}

export type SowPartyType = 'agency' | 'client'
export type SowCurrency = 'GBP' | 'USD'

export interface SowPartyRateLookup {
  name: string
  party_type: SowPartyType
  day_rate_gbp: number
  currency?: SowCurrency | string
}

/** Resolve quoted day rate + default currency for a SoW from configured agency/client rates. */
export function resolvePartyRate(params: {
  customerType: 'partner' | 'client'
  agencyName?: string | null
  clientName?: string | null
  rates: SowPartyRateLookup[]
}): { day_rate_gbp: number; currency: SowCurrency } | null {
  const agencyName = params.agencyName?.trim() || ''
  const clientName = params.clientName?.trim() || ''

  const normalizeCurrency = (value?: string | null): SowCurrency =>
    value === 'USD' ? 'USD' : 'GBP'

  if (params.customerType === 'partner') {
    if (agencyName) {
      const agencyRate = params.rates.find(
        (r) => r.party_type === 'agency' && r.name === agencyName
      )
      if (agencyRate) {
        return {
          day_rate_gbp: Number(agencyRate.day_rate_gbp),
          currency: normalizeCurrency(agencyRate.currency),
        }
      }
    }
    if (clientName) {
      const clientRate = params.rates.find(
        (r) => r.party_type === 'client' && r.name === clientName
      )
      if (clientRate) {
        return {
          day_rate_gbp: Number(clientRate.day_rate_gbp),
          currency: normalizeCurrency(clientRate.currency),
        }
      }
    }
    return null
  }

  if (!clientName) return null
  const clientRate = params.rates.find(
    (r) => r.party_type === 'client' && r.name === clientName
  )
  if (!clientRate) return null
  return {
    day_rate_gbp: Number(clientRate.day_rate_gbp),
    currency: normalizeCurrency(clientRate.currency),
  }
}

/** @deprecated Prefer resolvePartyRate */
export function resolvePartyDayRate(params: {
  customerType: 'partner' | 'client'
  agencyName?: string | null
  clientName?: string | null
  rates: SowPartyRateLookup[]
}): number | null {
  return resolvePartyRate(params)?.day_rate_gbp ?? null
}

/** Convert a GBP amount into the SoW display currency. */
export function convertFromGbp(
  amountGbp: number,
  fxRate: number,
  options?: { round?: 'cent' | 'whole' }
): number {
  const rate = fxRate > 0 ? fxRate : 1
  const raw = amountGbp * rate
  if (options?.round === 'whole') {
    return Math.round(raw)
  }
  return Math.round(raw * 100) / 100
}

export function formatSowMoney(
  amountGbp: number,
  currency: SowCurrency | string = 'GBP',
  fxRate = 1
): string {
  const isForeign = currency !== 'GBP'
  const converted = convertFromGbp(amountGbp, isForeign ? fxRate : 1, {
    // FX amounts round to nearest whole unit to avoid noisy cents
    round: isForeign ? 'whole' : 'cent',
  })
  const symbol = currency === 'USD' ? '$' : '£'
  return `${symbol}${converted.toLocaleString('en-GB', {
    minimumFractionDigits: isForeign ? 0 : 2,
    maximumFractionDigits: isForeign ? 0 : 2,
  })}`
}

/** Locale for client-facing SoW dates: US when quoting USD, UK otherwise. */
export function sowDateLocale(currency: SowCurrency | string = 'GBP'): string {
  return currency === 'USD' ? 'en-US' : 'en-GB'
}

/**
 * Format a date for SoW share/display.
 * Date-only strings (YYYY-MM-DD) are parsed as local calendar dates to avoid UTC day-shift bugs.
 */
export function formatSowDate(
  value: string | null | undefined,
  currency: SowCurrency | string = 'GBP'
): string {
  if (!value) return ''
  const locale = sowDateLocale(currency)
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(locale)
}

export function validatePaymentSchedule(
  milestones: SowPaymentMilestoneInput[]
): string | null {
  if (!milestones.length) return 'Add at least one payment milestone'
  for (const m of milestones) {
    if (!m.label.trim()) return 'Each payment milestone needs a label'
    if (!(m.percentage > 0)) return 'Each payment percentage must be greater than 0'
  }
  const sum = milestones.reduce((acc, m) => acc + Number(m.percentage), 0)
  if (Math.abs(sum - 100) > 0.05) {
    return `Payment percentages must total 100% (currently ${sum.toFixed(1)}%)`
  }
  return null
}

export function validateLineItemTimeline(
  start?: string | null,
  end?: string | null
): string | null {
  if (start && end && start > end) {
    return 'Line item end date must be on or after its start date'
  }
  return null
}
