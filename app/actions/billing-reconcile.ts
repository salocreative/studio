'use server'

import {
  attachLinkedXeroInvoice,
  createLinkedXeroInvoice,
  getBillingJobs,
  type BillingJob,
} from '@/app/actions/invoices'
import { createClient } from '@/lib/supabase/server'
import type { InvoiceStatus } from '@/lib/billing/invoices'
import {
  bestMatchesForInvoice,
  xeroStatusToStudio,
  type InvoiceJobMatch,
  type MatchConfidence,
} from '@/lib/billing/xero-match'
import { fetchXeroSalesInvoices, type XeroSalesInvoice } from '@/lib/xero/sales-invoices'
import {
  applyLinkedXeroInvoiceStatuses,
  recordXeroStatusSyncRun,
  getLatestXeroStatusSyncRun,
  type LinkedXeroStatusChange,
  type XeroStatusSyncRun,
} from '@/lib/billing/xero-status-sync'

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

function invoiceDateKey(invoice: XeroSalesInvoice): string {
  return invoice.invoice_date || invoice.due_date || ''
}

function sortInvoicesNewestFirst(invoices: XeroSalesInvoice[]): XeroSalesInvoice[] {
  return [...invoices].sort((a, b) => invoiceDateKey(b).localeCompare(invoiceDateKey(a)))
}

function sortSuggestionsNewestFirst(suggestions: ReconcileSuggestion[]): ReconcileSuggestion[] {
  return [...suggestions].sort((a, b) =>
    invoiceDateKey(b.invoice).localeCompare(invoiceDateKey(a.invoice))
  )
}

export interface ReconcileSuggestion {
  invoice: XeroSalesInvoice
  matches: InvoiceJobMatch[]
  confidence: MatchConfidence
}

export interface ReconcileResult {
  high: ReconcileSuggestion[]
  possible: ReconcileSuggestion[]
  unmatchedInvoices: XeroSalesInvoice[]
  unmatchedJobs: Array<{
    id: string
    name: string
    client_name: string | null
    quote_value: number | null
    unbilled: number
    status: BillingJob['status']
  }>
  alreadyLinked: number
  dismissed: number
  truncated: boolean
  tenantName: string | null
  statusUpdates: number
  updates: LinkedXeroStatusChange[]
  openJobs: Array<{
    id: string
    name: string
    client_name: string | null
    unbilled: number
    status: BillingJob['status']
    invoices: Array<{
      id: string
      label: string
      amount: number
      status: InvoiceStatus
      invoice_number: string | null
    }>
  }>
}

function jobsStillOpen(jobs: BillingJob[]) {
  return jobs.filter((job) => job.unbilled > 0.009)
}

function unlinkedStudioInvoices(job: BillingJob) {
  return job.invoices
    .filter((invoice) => !invoice.xero_invoice_id)
    .map((invoice) => ({
      id: invoice.id,
      label: invoice.label,
      amount: invoice.amount,
      status: invoice.effective_status,
      invoice_number: invoice.invoice_number,
    }))
}

function jobsForLinking(jobs: BillingJob[]) {
  return jobs.filter(
    (job) => job.unbilled > 0.009 || job.invoices.some((invoice) => !invoice.xero_invoice_id)
  )
}

function asSalesInvoice(invoice: XeroSalesInvoice): XeroSalesInvoice | null {
  if (!invoice?.xero_invoice_id) return null
  if (!Number.isFinite(invoice.amount) || invoice.amount <= 0) return null
  if (invoice.status !== 'PAID' && invoice.status !== 'AUTHORISED') return null
  return invoice
}

