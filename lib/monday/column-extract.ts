/**
 * Extract typed values from Monday column payloads (raw API or synced monday_data).
 */

type RawColumnValue = { id: string; text?: string; value?: string; type?: string }

type MondayDataColumn = {
  text?: string | null
  value?: unknown
  type?: string
  label?: string
}

function parseMondayStatusLabel(
  text?: string | null,
  value?: unknown
): string | null {
  if (text?.trim()) return text.trim()

  if (value == null) return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed) as { label?: string }
      if (parsed?.label?.trim()) return parsed.label.trim()
    } catch {
      return trimmed
    }
    return trimmed
  }

  if (typeof value === 'object' && value !== null) {
    const label = (value as { label?: string }).label
    if (label?.trim()) return label.trim()
  }

  return null
}

function parseLikelihoodPercent(
  text?: string | null,
  value?: unknown
): number | null {
  const clamp = (n: number) => {
    if (isNaN(n)) return null
    return Math.min(100, Math.max(0, n))
  }

  if (value != null && value !== '') {
    if (typeof value === 'number') return clamp(value)
    if (typeof value === 'string') {
      const direct = parseFloat(value.replace(/%/g, '').trim())
      if (!isNaN(direct)) return clamp(direct)
      try {
        const parsed = JSON.parse(value) as { value?: number | string }
        if (parsed?.value != null) {
          const n = typeof parsed.value === 'number' ? parsed.value : parseFloat(String(parsed.value))
          if (!isNaN(n)) return clamp(n)
        }
      } catch {
        // fall through
      }
    }
    if (typeof value === 'object' && value !== null) {
      const inner = (value as { value?: number | string }).value
      if (inner != null) {
        const n = typeof inner === 'number' ? inner : parseFloat(String(inner))
        if (!isNaN(n)) return clamp(n)
      }
    }
  }

  if (text?.trim()) {
    const n = parseFloat(text.replace(/%/g, '').trim())
    if (!isNaN(n)) return clamp(n)
  }

  return null
}

export function extractMondayStatusFromRaw(
  columnValues: RawColumnValue[] | undefined,
  columnId: string | null | undefined
): string | null {
  if (!columnId || !columnValues?.length) return null
  const col = columnValues.find((cv) => cv.id === columnId)
  if (!col) return null
  let value: unknown = col.value
  if (typeof col.value === 'string' && col.value) {
    try {
      value = JSON.parse(col.value)
    } catch {
      value = col.value
    }
  }
  return parseMondayStatusLabel(col.text, value)
}

export function extractMondayStatusFromMondayData(
  mondayData: Record<string, MondayDataColumn> | null | undefined,
  columnId: string | null | undefined
): string | null {
  if (!columnId || !mondayData?.[columnId]) return null
  const col = mondayData[columnId]
  return parseMondayStatusLabel(col.text, col.value)
}

export function extractLikelihoodFromRaw(
  columnValues: RawColumnValue[] | undefined,
  columnId: string | null | undefined
): number | null {
  if (!columnId || !columnValues?.length) return null
  const col = columnValues.find((cv) => cv.id === columnId)
  if (!col) return null
  let value: unknown = col.value
  if (typeof col.value === 'string' && col.value) {
    try {
      value = JSON.parse(col.value)
    } catch {
      value = col.value
    }
  }
  return parseLikelihoodPercent(col.text, value)
}

export function extractLikelihoodFromMondayData(
  mondayData: Record<string, MondayDataColumn> | null | undefined,
  columnId: string | null | undefined
): number | null {
  if (!columnId || !mondayData?.[columnId]) return null
  const col = mondayData[columnId]
  return parseLikelihoodPercent(col.text, col.value)
}

export function forecastDateFromProject(row: {
  status: string
  completed_date: string | null
  due_date: string | null
}): string | null {
  if (row.status === 'locked') return row.completed_date
  return row.due_date ?? row.completed_date
}

export function weightedQuoteValue(
  quoteValue: number | null,
  likelihood: number | null,
  segment: 'lead' | 'active' | 'completed'
): number | null {
  if (quoteValue == null || isNaN(quoteValue)) return null
  if (segment !== 'lead' || likelihood == null || isNaN(likelihood)) return quoteValue
  return quoteValue * (likelihood / 100)
}
