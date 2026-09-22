import { roundGbp, type InvoiceStatus } from '@/lib/billing/invoices'
import type { XeroSalesInvoice } from '@/lib/xero/sales-invoices'

export type MatchConfidence = 'high' | 'possible'

export interface MatchJobInput {
  id: string
  name: string
  client_name: string | null
  agency: string | null
  quote_value: number | null
  unbilled: number
  status: 'active' | 'archived' | 'locked'
}

export interface InvoiceJobMatch {
  jobId: string
  jobName: string
  clientName: string | null
  agency: string | null
  quoteValue: number | null
  unbilled: number
  jobStatus: MatchJobInput['status']
  score: number
  confidence: MatchConfidence
  reasons: string[]
}

function normalize(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function namesRelated(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalize(a)
  const right = normalize(b)
  if (!left || !right) return false
  if (left === right) return true
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) {
    return true
  }
  return false
}

function amountsClose(a: number, b: number): boolean {
  if (b <= 0 || a <= 0) return false
  const diff = Math.abs(a - b)
  return diff <= 1 || diff / Math.max(a, b) <= 0.02
}

function nameOverlap(
  jobName: string,
  haystack: string
): 'strong' | 'weak' | null {
  const name = normalize(jobName)
  const text = normalize(haystack)
  if (name.length < 4 || !text) return null
  if (text.includes(name)) return 'strong'

  const tokens = name.split(' ').filter((token) => token.length >= 4)
  if (tokens.length === 0) return null
  const hits = tokens.filter((token) => text.includes(token))
  if (hits.length === tokens.length && tokens.length >= 2) return 'strong'
  if (hits.length >= Math.max(2, Math.ceil(tokens.length * 0.7))) return 'weak'
  if (hits.length === 1 && tokens.length === 1 && hits[0].length >= 6) return 'weak'
  return null
}

export function xeroStatusToStudio(invoice: XeroSalesInvoice): InvoiceStatus {
  if (invoice.status === 'PAID') return 'paid'
  return 'waiting_payment'
}

export function scoreInvoiceAgainstJob(
  invoice: XeroSalesInvoice,
  job: MatchJobInput
): Omit<InvoiceJobMatch, 'confidence'> & { confidence: MatchConfidence | null } {
  const reasons: string[] = []
  let score = 0

  const contactMatch =
    namesRelated(invoice.contact_name, job.client_name) ||
    namesRelated(invoice.contact_name, job.agency)
  if (contactMatch) {
    score += 4
    reasons.push('Contact matches client or agency')
  }

  let amountKind: 'exact' | 'unbilled' | 'half' | null = null
  if (job.quote_value != null && amountsClose(invoice.amount, job.quote_value)) {
    amountKind = 'exact'
  } else if (job.unbilled > 0 && amountsClose(invoice.amount, job.unbilled)) {
    amountKind = 'unbilled'
  } else if (job.quote_value != null && amountsClose(invoice.amount, roundGbp(job.quote_value / 2))) {
    amountKind = 'half'
  } else if (job.unbilled > 0 && amountsClose(invoice.amount, roundGbp(job.unbilled / 2))) {
    amountKind = 'half'
  }

  if (amountKind === 'exact') {
    score += 5
    reasons.push('Amount matches quote')
  } else if (amountKind === 'unbilled') {
    score += 5
    reasons.push('Amount matches unbilled remainder')
  } else if (amountKind === 'half') {
    score += 3
    reasons.push('Amount matches 50% of quote')
  }

  const haystack = [invoice.reference, invoice.invoice_number, invoice.description]
    .filter(Boolean)
    .join(' ')
  const nameKind = nameOverlap(job.name, haystack)
  if (nameKind === 'strong') {
    score += 5
    reasons.push('Job name found on the Xero invoice')
  } else if (nameKind === 'weak') {
    score += 2
    reasons.push('Part of the job name found on the Xero invoice')
  }

  const hasAmount = amountKind != null
  let confidence: MatchConfidence | null = null
  if (nameKind === 'strong' && hasAmount) {
    confidence = 'high'
  } else if (contactMatch && nameKind && hasAmount) {
    confidence = 'high'
  } else if (contactMatch && hasAmount) {
    confidence = 'possible'
  } else if (nameKind && hasAmount) {
    confidence = 'possible'
  } else if (nameKind === 'strong') {
    confidence = 'possible'
  }

  return {
    jobId: job.id,
    jobName: job.name,
    clientName: job.client_name,
    agency: job.agency,
    quoteValue: job.quote_value,
    unbilled: job.unbilled,
    jobStatus: job.status,
    score,
    confidence,
    reasons,
  }
}

export function bestMatchesForInvoice(
  invoice: XeroSalesInvoice,
  jobs: MatchJobInput[]
): InvoiceJobMatch[] {
  const ranked = jobs
    .map((job) => scoreInvoiceAgainstJob(invoice, job))
    .filter((match) => match.confidence)
    .sort((a, b) => b.score - a.score || a.jobName.localeCompare(b.jobName))

  const top = ranked[0]
  if (!top || !top.confidence) return []

  const second = ranked[1]
  const uniqueLead = !second || top.score >= second.score + 2
  const confidence: MatchConfidence =
    top.confidence === 'high' && uniqueLead ? 'high' : 'possible'

  return ranked.slice(0, 5).map((match, index) => ({
    ...match,
    confidence: index === 0 ? confidence : 'possible',
  })) as InvoiceJobMatch[]
}
