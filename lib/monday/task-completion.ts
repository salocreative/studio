/**
 * Derive whether a Monday task reads as complete from its raw `monday_data` payload.
 *
 * Runs server-side so the raw column payload never has to be serialised to the browser —
 * `monday_data` holds every column Monday returns for the item and dwarfs the fields the
 * timesheet actually renders.
 *
 * Returns `null` when the task has no status column, so callers can fall back to
 * hours-based completion.
 */
const COMPLETED_PATTERN = /\b(done|complete|completed|closed)\b/i

type MondayColumn = {
  type?: unknown
  text?: unknown
  value?: unknown
}

export function getTaskCompletionFromStatus(
  mondayData: Record<string, unknown> | null | undefined
): boolean | null {
  if (!mondayData || typeof mondayData !== 'object') return null

  const statusColumns = Object.values(mondayData).filter(
    (column): column is MondayColumn =>
      typeof column === 'object' && column !== null && (column as MondayColumn).type === 'status'
  )

  if (statusColumns.length === 0) return null

  for (const column of statusColumns) {
    const textValue = typeof column.text === 'string' ? column.text : ''

    const parsedValue = column.value as { label?: unknown } | null | undefined
    const rawLabel = parsedValue?.label
    const labelFromValue =
      typeof rawLabel === 'string'
        ? rawLabel
        : typeof (rawLabel as { text?: unknown })?.text === 'string'
          ? ((rawLabel as { text: string }).text)
          : ''

    if (COMPLETED_PATTERN.test(textValue) || COMPLETED_PATTERN.test(labelFromValue)) {
      return true
    }
  }

  return false
}
