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
