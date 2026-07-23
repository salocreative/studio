import { validateLineItemTimeline } from '@/lib/sow/calculations'

export const SOW_DELIVERABLES_CSV_HEADERS = [
  'title',
  'description',
  'timeline_start',
  'timeline_end',
  'quantity',
  'unit',
] as const

/** Human-readable schema for Claude / docs */
export const SOW_DELIVERABLES_CSV_SCHEMA = `CSV columns for SoW deliverables import:

title (required) — task name
description (optional) — multi-line text; wrap in double quotes if it contains commas or newlines
timeline_start (optional) — start date as YYYY-MM-DD
timeline_end (optional) — end date as YYYY-MM-DD
quantity (optional) — number of hours or days; default 0 (fill in Studio later if omitted)
unit (optional) — "hours" or "days"; default "hours"

Example:
title,description,timeline_start,timeline_end,quantity,unit
"Discovery workshop","Kick-off, stakeholder interviews, and success metrics",2026-08-04,2026-08-08,2,days
"UI design","Desktop and mobile screens for key flows",2026-08-11,2026-08-29,24,hours
"Development","Front-end build and CMS integration",2026-09-01,2026-10-10,10,days
`

export interface ParsedSowDeliverableRow {
  title: string
  description: string
  timeline_start: string
  timeline_end: string
  quantity: number
  is_days: boolean
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

/** Minimal RFC4180-style CSV parse (quoted fields, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    // Skip completely empty trailing rows
    if (row.length === 1 && row[0] === '' && rows.length > 0) {
      row = []
      return
    }
    rows.push(row)
    row = []
  }

  const input = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const next = input[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushField()
      pushRow()
    } else if (ch === '\r') {
      // ignore; handle \r\n via \n
    } else {
      field += ch
    }
  }

  if (field.length > 0 || row.length > 0) {
    pushField()
    pushRow()
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function parseDateCell(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return ''
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  // DD/MM/YYYY or MM/DD/YYYY — prefer ISO from Claude; reject ambiguous
  return null
}

export function parseSowDeliverablesCsv(text: string): {
  rows: ParsedSowDeliverableRow[]
  error?: string
  warnings: string[]
} {
  const warnings: string[] = []
  const table = parseCsv(text)
  if (table.length < 2) {
    return { rows: [], error: 'CSV needs a header row and at least one data row', warnings }
  }

  const headers = table[0].map(normalizeHeader)
  const titleIdx = headers.findIndex((h) => h === 'title' || h === 'task' || h === 'name')
  if (titleIdx < 0) {
    return {
      rows: [],
      error: 'Missing required column: title',
      warnings,
    }
  }

  const descriptionIdx = headers.findIndex((h) => h === 'description' || h === 'desc')
  const startIdx = headers.findIndex(
    (h) => h === 'timeline_start' || h === 'start' || h === 'start_date'
  )
  const endIdx = headers.findIndex((h) => h === 'timeline_end' || h === 'end' || h === 'end_date')
  const quantityIdx = headers.findIndex(
    (h) => h === 'quantity' || h === 'qty' || h === 'hours' || h === 'days'
  )
  const unitIdx = headers.findIndex((h) => h === 'unit' || h === 'units' || h === 'type')

  const rows: ParsedSowDeliverableRow[] = []

  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    const title = (cells[titleIdx] || '').trim()
    if (!title) {
      warnings.push(`Row ${i + 1}: skipped (empty title)`)
      continue
    }

    const description = descriptionIdx >= 0 ? (cells[descriptionIdx] || '').trim() : ''
    let timeline_start = ''
    let timeline_end = ''

    if (startIdx >= 0) {
      const parsed = parseDateCell(cells[startIdx] || '')
      if (parsed === null) {
        warnings.push(`Row ${i + 1}: invalid timeline_start (use YYYY-MM-DD)`)
      } else {
        timeline_start = parsed
      }
    }
    if (endIdx >= 0) {
      const parsed = parseDateCell(cells[endIdx] || '')
      if (parsed === null) {
        warnings.push(`Row ${i + 1}: invalid timeline_end (use YYYY-MM-DD)`)
      } else {
        timeline_end = parsed
      }
    }

    const timelineError = validateLineItemTimeline(timeline_start || null, timeline_end || null)
    if (timelineError) {
      warnings.push(`Row ${i + 1}: ${timelineError}`)
      timeline_start = ''
      timeline_end = ''
    }

    let is_days = false
    if (unitIdx >= 0) {
      const unit = (cells[unitIdx] || '').trim().toLowerCase()
      if (unit === 'days' || unit === 'day' || unit === 'd') is_days = true
      else if (unit === 'hours' || unit === 'hour' || unit === 'h' || unit === '') is_days = false
      else warnings.push(`Row ${i + 1}: unknown unit "${cells[unitIdx]}" (use hours or days)`)
    } else if (quantityIdx >= 0 && normalizeHeader(headers[quantityIdx]) === 'days') {
      is_days = true
    }

    let quantity = 0
    if (quantityIdx >= 0) {
      const raw = (cells[quantityIdx] || '').trim()
      if (raw) {
        const n = parseFloat(raw)
        if (!(n >= 0) || Number.isNaN(n)) {
          warnings.push(`Row ${i + 1}: invalid quantity`)
        } else {
          quantity = n
        }
      }
    }

    rows.push({
      title,
      description,
      timeline_start,
      timeline_end,
      quantity,
      is_days,
    })
  }

  if (rows.length === 0) {
    return { rows: [], error: 'No valid deliverable rows found', warnings }
  }

  return { rows, warnings }
}

export function buildSowDeliverablesTemplateCsv(): string {
  return [
    SOW_DELIVERABLES_CSV_HEADERS.join(','),
    '"Discovery workshop","Kick-off, stakeholder interviews, and success metrics",2026-08-04,2026-08-08,2,days',
    '"UI design","Desktop and mobile screens for key flows",2026-08-11,2026-08-29,24,hours',
  ].join('\n')
}
