export function isStuckMondayStatus(status: string | null | undefined): boolean {
  return /\bstuck\b/i.test(status ?? '')
}