export async function getXeroReconcileSuggestions() {
  const jobsResult = await getBillingJobs()
  if (jobsResult.error || !jobsResult.jobs) {
    return { error: jobsResult.error || 'Failed to load jobs' }
  }

  const xeroResult = await fetchXeroSalesInvoices()
  if (xeroResult.error || !xeroResult.invoices) {
    return { error: xeroResult.error || 'Failed to fetch Xero invoices' }
  }

  const supabase = await createClient()
  let statusUpdates = 0
  let updates: LinkedXeroStatusChange[] = []
  const synced = await applyLinkedXeroInvoiceStatuses(supabase, xeroResult.invoices)
  if ('error' in synced) {
    console.error('Error refreshing linked Xero invoice statuses:', synced.error)
  } else {
    statusUpdates = synced.updated
    updates = synced.changes
    const {
      data: { user },
    } = await supabase.auth.getUser()
    await recordXeroStatusSyncRun(supabase, {
      source: 'reconcile',
      checked: synced.checked,
      changes: synced.changes,
      createdBy: user?.id,
    })
  }

  const linkedIds = new Set<string>()
  const dismissedIds = new Set<string>()
  const { data: linkedRows, error: linkedError } = await supabase
    .from('project_invoices')
    .select('xero_invoice_id')
    .not('xero_invoice_id', 'is', null)
  if (!linkedError) {
    for (const row of linkedRows || []) {
      if (row.xero_invoice_id) linkedIds.add(row.xero_invoice_id)
    }
  }
  const { data: dismissedRows, error: dismissedError } = await supabase
    .from('xero_invoice_dismissals')
    .select('xero_invoice_id')
  if (dismissedError) {
    if (!isMissingTableError(dismissedError)) {
      console.error('Error loading dismissed Xero invoices:', dismissedError)
    }
  } else {
    for (const row of dismissedRows || []) {
      if (row.xero_invoice_id) dismissedIds.add(row.xero_invoice_id)
    }
  }
  for (const job of jobsResult.jobs) {
    for (const invoice of job.invoices) {
      if (invoice.xero_invoice_id) linkedIds.add(invoice.xero_invoice_id)
    }
  }

  const openJobs = jobsStillOpen(jobsResult.jobs)
  const high: ReconcileSuggestion[] = []
  const possible: ReconcileSuggestion[] = []
  const unmatchedInvoices: XeroSalesInvoice[] = []
  let alreadyLinked = 0
  let dismissed = 0

  for (const invoice of xeroResult.invoices) {
    if (linkedIds.has(invoice.xero_invoice_id)) {
      alreadyLinked += 1
      continue
    }
    if (dismissedIds.has(invoice.xero_invoice_id)) {
      dismissed += 1
      continue
    }

    const matches = bestMatchesForInvoice(invoice, openJobs)
    if (matches.length === 0) {
      unmatchedInvoices.push(invoice)
      continue
    }

    const suggestion: ReconcileSuggestion = {
      invoice,
      matches,
      confidence: matches[0].confidence,
    }
    if (suggestion.confidence === 'high') high.push(suggestion)
    else possible.push(suggestion)
  }

  const matchedJobIds = new Set(
    [...high, ...possible].map((suggestion) => suggestion.matches[0]?.jobId).filter(Boolean)
  )

  const unmatchedJobs = openJobs
    .filter((job) => !matchedJobIds.has(job.id))
    .map((job) => ({
      id: job.id,
      name: job.name,
      client_name: job.client_name,
      quote_value: job.quote_value,
      unbilled: job.unbilled,
      status: job.status,
    }))

  return {
    success: true as const,
    result: {
      high: sortSuggestionsNewestFirst(high),
      possible: sortSuggestionsNewestFirst(possible),
      unmatchedInvoices: sortInvoicesNewestFirst(unmatchedInvoices),
      unmatchedJobs,
      alreadyLinked,
      dismissed,
      truncated: Boolean(xeroResult.truncated),
      tenantName: xeroResult.tenantName ?? null,
      statusUpdates,
      updates,
      openJobs: jobsForLinking(jobsResult.jobs).map((job) => ({
        id: job.id,
        name: job.name,
        client_name: job.client_name,
        unbilled: job.unbilled,
        status: job.status,
        invoices: unlinkedStudioInvoices(job),
      })),
    } satisfies ReconcileResult,
  }
}

export async function acceptXeroInvoiceMatch(projectId: string, invoice: XeroSalesInvoice) {
  const valid = asSalesInvoice(invoice)
  if (!valid) return { error: 'Invalid Xero invoice' }

  return createLinkedXeroInvoice(projectId, {
    xero_invoice_id: valid.xero_invoice_id,
    invoice_number: valid.invoice_number,
    reference: valid.reference,
    amount: valid.amount,
    status: xeroStatusToStudio(valid),
    invoice_date: valid.invoice_date,
    due_date: valid.due_date,
    paid_date: valid.paid_date,
  })
}

export async function acceptXeroInvoiceMatchToStudioInvoice(
  studioInvoiceId: string,
  invoice: XeroSalesInvoice
) {
  const valid = asSalesInvoice(invoice)
  if (!valid) return { error: 'Invalid Xero invoice' }

  return attachLinkedXeroInvoice(studioInvoiceId, {
    xero_invoice_id: valid.xero_invoice_id,
    invoice_number: valid.invoice_number,
    amount: valid.amount,
    status: xeroStatusToStudio(valid),
    invoice_date: valid.invoice_date,
    due_date: valid.due_date,
    paid_date: valid.paid_date,
  })
}

export async function acceptHighConfidenceXeroMatches(
  items: Array<{ projectId?: string; studioInvoiceId?: string; invoice: XeroSalesInvoice }>
) {
  let accepted = 0
  const errors: string[] = []

  for (const item of items) {
    const result = item.studioInvoiceId
      ? await acceptXeroInvoiceMatchToStudioInvoice(item.studioInvoiceId, item.invoice)
      : await acceptXeroInvoiceMatch(item.projectId || '', item.invoice)
    if (result.error) {
      errors.push(
        `${item.invoice.invoice_number || item.invoice.xero_invoice_id}: ${result.error}`
      )
    } else {
      accepted += 1
    }
  }

  return { success: true as const, accepted, errors }
}

export async function dismissXeroInvoices(xeroInvoiceIds: string[]) {
  const uniqueIds = Array.from(new Set(xeroInvoiceIds.filter(Boolean)))
  if (uniqueIds.length === 0) {
    return { error: 'Select at least one invoice to dismiss' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (profile?.role !== 'admin') {
    return { error: 'Unauthorised: admin access required' }
  }

  const { error } = await supabase.from('xero_invoice_dismissals').upsert(
    uniqueIds.map((xero_invoice_id) => ({
      xero_invoice_id,
      dismissed_by: user.id,
    })),
    { onConflict: 'xero_invoice_id' }
  )

  if (error) {
    if (isMissingTableError(error)) {
      return { error: 'Dismissals table is missing. Run migration 078_xero_invoice_dismissals.sql.' }
    }
    console.error('Error dismissing Xero invoices:', error)
    return { error: error.message || 'Failed to dismiss invoices' }
  }

  return { success: true as const, dismissed: uniqueIds.length }
}

export async function getLatestXeroInvoiceStatusSync() {
  const supabase = await createClient()
  const run = await getLatestXeroStatusSyncRun(supabase)
  return { success: true as const, run }
}

export type { LinkedXeroStatusChange, XeroStatusSyncRun }
