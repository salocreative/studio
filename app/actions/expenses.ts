'use server'

import { checkIsAdmin } from '@/app/actions/auth'
import {
  VENDOR_MODES,
  type ExpenseCapture,
  type ExpenseCaptureStatus,
  type VendorMode,
  type VendorRule,
  type VendorRuleInput,
} from '@/lib/expenses/types'
import { gmailQueryForVendor, vendorKeyFromName } from '@/lib/expenses/vendor-query'
import { roundGbp, toGbpNumber } from '@/lib/billing/invoices'
import { createClient } from '@/lib/supabase/server'
import {
  attachFileToXeroBill,
  createXeroBill,
  downloadCaptureFile,
  getXeroBillSetup,
  type XeroAccountOption,
  type XeroTrackingCategory,
} from '@/lib/xero/bills'

interface RuleRow {
  vendor_key: string
  default_account_code: string | null
  default_tracking_option_id: string | null
  xero_contact_id: string | null
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const message = error.message ?? ''
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  )
}

const MIGRATION_ERROR =
  'Expense tables are not in the database yet. Apply migration 080_expense_captures.sql.'

async function requireAdminClient() {
  const { isAdmin } = await checkIsAdmin()
  if (!isAdmin) return { error: 'Unauthorised: admin access required' as const, supabase: null }
  return { error: null, supabase: await createClient() }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function mapVendor(row: Record<string, unknown>): VendorRule {
  const mode = String(row.mode || 'attachment')
  return {
    id: String(row.id),
    vendor_key: String(row.vendor_key),
    vendor_name: String(row.vendor_name),
    sender_domains: asStringArray(row.sender_domains),
    subject_keywords: asStringArray(row.subject_keywords),
    raw_query_override: typeof row.raw_query_override === 'string' ? row.raw_query_override : null,
    mode: (VENDOR_MODES as readonly string[]).includes(mode) ? (mode as VendorMode) : 'attachment',
    link_domain_hint: typeof row.link_domain_hint === 'string' ? row.link_domain_hint : null,
    link_fallback: row.link_fallback === true,
    folder_name: typeof row.folder_name === 'string' ? row.folder_name : null,
    is_capture_active: row.is_capture_active !== false,
    xero_contact_id: typeof row.xero_contact_id === 'string' ? row.xero_contact_id : null,
    default_account_code: typeof row.default_account_code === 'string' ? row.default_account_code : null,
    default_tracking_category_id:
      typeof row.default_tracking_category_id === 'string' ? row.default_tracking_category_id : null,
    default_tracking_option_id:
      typeof row.default_tracking_option_id === 'string' ? row.default_tracking_option_id : null,
  }
}

export async function getExpensesPage() {
  const auth = await requireAdminClient()
  if (!auth.supabase) return { error: auth.error }

  const { data, error } = await auth.supabase
    .from('expense_captures')
    .select(
      'id, vendor_key, vendor_name, email_date, invoice_date, amount, currency, file_url, file_type, source_mode, status, chosen_account_code, chosen_tracking_option_id, xero_bill_id, notes'
    )
    .order('email_date', { ascending: false, nullsFirst: false })
    .limit(500)

  if (error) {
    if (isMissingTable(error)) return { error: MIGRATION_ERROR }
    return { error: error.message }
  }

  const { data: rules, error: rulesError } = await auth.supabase
    .from('vendor_rules')
    .select('vendor_key, default_account_code, default_tracking_option_id, xero_contact_id, vendor_name, id, sender_domains, subject_keywords, raw_query_override, mode, link_domain_hint, link_fallback, folder_name, is_capture_active, default_tracking_category_id')
    .order('vendor_name')

  if (rulesError) {
    if (isMissingTable(rulesError)) return { error: MIGRATION_ERROR }
    return { error: rulesError.message }
  }

  const ruleByKey = new Map<string, RuleRow>()
  const vendorRules = ((rules || []) as Record<string, unknown>[]).map((row) => {
    const mapped = mapVendor(row)
    ruleByKey.set(mapped.vendor_key, {
      vendor_key: mapped.vendor_key,
      default_account_code: mapped.default_account_code,
      default_tracking_option_id: mapped.default_tracking_option_id,
      xero_contact_id: mapped.xero_contact_id,
    })
    return mapped
  })

  const rows = (data || []) as Record<string, unknown>[]
  const failedIds = rows
    .filter((row) => row.status === 'push_failed')
    .map((row) => String(row.id))
  const pushErrors = new Map<string, string>()
  if (failedIds.length > 0) {
    const { data: logs } = await auth.supabase
      .from('xero_push_log')
      .select('capture_id, error_message, attempted_at, result')
      .in('capture_id', failedIds)
      .eq('result', 'error')
      .order('attempted_at', { ascending: false })
    for (const log of (logs || []) as Array<{ capture_id: string; error_message: string | null }>) {
      if (!pushErrors.has(log.capture_id) && log.error_message) {
        pushErrors.set(log.capture_id, log.error_message)
      }
    }
  }

  const lastAmount = new Map<string, number>()
  for (const row of rows) {
    if (row.status !== 'pushed') continue
    const key = String(row.vendor_key)
    if (lastAmount.has(key) || row.amount == null) continue
    lastAmount.set(key, roundGbp(toGbpNumber(row.amount)))
  }

  const captures: ExpenseCapture[] = rows.map((row) => {
    const rule = ruleByKey.get(String(row.vendor_key))
    const amount = row.amount == null ? null : roundGbp(toGbpNumber(row.amount))
    const status = String(row.status) as ExpenseCaptureStatus
    return {
      id: String(row.id),
      vendor_key: String(row.vendor_key),
      vendor_name: String(row.vendor_name),
      email_date: typeof row.email_date === 'string' ? row.email_date : null,
      invoice_date: typeof row.invoice_date === 'string' ? row.invoice_date : null,
      amount,
      currency: typeof row.currency === 'string' ? row.currency : 'GBP',
      file_url: String(row.file_url),
      file_type: row.file_type === 'html' ? 'html' : 'pdf',
      source_mode: (VENDOR_MODES as readonly string[]).includes(String(row.source_mode))
        ? (String(row.source_mode) as VendorMode)
        : 'attachment',
      status,
      suggested_account_code: rule?.default_account_code ?? null,
      account_code:
        (typeof row.chosen_account_code === 'string' ? row.chosen_account_code : null) ||
        rule?.default_account_code ||
        null,
      suggested_tracking_option_id: rule?.default_tracking_option_id ?? null,
      tracking_option_id:
        (typeof row.chosen_tracking_option_id === 'string' ? row.chosen_tracking_option_id : null) ||
        rule?.default_tracking_option_id ||
        null,
      xero_contact_id: rule?.xero_contact_id ?? null,
      xero_bill_id: typeof row.xero_bill_id === 'string' ? row.xero_bill_id : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
      push_error: pushErrors.get(String(row.id)) ?? null,
      last_approved_amount: lastAmount.get(String(row.vendor_key)) ?? null,
    }
  })

  const setup = await getXeroBillSetup()
  const xero: {
    connected: boolean
    accounts: XeroAccountOption[]
    tracking: XeroTrackingCategory[]
    error: string | null
  } = 'error' in setup
    ? { connected: false, accounts: [], tracking: [], error: setup.error }
    : {
        connected: setup.setup.connected,
        accounts: setup.setup.accounts,
        tracking: setup.setup.tracking,
        error: setup.setup.connected ? null : 'Xero is not connected. Connect it in Settings before pushing bills.',
      }

  return { success: true as const, captures, vendorRules, xero }
}

function cleanList(values: string[]): string[] | null {
  const cleaned = values.map((value) => value.trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : null
}

export async function saveVendorRule(input: VendorRuleInput & { id?: string }) {
  const auth = await requireAdminClient()
  if (!auth.supabase) return { error: auth.error }

  const vendorName = input.vendor_name.trim()
  if (!vendorName) return { error: 'Vendor name is required.' }
  if (!(VENDOR_MODES as readonly string[]).includes(input.mode)) return { error: 'Choose a capture mode.' }

  const query = gmailQueryForVendor({
    raw_query_override: input.raw_query_override,
    sender_domains: input.sender_domains,
    subject_keywords: input.subject_keywords,
  })
  if (!query) {
    return { error: 'Add a sender domain, a subject keyword, or a Gmail search override.' }
  }

  const row = {
    vendor_name: vendorName,
    sender_domains: cleanList(input.sender_domains),
    subject_keywords: cleanList(input.subject_keywords),
    raw_query_override: input.raw_query_override?.trim() || null,
    mode: input.mode,
    link_domain_hint: input.link_domain_hint?.trim() || null,
    link_fallback: input.link_fallback,
    folder_name: input.folder_name?.trim() || null,
    is_capture_active: input.is_capture_active,
    xero_contact_id: input.xero_contact_id?.trim() || null,
    default_account_code: input.default_account_code?.trim() || null,
    default_tracking_category_id: input.default_tracking_category_id?.trim() || null,
    default_tracking_option_id: input.default_tracking_option_id?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  if (input.id) {
    const { error } = await auth.supabase.from('vendor_rules').update(row).eq('id', input.id)
    if (error) return { error: error.message }
    return { success: true as const }
  }

  let vendorKey = vendorKeyFromName(vendorName)
  if (!vendorKey) return { error: 'Vendor name needs at least one letter or number.' }
  const { data: existing } = await auth.supabase
    .from('vendor_rules')
    .select('vendor_key')
    .like('vendor_key', `${vendorKey}%`)
  const taken = new Set(((existing || []) as Array<{ vendor_key: string }>).map((item) => item.vendor_key))
  if (taken.has(vendorKey)) {
    let suffix = 2
    while (taken.has(`${vendorKey}_${suffix}`)) suffix += 1
    vendorKey = `${vendorKey}_${suffix}`.slice(0, 48)
  }

  const { error } = await auth.supabase.from('vendor_rules').insert({ ...row, vendor_key: vendorKey })
  if (error) {
    if (isMissingTable(error)) return { error: MIGRATION_ERROR }
    return { error: error.message }
  }
  return { success: true as const }
}

async function updateCapture(
  id: string,
  patch: Record<string, unknown>
): Promise<{ error: string } | { success: true }> {
  const auth = await requireAdminClient()
  if (!auth.supabase) return { error: auth.error || 'Unauthorised: admin access required' }
  const { error } = await auth.supabase
    .from('expense_captures')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }
  return { success: true }
}

export async function updateExpenseCapture(input: {
  id: string
  amount: number | null
  invoiceDate: string | null
  accountCode: string | null
  trackingOptionId: string | null
  notes: string | null
}) {
  return updateCapture(input.id, {
    amount: input.amount,
    invoice_date: input.invoiceDate,
    chosen_account_code: input.accountCode,
    chosen_tracking_option_id: input.trackingOptionId,
    notes: input.notes,
  })
}

export async function rejectExpenseCapture(id: string, notes: string | null) {
  return updateCapture(id, { status: 'rejected', notes })
}

export async function flagExpenseCapture(id: string, notes: string | null) {
  return updateCapture(id, { status: 'flagged_manual', notes })
}

function findTracking(
  categories: XeroTrackingCategory[],
  optionId: string | null
): { categoryId: string; categoryName: string; optionId: string; optionName: string } | null {
  if (!optionId) return null
  for (const category of categories) {
    const option = category.options.find((item) => item.id === optionId)
    if (option) {
      return {
        categoryId: category.id,
        categoryName: category.name,
        optionId: option.id,
        optionName: option.name,
      }
    }
  }
  return null
}

export async function approveExpenseCapture(input: {
  id: string
  amount: number | null
  invoiceDate: string | null
  accountCode: string | null
  trackingOptionId: string | null
}) {
  const auth = await requireAdminClient()
  if (!auth.supabase) return { error: auth.error || 'Unauthorised: admin access required' }
  const supabase = auth.supabase

  const { data, error } = await supabase
    .from('expense_captures')
    .select(
      'id, vendor_key, vendor_name, email_date, file_url, file_type, status, xero_bill_id, currency'
    )
    .eq('id', input.id)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'That capture could not be found.' }
  if (data.status === 'pushed') return { error: 'This invoice has already been pushed to Xero.' }
  if (data.status === 'rejected') return { error: 'Rejected invoices are not pushed. Flag it again if it should be reviewed.' }

  const { data: rule, error: ruleError } = await supabase
    .from('vendor_rules')
    .select('xero_contact_id, default_tracking_category_id')
    .eq('vendor_key', data.vendor_key)
    .maybeSingle()
  if (ruleError) return { error: ruleError.message }

  const contactId = rule?.xero_contact_id?.trim() || ''
  const missing: string[] = []
  if (input.amount == null || input.amount <= 0) missing.push('amount')
  if (!input.invoiceDate) missing.push('invoice date')
  if (!input.accountCode) missing.push('account code')
  if (!contactId) missing.push('Xero contact on the vendor rule')
  if (missing.length > 0) {
    return { error: `Add ${missing.join(', ')} before pushing to Xero.` }
  }

  const amount = roundGbp(input.amount as number)
  const invoiceDate = input.invoiceDate as string
  const accountCode = input.accountCode as string

  const saved = await updateCapture(input.id, {
    amount,
    invoice_date: invoiceDate,
    chosen_account_code: accountCode,
    chosen_tracking_option_id: input.trackingOptionId,
    status: 'approved',
  })
  if ('error' in saved) return saved

  async function logPush(result: 'success' | 'error', xeroBillId: string | null, errorMessage: string | null) {
    await supabase.from('xero_push_log').insert({
      capture_id: input.id,
      result,
      xero_bill_id: xeroBillId,
      error_message: errorMessage,
    })
  }

  const setup = await getXeroBillSetup()
  if ('error' in setup) {
    await logPush('error', data.xero_bill_id, setup.error)
    await updateCapture(input.id, { status: 'push_failed' })
    return { error: setup.error }
  }
  if (!setup.setup.connected || !setup.setup.defaultTaxType) {
    const message = setup.setup.connected
      ? 'Xero has no purchase tax rate to put on the bill.'
      : 'Xero is not connected. Connect it in Settings.'
    await logPush('error', data.xero_bill_id, message)
    await updateCapture(input.id, { status: 'push_failed' })
    return { error: message }
  }

  let xeroBillId = typeof data.xero_bill_id === 'string' ? data.xero_bill_id : null
  if (!xeroBillId) {
    const created = await createXeroBill({
      contactId,
      description: `${data.vendor_name} invoice`,
      amount,
      invoiceDate,
      currency: typeof data.currency === 'string' ? data.currency : 'GBP',
      accountCode,
      taxType: setup.setup.defaultTaxType,
      tracking: findTracking(setup.setup.tracking, input.trackingOptionId),
    })
    if ('error' in created) {
      await logPush('error', null, created.error)
      await updateCapture(input.id, { status: 'push_failed' })
      return { error: created.error }
    }
    xeroBillId = created.xeroBillId
    await updateCapture(input.id, { xero_bill_id: xeroBillId })
  }

  const file = await downloadCaptureFile(String(data.file_url))
  if ('error' in file) {
    await logPush('error', xeroBillId, file.error)
    await updateCapture(input.id, { status: 'push_failed', xero_bill_id: xeroBillId })
    return { error: `The bill was created in Xero, but the document was not attached. ${file.error}` }
  }

  const extension = data.file_type === 'html' ? 'html' : 'pdf'
  const attached = await attachFileToXeroBill({
    xeroBillId,
    fileName: `${data.vendor_name} ${invoiceDate}.${extension}`,
    bytes: file.bytes,
    contentType: file.contentType,
  })
  if ('error' in attached) {
    await logPush('error', xeroBillId, attached.error)
    await updateCapture(input.id, { status: 'push_failed', xero_bill_id: xeroBillId })
    return { error: attached.error }
  }

  await logPush('success', xeroBillId, null)
  await updateCapture(input.id, {
    status: 'pushed',
    xero_bill_id: xeroBillId,
    xero_pushed_at: new Date().toISOString(),
  })
  return { success: true as const, xeroBillId }
}
