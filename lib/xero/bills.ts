import { roundGbp } from '@/lib/billing/invoices'
import { getXeroAccessContext } from '@/lib/xero/api'

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

const EXPENSE_ACCOUNT_TYPES = new Set([
  'EXPENSE',
  'DIRECTCOSTS',
  'OVERHEADS',
  'DEPRECIATN',
  'WAGESEXPENSE',
  'SUPERANNUATIONEXPENSE',
])

export interface XeroAccountOption {
  code: string
  name: string
}

export interface XeroContactOption {
  id: string
  name: string
}

export interface XeroTrackingOption {
  id: string
  name: string
}

export interface XeroTrackingCategory {
  id: string
  name: string
  options: XeroTrackingOption[]
}

export interface XeroBillSetup {
  connected: boolean
  accounts: XeroAccountOption[]
  tracking: XeroTrackingCategory[]
  contacts: XeroContactOption[]
  defaultTaxType: string | null
}

interface XeroAccess {
  accessToken: string
  tenantId: string
}

async function xeroFetch(access: XeroAccess, path: string, init?: RequestInit) {
  const response = await fetch(`${XERO_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      'Xero-tenant-id': access.tenantId,
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      data = { Message: text }
    }
  }
  if (!response.ok) {
    return { ok: false as const, error: formatXeroError(data, response.status) }
  }
  return { ok: true as const, data }
}

function formatXeroError(data: Record<string, unknown>, status: number): string {
  const elements = Array.isArray(data.Elements) ? data.Elements : []
  const messages: string[] = []
  for (const element of elements) {
    const errors = (element as { ValidationErrors?: Array<{ Message?: string }> }).ValidationErrors
    for (const error of errors || []) {
      if (error.Message) messages.push(error.Message)
    }
  }
  if (messages.length > 0) return messages.join(' ')
  if (typeof data.Message === 'string' && data.Message) return data.Message
  if (status === 401 || status === 403) return 'Xero refused the request. Reconnect Xero in Settings.'
  return 'Xero request failed'
}

async function listXeroContacts(access: XeroAccess): Promise<XeroContactOption[]> {
  const filters = ['ContactStatus=="ACTIVE"', null]
  for (const where of filters) {
    const contacts: XeroContactOption[] = []
    let rejected = false
    for (let page = 1; page <= 40; page += 1) {
      const params = new URLSearchParams({ page: String(page) })
      if (where) params.set('where', where)
      const result = await xeroFetch(access, `/Contacts?${params.toString()}`)
      if (!result.ok) {
        rejected = page === 1 && Boolean(where)
        break
      }
      const rows = (result.data.Contacts as Array<Record<string, unknown>>) || []
      for (const row of rows) {
        const status = String(row.ContactStatus || 'ACTIVE').toUpperCase()
        const id = typeof row.ContactID === 'string' ? row.ContactID : ''
        const name = typeof row.Name === 'string' ? row.Name.trim() : ''
        if (!id || !name || status !== 'ACTIVE') continue
        contacts.push({ id, name })
      }
      if (rows.length < 100) break
    }
    if (rejected) continue
    contacts.sort((left, right) => left.name.localeCompare(right.name))
    return contacts
  }
  return []
}

function pickExpenseTax(rates: Array<Record<string, unknown>>): string | null {
  const usable = rates.filter((rate) => {
    const status = String(rate.Status || '').toUpperCase()
    const taxType = typeof rate.TaxType === 'string' ? rate.TaxType : ''
    return status === 'ACTIVE' && Boolean(taxType) && rate.CanApplyToExpenses !== false
  })
  const named = usable.find((rate) => {
    const taxType = String(rate.TaxType)
    const name = String(rate.Name || '')
    const percent = typeof rate.DisplayTaxRate === 'number' ? rate.DisplayTaxRate : Number(rate.EffectiveRate || 0)
    return taxType === 'INPUT2' || Math.abs(percent - 20) < 0.01 || /20/.test(name)
  })
  const chosen = named || usable[0]
  return chosen && typeof chosen.TaxType === 'string' ? chosen.TaxType : null
}

export async function getXeroBillSetup(): Promise<{ error: string } | { success: true; setup: XeroBillSetup }> {
  const access = await getXeroAccessContext()
  if ('error' in access) {
    return {
      success: true,
      setup: { connected: false, accounts: [], tracking: [], contacts: [], defaultTaxType: null },
    }
  }

  try {
    const [accountsResult, taxResult, trackingResult, contacts] = await Promise.all([
      xeroFetch(access, '/Accounts'),
      xeroFetch(access, '/TaxRates'),
      xeroFetch(access, '/TrackingCategories'),
      listXeroContacts(access),
    ])
    if (!accountsResult.ok) return { error: accountsResult.error }
    if (!taxResult.ok) return { error: taxResult.error }

    const accounts = ((accountsResult.data.Accounts as Array<Record<string, unknown>>) || [])
      .filter((account) => {
        const status = String(account.Status || '').toUpperCase()
        const type = String(account.Type || '').toUpperCase()
        const code = typeof account.Code === 'string' ? account.Code : ''
        return status === 'ACTIVE' && Boolean(code) && EXPENSE_ACCOUNT_TYPES.has(type)
      })
      .map((account) => ({
        code: String(account.Code),
        name: String(account.Name || account.Code),
      }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))

    const tracking = trackingResult.ok
      ? ((trackingResult.data.TrackingCategories as Array<Record<string, unknown>>) || [])
          .filter((category) => String(category.Status || '').toUpperCase() === 'ACTIVE')
          .map((category) => ({
            id: String(category.TrackingCategoryID),
            name: String(category.Name || 'Tracking'),
            options: ((category.Options as Array<Record<string, unknown>>) || [])
              .filter((option) => String(option.Status || '').toUpperCase() === 'ACTIVE')
              .map((option) => ({
                id: String(option.TrackingOptionID),
                name: String(option.Name || option.TrackingOptionID),
              })),
          }))
          .filter((category) => category.id && category.options.length > 0)
      : []

    return {
      success: true,
      setup: {
        connected: true,
        accounts,
        tracking,
        contacts,
        defaultTaxType: pickExpenseTax((taxResult.data.TaxRates as Array<Record<string, unknown>>) || []),
      },
    }
  } catch (error) {
    console.error('Error loading Xero bill setup:', error)
    return { error: error instanceof Error ? error.message : 'Failed to load Xero accounts' }
  }
}

export async function createXeroBill(input: {
  contactId: string
  description: string
  amount: number
  invoiceDate: string
  currency: string
  accountCode: string
  taxType: string
  tracking?: { categoryId: string; categoryName: string; optionId: string; optionName: string } | null
}): Promise<{ error: string } | { success: true; xeroBillId: string }> {
  const access = await getXeroAccessContext()
  if ('error' in access) return { error: access.error }

  const line: Record<string, unknown> = {
    Description: input.description.slice(0, 4000),
    Quantity: 1,
    UnitAmount: roundGbp(input.amount),
    AccountCode: input.accountCode,
    TaxType: input.taxType,
  }
  if (input.tracking) {
    line.Tracking = [
      {
        TrackingCategoryID: input.tracking.categoryId,
        Name: input.tracking.categoryName,
        TrackingOptionID: input.tracking.optionId,
        Option: input.tracking.optionName,
      },
    ]
  }

  const invoice: Record<string, unknown> = {
    Type: 'ACCPAY',
    Contact: { ContactID: input.contactId },
    Date: input.invoiceDate,
    DueDate: input.invoiceDate,
    LineAmountTypes: 'Inclusive',
    Status: 'AUTHORISED',
    LineItems: [line],
  }
  if (input.currency && input.currency !== 'GBP') {
    invoice.CurrencyCode = input.currency
  }

  const created = await xeroFetch(access, '/Invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Invoices: [invoice] }),
  })
  if (!created.ok) return { error: created.error }

  const bill = ((created.data.Invoices as Array<Record<string, unknown>>) || [])[0]
  const xeroBillId = typeof bill?.InvoiceID === 'string' ? bill.InvoiceID : null
  if (!xeroBillId) return { error: 'Xero created the bill but did not return an id.' }
  return { success: true, xeroBillId }
}

function driveFileId(fileUrl: string): string | null {
  const fromPath = /\/d\/([^/]+)/.exec(fileUrl)?.[1]
  if (fromPath) return fromPath
  const fromQuery = /[?&]id=([^&]+)/.exec(fileUrl)?.[1]
  return fromQuery ? decodeURIComponent(fromQuery) : null
}

export async function downloadCaptureFile(
  fileUrl: string
): Promise<{ error: string } | { bytes: ArrayBuffer; contentType: string }> {
  const fileId = driveFileId(fileUrl)
  const url = fileId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}` : fileUrl
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) {
      return { error: 'Could not download the document from Drive.' }
    }
    const contentType = response.headers.get('content-type') || ''
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength < 100) {
      return { error: 'The downloaded document was empty.' }
    }
    if (contentType.includes('text/html') && fileId) {
      const head = new TextDecoder().decode(bytes.slice(0, 800)).toLowerCase()
      const interstitial =
        head.includes('accounts.google.com') ||
        head.includes('download-form') ||
        head.includes('virus scan')
      if (interstitial) {
        return {
          error:
            'Drive did not return the file. The filer needs to share each saved document as anyone with the link.',
        }
      }
    }
    return { bytes, contentType: contentType || 'application/octet-stream' }
  } catch (error) {
    console.error('Error downloading capture file:', error)
    return { error: 'Could not download the document from Drive.' }
  }
}

export async function attachFileToXeroBill(input: {
  xeroBillId: string
  fileName: string
  bytes: ArrayBuffer
  contentType: string
}): Promise<{ error: string } | { success: true }> {
  const access = await getXeroAccessContext()
  if ('error' in access) return { error: access.error }

  const safeName = input.fileName.replace(/[^\w.\- ()]+/g, '_') || 'invoice.pdf'
  const response = await fetch(
    `${XERO_API_BASE}/Invoices/${input.xeroBillId}/Attachments/${encodeURIComponent(safeName)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        'Xero-tenant-id': access.tenantId,
        Accept: 'application/json',
        'Content-Type': input.contentType.includes('pdf') ? 'application/pdf' : input.contentType,
      },
      body: input.bytes,
    }
  )
  if (!response.ok) {
    const text = await response.text()
    let message = 'Xero accepted the bill but rejected the attachment.'
    try {
      const data = JSON.parse(text) as Record<string, unknown>
      message = formatXeroError(data, response.status)
    } catch {
      if (text) message = text.slice(0, 300)
    }
    return { error: message }
  }
  return { success: true }
}
