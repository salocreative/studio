import { getXeroAccessContext } from '@/lib/xero/api'
import { roundGbp, toGbpNumber } from '@/lib/billing/invoices'

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'
const PAGE_SIZE_HINT = 100
const MAX_PAGES = 40

export interface XeroSalesInvoice {
  xero_invoice_id: string
  invoice_number: string | null
  reference: string | null
  contact_name: string | null
  status: 'PAID' | 'AUTHORISED'
  amount: number
  invoice_date: string | null
  due_date: string | null
  paid_date: string | null
  description: string
}

function parseXeroDate(value: unknown): string | null {
  if (value == null || value === '') return null
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const ms = /\/Date\((-?\d+)/.exec(raw)
  if (ms) {
    const date = new Date(Number(ms[1]))
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  }
  return null
}

function mapInvoice(raw: Record<string, unknown>): XeroSalesInvoice | null {
  const id = typeof raw.InvoiceID === 'string' ? raw.InvoiceID : null
  if (!id) return null

  const status = String(raw.Status || '').toUpperCase()
  if (status !== 'PAID' && status !== 'AUTHORISED') return null

  const type = String(raw.Type || '').toUpperCase()
  if (type && type !== 'ACCREC') return null

  const amount = roundGbp(toGbpNumber(raw.SubTotal ?? raw.Total))
  if (amount <= 0) return null

  const contact = raw.Contact as { Name?: string } | null
  const lineItems = Array.isArray(raw.LineItems)
    ? (raw.LineItems as Array<{ Description?: string }>)
    : []
  const lineText = lineItems
    .map((line) => line.Description?.trim())
    .filter(Boolean)
    .join(' ')

  return {
    xero_invoice_id: id,
    invoice_number: typeof raw.InvoiceNumber === 'string' ? raw.InvoiceNumber : null,
    reference: typeof raw.Reference === 'string' ? raw.Reference : null,
    contact_name: contact?.Name?.trim() || null,
    status,
    amount,
    invoice_date: parseXeroDate(raw.DateString ?? raw.Date),
    due_date: parseXeroDate(raw.DueDateString ?? raw.DueDate),
    paid_date: parseXeroDate(raw.FullyPaidOnDate ?? raw.FullyPaidDate),
    description: lineText,
  }
}

export async function fetchXeroSalesInvoices(options?: { useAdmin?: boolean }) {
  const access = await getXeroAccessContext(options)
  if ('error' in access) {
    return { error: access.error }
  }

  const invoices: XeroSalesInvoice[] = []
  let truncated = false
  let useTypeFilter = true
  let useDateOrder = true

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        Statuses: 'AUTHORISED,PAID',
        page: String(page),
      })
      if (useTypeFilter) {
        params.set('where', 'Type=="ACCREC"')
      }
      if (useDateOrder) {
        params.set('order', 'Date DESC')
      }
      const response = await fetch(`${XERO_API_BASE}/Invoices?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          'Xero-tenant-id': access.tenantId,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Failed to fetch Xero sales invoices:', {
          status: response.status,
          error: errorText,
          page,
        })
        if (page === 1 && response.status === 400) {
          if (useTypeFilter) {
            useTypeFilter = false
            page = 0
            continue
          }
          if (useDateOrder) {
            useDateOrder = false
            page = 0
            continue
          }
        }
        if (page === 1) {
          return {
            error:
              response.status === 401 || response.status === 403
                ? 'Xero refused the request. Reconnect Xero in Settings.'
                : 'Failed to fetch invoices from Xero.',
          }
        }
        truncated = true
        break
      }

      const data = (await response.json()) as { Invoices?: Record<string, unknown>[] }
      const pageRows = data.Invoices || []
      for (const row of pageRows) {
        const mapped = mapInvoice(row)
        if (mapped) invoices.push(mapped)
      }

      if (pageRows.length < PAGE_SIZE_HINT) break
      if (page === MAX_PAGES) truncated = true
    }

    return {
      success: true as const,
      invoices,
      tenantName: access.tenantName,
      truncated,
    }
  } catch (error) {
    console.error('Error fetching Xero sales invoices:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch invoices from Xero.',
    }
  }
}
