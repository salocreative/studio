import { inflateRawSync, inflateSync } from 'zlib'
import { roundGbp } from '@/lib/billing/invoices'

export const EXPENSE_DOCUMENT_KINDS = ['invoice', 'statement', 'receipt', 'other'] as const
export type ExpenseDocumentKind = (typeof EXPENSE_DOCUMENT_KINDS)[number]

export const EXPENSE_DOCUMENT_KIND_LABELS: Record<ExpenseDocumentKind, string> = {
  invoice: 'Invoice',
  statement: 'Statement',
  receipt: 'Receipt',
  other: 'Document',
}

const MONEY = String.raw`£?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})`
const LABELED_AMOUNT = [
  new RegExp(
    String.raw`(?:amount\s+due|total\s+due|balance\s+due|invoice\s+total|total\s+amount|amount\s+gbp|total\s+gbp|grand\s+total)\s*[:\-]?\s*${MONEY}`,
    'i'
  ),
  new RegExp(String.raw`(?:^|\b)total\s*[:\-]?\s*${MONEY}`, 'i'),
]

export function inferExpenseDocumentKind(
  ...values: Array<string | null | undefined>
): ExpenseDocumentKind {
  const haystack = values.filter(Boolean).join(' ')
  if (/\bstatements?\b/i.test(haystack)) return 'statement'
  if (/\breceipts?\b/i.test(haystack)) return 'receipt'
  if (/\binvoices?\b/i.test(haystack)) return 'invoice'
  return 'other'
}

export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header)
  if (encoded?.[1]) {
    try {
      return cleanFileName(decodeURIComponent(encoded[1].trim().replace(/^["']|["']$/g, '')))
    } catch {
      // Fall through to the plain filename.
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header)
  if (quoted?.[1]) return cleanFileName(quoted[1])
  const plain = /filename=([^;]+)/i.exec(header)
  return plain?.[1] ? cleanFileName(plain[1].replace(/^["']|["']$/g, '')) : null
}

export function filenameFromDriveTitle(html: string | null | undefined): string | null {
  if (!html) return null
  const og = /property="og:title"\s+content="([^"]+)"/i.exec(html)?.[1]
  const title = /<title>([^<]+)<\/title>/i.exec(html)?.[1]
  const raw = decodeHtml(og || title || '')
  if (!raw) return null
  const withoutDrive = raw.replace(/\s+[-–—]\s+Google Drive\s*$/i, '').trim()
  return cleanFileName(withoutDrive)
}

export function cleanFileName(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value.replace(/[/\\?%*:|"<>]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned || cleaned === 'Google Drive') return null
  return cleaned.slice(0, 180)
}

export function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null
  const amount = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1_000_000) return null
  return roundGbp(amount)
}

export function extractAmountFromText(text: string | null | undefined): number | null {
  if (!text) return null
  const flattened = text.replace(/\s+/g, ' ')
  for (const pattern of LABELED_AMOUNT) {
    const match = pattern.exec(flattened)
    const amount = parseMoney(match?.[1])
    if (amount) return amount
  }

  const poundAmounts: number[] = []
  const pound = new RegExp(String.raw`£\s*${MONEY}`, 'gi')
  let match: RegExpExecArray | null
  while ((match = pound.exec(flattened))) {
    const amount = parseMoney(match[1])
    if (amount) poundAmounts.push(amount)
  }
  if (poundAmounts.length === 1) return poundAmounts[0]
  if (poundAmounts.length > 1) return Math.max(...poundAmounts)
  return null
}

export function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
}

export function extractPdfText(bytes: ArrayBuffer): string {
  const latin = Buffer.from(bytes).toString('latin1')
  const parts: string[] = []
  collectPdfStrings(latin, parts)

  const streamRe = /stream\r?\n([\s\S]*?)endstream/g
  let streamMatch: RegExpExecArray | null
  while ((streamMatch = streamRe.exec(latin))) {
    const payload = Buffer.from(streamMatch[1], 'latin1')
    for (const decoder of [tryInflate, tryInflateRaw]) {
      const inflated = decoder(payload)
      if (!inflated) continue
      const asLatin = inflated.toString('latin1')
      collectPdfStrings(asLatin, parts)
      const runs = asLatin.match(/[\x20-\x7E]{4,}/g)
      if (runs) parts.push(runs.join(' '))
      break
    }
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function collectPdfStrings(source: string, parts: string[]) {
  const stringRe = /\((?:\\.|[^\\)]){2,200}\)/g
  let match: RegExpExecArray | null
  while ((match = stringRe.exec(source))) {
    parts.push(unescapePdfString(match[0].slice(1, -1)))
  }
}

function unescapePdfString(value: string): string {
  return value
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\([()\\])/g, '$1')
}

function tryInflate(payload: Buffer): Buffer | null {
  try {
    return inflateSync(payload)
  } catch {
    return null
  }
}

function tryInflateRaw(payload: Buffer): Buffer | null {
  try {
    return inflateRawSync(payload)
  } catch {
    return null
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&pound;/gi, '£')
    .replace(/&#163;/g, '£')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
