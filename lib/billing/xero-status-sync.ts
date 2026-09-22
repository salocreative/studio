import { createAdminClient } from '@/lib/supabase/server'
import { isInvoiceStatus, londonToday, type InvoiceStatus } from '@/lib/billing/invoices'
import { xeroStatusToStudio } from '@/lib/billing/xero-match'
import { fetchXeroSalesInvoices, type XeroSalesInvoice } from '@/lib/xero/sales-invoices'

const PAGE_SIZE = 500
const MAX_RECORDED_CHANGES = 50

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const msg = error.message ?? ''
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache')
  )
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 10) : null
}

type LinkedStudioInvoice = {
  id: string
  project_id: string
  label: string
  xero_invoice_id: string
  status: string
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  paid_date: string | null
}

type BillingDb = {
  from: (relation: string) => any
}

export interface LinkedXeroStatusChange {
  id: string
  projectId: string
  jobName: string | null
  invoiceNumber: string | null
  label: string
  fromStatus: InvoiceStatus
  toStatus: InvoiceStatus
  paidDate: string | null
}

export interface LinkedXeroStatusSyncResult {
  updated: number
  checked: number
  changes: LinkedXeroStatusChange[]
}

export interface XeroStatusSyncRun {
  source: 'reconcile' | 'cron'
  ranAt: string
  updated: number
  checked: number
  changes: LinkedXeroStatusChange[]
}

function asInvoiceStatus(value: string): InvoiceStatus {
  return isInvoiceStatus(value) ? value : 'waiting_payment'
}

function desiredPatch(existing: LinkedStudioInvoice, invoice: XeroSalesInvoice) {
  const status = xeroStatusToStudio(invoice)
  const next = {
    status,
    invoice_number: invoice.invoice_number?.trim() || existing.invoice_number,
    invoice_date: dateOnly(invoice.invoice_date) || dateOnly(existing.invoice_date),
    due_date: dateOnly(invoice.due_date) || dateOnly(existing.due_date),
    paid_date: status === 'paid' ? dateOnly(invoice.paid_date) || londonToday() : null,
  }

  const changed =
    existing.status !== next.status ||
    (existing.invoice_number || null) !== (next.invoice_number || null) ||
    dateOnly(existing.invoice_date) !== next.invoice_date ||
    dateOnly(existing.due_date) !== next.due_date ||
    dateOnly(existing.paid_date) !== next.paid_date

  return changed ? next : null
}

async function jobNamesById(supabase: BillingDb, projectIds: string[]) {
  const names = new Map<string, string>()
  const unique = Array.from(new Set(projectIds.filter(Boolean)))
  for (let i = 0; i < unique.length; i += PAGE_SIZE) {
    const chunk = unique.slice(i, i + PAGE_SIZE)
    const { data, error } = await supabase.from('monday_projects').select('id, name').in('id', chunk)
    if (error) {
      console.error('Error loading job names for Xero status sync:', error)
      continue
    }
    for (const row of data || []) {
      if (row.id) names.set(row.id, row.name || 'Untitled job')
    }
  }
  return names
}

