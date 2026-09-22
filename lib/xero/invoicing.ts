import { getXeroAccessContext } from '@/lib/xero/api'
import { roundGbp } from '@/lib/billing/invoices'

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

export interface XeroAccountOption {
  code: string
  name: string
}

export interface XeroTaxRateOption {
  taxType: string
  name: string
  rate: number
}

export interface XeroInvoiceSetup {
  connected: boolean
  tenantName: string | null
  accounts: XeroAccountOption[]
  taxRates: XeroTaxRateOption[]
  defaultAccountCode: string | null
  defaultTaxType: string | null
}

interface XeroAccess {
  accessToken: string
  tenantId: string
  tenantName: string | null
}

async function xeroJson(
  access: XeroAccess,
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const response = await fetch(`${XERO_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      'Xero-tenant-id': access.tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
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
    return { ok: false, error: formatXeroError(data, response.status) }
  }

  return { ok: true, data }
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
  const message = typeof data.Message === 'string' ? data.Message : null
  if (message) return message
  if (status === 401 || status === 403) return 'Xero refused the request. Reconnect Xero in Settings.'
  return 'Xero request failed'
}

function pickDefaultAccount(accounts: XeroAccountOption[]): string | null {
  return (
    accounts.find((account) => account.code === '200')?.code ||
    accounts.find((account) => /sales/i.test(account.name))?.code ||
    accounts[0]?.code ||
    null
  )
}

function pickDefaultTax(rates: XeroTaxRateOption[]): string | null {
  return (
    rates.find((rate) => rate.taxType === 'OUTPUT2')?.taxType ||
    rates.find((rate) => Math.abs(rate.rate - 20) < 0.01)?.taxType ||
    rates.find((rate) => /20/.test(rate.name))?.taxType ||
    rates[0]?.taxType ||
    null
  )
}

export async function getXeroInvoiceSetup(): Promise<
  { error: string } | { success: true; setup: XeroInvoiceSetup }
> {
  const access = await getXeroAccessContext()
  if ('error' in access) {
    return {
      success: true,
      setup: {
        connected: false,
        tenantName: null,
        accounts: [],
        taxRates: [],
        defaultAccountCode: null,
        defaultTaxType: null,
      },
    }
  }

  try {
    const [accountsResult, taxResult] = await Promise.all([
      xeroJson(access, '/Accounts'),
      xeroJson(access, '/TaxRates'),
    ])

    if (!accountsResult.ok) return { error: accountsResult.error }
    if (!taxResult.ok) return { error: taxResult.error }

    const accounts = ((accountsResult.data.Accounts as Array<Record<string, unknown>>) || [])
      .filter((account) => {
        const status = String(account.Status || '').toUpperCase()
        const type = String(account.Type || '').toUpperCase()
        const accountClass = String(account.Class || '').toUpperCase()
        const code = typeof account.Code === 'string' ? account.Code : ''
        return (
          status === 'ACTIVE' &&
          Boolean(code) &&
          (type === 'REVENUE' || type === 'SALES' || accountClass === 'REVENUE')
        )
      })
      .map((account) => ({
        code: String(account.Code),
        name: String(account.Name || account.Code),
      }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))

    const taxRates = ((taxResult.data.TaxRates as Array<Record<string, unknown>>) || [])
      .filter((rate) => {
        const status = String(rate.Status || '').toUpperCase()
        const taxType = typeof rate.TaxType === 'string' ? rate.TaxType : ''
        const canApply = rate.CanApplyToRevenue !== false
        return status === 'ACTIVE' && Boolean(taxType) && canApply
      })
      .map((rate) => ({
        taxType: String(rate.TaxType),
        name: String(rate.Name || rate.TaxType),
        rate: typeof rate.DisplayTaxRate === 'number' ? rate.DisplayTaxRate : Number(rate.EffectiveRate || 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return {
      success: true,
      setup: {
        connected: true,
        tenantName: access.tenantName,
        accounts,
        taxRates,
        defaultAccountCode: pickDefaultAccount(accounts),
        defaultTaxType: pickDefaultTax(taxRates),
      },
    }
  } catch (error) {
    console.error('Error loading Xero invoice setup:', error)
    return { error: error instanceof Error ? error.message : 'Failed to load Xero accounts' }
  }
}

async function findOrCreateContact(
  access: XeroAccess,
  names: string[]
): Promise<{ contactId: string } | { error: string }> {
  const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
  if (uniqueNames.length === 0) {
    return { error: 'This job has no client name, so it cannot be invoiced in Xero.' }
  }

  for (const name of uniqueNames) {
    const search = await xeroJson(access, `/Contacts?searchTerm=${encodeURIComponent(name)}`)
    if (!search.ok) return { error: search.error }
    const contacts = (search.data.Contacts as Array<Record<string, unknown>>) || []
    const match =
      contacts.find((contact) => String(contact.Name || '').trim().toLowerCase() === name.toLowerCase()) ||
      contacts.find((contact) => contact.IsCustomer === true) ||
      contacts[0]
    if (match?.ContactID) {
      return { contactId: String(match.ContactID) }
    }
  }

  const created = await xeroJson(access, '/Contacts', {
    method: 'POST',
    body: JSON.stringify({
      Contacts: [
        {
          Name: uniqueNames[0],
          IsCustomer: true,
        },
      ],
    }),
  })
  if (!created.ok) return { error: created.error }
  const contact = ((created.data.Contacts as Array<Record<string, unknown>>) || [])[0]
  if (!contact?.ContactID) {
    return { error: 'Xero did not return a contact id.' }
  }
  return { contactId: String(contact.ContactID) }
}

export async function createXeroSalesInvoice(input: {
  contactNames: string[]
  reference: string
  description: string
  amount: number
  invoiceDate: string
  dueDate: string
  accountCode: string
  taxType: string
}): Promise<
  | { error: string }
  | { success: true; xeroInvoiceId: string; invoiceNumber: string | null }
> {
  const access = await getXeroAccessContext()
  if ('error' in access) {
    return { error: access.error }
  }

  const contact = await findOrCreateContact(access, input.contactNames)
  if ('error' in contact) return contact

  const created = await xeroJson(access, '/Invoices', {
    method: 'POST',
    body: JSON.stringify({
      Invoices: [
        {
          Type: 'ACCREC',
          Contact: { ContactID: contact.contactId },
          Date: input.invoiceDate,
          DueDate: input.dueDate,
          LineAmountTypes: 'Exclusive',
          Reference: input.reference.slice(0, 255),
          Status: 'AUTHORISED',
          LineItems: [
            {
              Description: input.description.slice(0, 4000),
              Quantity: 1,
              UnitAmount: roundGbp(input.amount),
              AccountCode: input.accountCode,
              TaxType: input.taxType,
            },
          ],
        },
      ],
    }),
  })

  if (!created.ok) return { error: created.error }

  const invoice = ((created.data.Invoices as Array<Record<string, unknown>>) || [])[0]
  const xeroInvoiceId = typeof invoice?.InvoiceID === 'string' ? invoice.InvoiceID : null
  if (!xeroInvoiceId) {
    return { error: 'Xero created the invoice but did not return an id.' }
  }

  return {
    success: true,
    xeroInvoiceId,
    invoiceNumber: typeof invoice.InvoiceNumber === 'string' ? invoice.InvoiceNumber : null,
  }
}
