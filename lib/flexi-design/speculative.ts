/**
 * Flexi projects marked Speculative in Monday should stay visible
 * but must not count toward credit spend (quoted hours).
 */
export function isSpeculativeProject(p: { monday_status?: string | null }) {
  return (p.monday_status ?? '').toLowerCase().includes('speculative')
}

export function billableQuotedHours(p: {
  quoted_hours?: number | string | null
  monday_status?: string | null
}): number {
  if (isSpeculativeProject(p)) return 0
  return p.quoted_hours ? Number(p.quoted_hours) : 0
}