export async function applyLinkedXeroInvoiceStatuses(
  supabase: BillingDb,
  invoices: XeroSalesInvoice[]
): Promise<LinkedXeroStatusSyncResult | { error: string }> {
  if (invoices.length === 0) {
    return { updated: 0, checked: 0, changes: [] }
  }

  const rows: LinkedStudioInvoice[] = []
  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('project_invoices')
        .select(
          'id, project_id, label, xero_invoice_id, status, invoice_number, invoice_date, due_date, paid_date'
        )
        .not('xero_invoice_id', 'is', null)
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        if (isMissingTableError(error) || error.message?.includes('xero_invoice_id')) {
          return { updated: 0, checked: 0, changes: [] }
        }
        return { error: error.message || 'Failed to load linked invoices' }
      }

      const page = data ?? []
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load linked invoices' }
  }

  const byXeroId = new Map<string, LinkedStudioInvoice>()
  for (const row of rows) {
    if (row.xero_invoice_id) byXeroId.set(row.xero_invoice_id, row)
  }

  const pending: LinkedXeroStatusChange[] = []
  let checked = 0

  for (const invoice of invoices) {
    const existing = byXeroId.get(invoice.xero_invoice_id)
    if (!existing) continue
    checked += 1
    const patch = desiredPatch(existing, invoice)
    if (!patch) continue

    const { error } = await supabase.from('project_invoices').update(patch).eq('id', existing.id)
    if (error) {
      console.error('Error updating linked Xero invoice status:', error)
      continue
    }

    pending.push({
      id: existing.id,
      projectId: existing.project_id,
      jobName: null,
      invoiceNumber: patch.invoice_number,
      label: existing.label,
      fromStatus: asInvoiceStatus(existing.status),
      toStatus: patch.status,
      paidDate: patch.paid_date,
    })
  }

  const names = await jobNamesById(
    supabase,
    pending.map((change) => change.projectId)
  )
  const changes = pending.map((change) => ({
    ...change,
    jobName: names.get(change.projectId) ?? null,
  }))

  return { updated: changes.length, checked, changes }
}

export async function recordXeroStatusSyncRun(
  supabase: BillingDb,
  input: {
    source: 'reconcile' | 'cron'
    checked: number
    changes: LinkedXeroStatusChange[]
    createdBy?: string | null
  }
) {
  const { error } = await supabase.from('xero_invoice_status_sync_runs').insert({
    source: input.source,
    updated_count: input.changes.length,
    checked_count: input.checked,
    changes: input.changes.slice(0, MAX_RECORDED_CHANGES),
    created_by: input.createdBy ?? null,
  })
  if (error && !isMissingTableError(error)) {
    console.error('Error recording Xero invoice status sync:', error)
  }
}

function mapSyncRun(row: {
  source: string
  ran_at: string
  updated_count: number
  checked_count: number
  changes: unknown
}): XeroStatusSyncRun {
  const changes = Array.isArray(row.changes) ? (row.changes as LinkedXeroStatusChange[]) : []
  return {
    source: row.source === 'cron' ? 'cron' : 'reconcile',
    ranAt: row.ran_at,
    updated: row.updated_count,
    checked: row.checked_count,
    changes,
  }
}

export async function getLatestXeroStatusSyncRun(
  supabase: BillingDb
): Promise<XeroStatusSyncRun | null> {
  const { data, error } = await supabase
    .from('xero_invoice_status_sync_runs')
    .select('source, ran_at, updated_count, checked_count, changes')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (!isMissingTableError(error)) {
      console.error('Error loading latest Xero invoice status sync:', error)
    }
    return null
  }
  if (!data) return null
  return mapSyncRun(data)
}

export async function refreshLinkedXeroInvoiceStatuses(): Promise<
  | { error: string }
  | {
      success: true
      updated: number
      checked: number
      fetched: number
      truncated: boolean
      changes: LinkedXeroStatusChange[]
    }
> {
  const xero = await fetchXeroSalesInvoices({ useAdmin: true })
  if (xero.error || !xero.invoices) {
    return { error: xero.error || 'Failed to fetch Xero invoices' }
  }

  const admin = await createAdminClient()
  if (!admin) {
    return { error: 'Service role is not configured' }
  }

  const applied = await applyLinkedXeroInvoiceStatuses(admin, xero.invoices)
  if ('error' in applied) {
    return { error: applied.error }
  }

  await recordXeroStatusSyncRun(admin, {
    source: 'cron',
    checked: applied.checked,
    changes: applied.changes,
  })

  return {
    success: true as const,
    updated: applied.updated,
    checked: applied.checked,
    fetched: xero.invoices.length,
    truncated: Boolean(xero.truncated),
    changes: applied.changes,
  }
}
