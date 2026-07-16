export const VAT_RATE = 0.2

export interface SowLineItemInput {
  title: string
  description?: string | null
  quantity: number
  is_days: boolean
}

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
