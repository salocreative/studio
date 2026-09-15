/**
 * Standard Flexi-Design credit packs (ex VAT).
 * List rate is £90/credit; larger packs take 5/10/15% off.
 */
export const FLEXI_DESIGN_STANDARD_PACKS = [
  { hours: 20, valueGbp: 1800, discountPercent: 0 },
  { hours: 40, valueGbp: 3420, discountPercent: 5 },
  { hours: 60, valueGbp: 4860, discountPercent: 10 },
  { hours: 80, valueGbp: 6120, discountPercent: 15 },
] as const

export type FlexiDesignStandardPack = (typeof FLEXI_DESIGN_STANDARD_PACKS)[number]

export function findStandardPack(hours: number): FlexiDesignStandardPack | undefined {
  if (!Number.isFinite(hours)) return undefined
  return FLEXI_DESIGN_STANDARD_PACKS.find((pack) => pack.hours === hours)
}

export function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function standardPackHint(pack: FlexiDesignStandardPack): string {
  const price = formatGbp(pack.valueGbp)
  if (pack.discountPercent === 0) return `${price} standard pack`
  return `${price} (${pack.discountPercent}% off list)`
}
