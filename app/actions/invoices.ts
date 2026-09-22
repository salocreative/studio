'use server'

import { createClient } from '@/lib/supabase/server'
import { getMondayBoardConfig } from '@/lib/monday/board-helpers'
import {
  effectiveInvoiceStatus,
  isInvoiceStatus,
  londonToday,
  projectBillingRollup,
  roundGbp,
  toGbpNumber,
  INVOICE_STATUS_PRIORITY,
  type InvoiceStatus,
} from '@/lib/billing/invoices'
import { getMondayAccountSlug } from '@/lib/monday/account'
import { mondayPulseUrl } from '@/lib/monday/urls'
import { createXeroSalesInvoice, getXeroInvoiceSetup } from '@/lib/xero/invoicing'

export interface ProjectInvoice {
  id: string
  project_id: string
  label: string
  amount: number
  status: InvoiceStatus
  effective_status: InvoiceStatus
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  paid_date: string | null
  notes: string | null
  sort_order: number
  xero_invoice_id: string | null
  created_at: string
  updated_at: string
}

export interface BillingJob {
  id: string
  name: string
  client_name: string | null
  agency: string | null
  status: 'active' | 'archived' | 'locked'
  monday_item_id: string | null
  monday_board_id: string | null
  monday_url: string | null
  monday_status: string | null
  quote_value: number | null
  completed_date: string | null
  due_date: string | null
  invoice_count: number
  invoiced_total: number
  unbilled: number
  paid_total: number
  outstanding_total: number
  billing_status: InvoiceStatus
  invoices: ProjectInvoice[]
}

export interface ProjectInvoiceInput {
  label: string
  amount: number
  status: InvoiceStatus
  invoice_number?: string | null
  invoice_date?: string | null
  due_date?: string | null
  paid_date?: string | null
  notes?: string | null
}

export interface CreateInvoiceXeroOptions {
  accountCode: string
  taxType: string
}

const IN_FILTER_CHUNK_SIZE = 80
const PAGE_SIZE = 500

type QueryPageResult<T> = { data: T[] | null; error: { code?: string; message: string } | null }

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

async function fetchByIdChunks<T>(
  ids: string[],
  queryPage: (chunk: string[], from: number, to: number) => PromiseLike<QueryPageResult<T>>
): Promise<T[]> {
  const rows: T[] = []
  for (let i = 0; i < ids.length; i += IN_FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_FILTER_CHUNK_SIZE)
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await queryPage(chunk, from, from + PAGE_SIZE - 1)
      if (error) throw error
      const page = data ?? []
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  }
  return rows
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' as const, supabase: null, userId: null }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorised: admin access required' as const, supabase: null, userId: null }
  }

  return { supabase, error: null as null, userId: user.id }
}

function emptyDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function mapInvoiceRow(
  row: {
    id: string
    project_id: string
    label: string
    amount: unknown
    status: string
    invoice_number: string | null
    invoice_date: string | null
    due_date: string | null
    paid_date: string | null
    notes: string | null
    sort_order: number
    xero_invoice_id?: string | null
    created_at: string
    updated_at: string
  },
  today: string
): ProjectInvoice {
  const status = isInvoiceStatus(row.status) ? row.status : 'need_invoicing'
  return {
    id: row.id,
    project_id: row.project_id,
    label: row.label,
    amount: toGbpNumber(row.amount),
    status,
    effective_status: effectiveInvoiceStatus(status, row.due_date, today),
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    due_date: row.due_date,
    paid_date: row.paid_date,
    notes: row.notes,
    sort_order: row.sort_order,
    xero_invoice_id: row.xero_invoice_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function validateInvoiceInput(input: ProjectInvoiceInput): string | null {
  if (!input.label.trim()) return 'Label is required'
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return 'Amount must be greater than zero'
  }
  if (!isInvoiceStatus(input.status)) return 'Invalid invoice status'
  return null
}

function invoiceWritePayload(
  input: ProjectInvoiceInput,
  extras: {
    project_id?: string
    created_by?: string
    sort_order?: number
    xero_invoice_id?: string | null
  } = {}
) {
  const status = input.status
  const paidDate =
    status === 'paid' ? emptyDate(input.paid_date) || londonToday() : emptyDate(input.paid_date)
  const invoiceDate =
    status === 'waiting_payment' || status === 'overdue' || status === 'paid'
      ? emptyDate(input.invoice_date) || emptyDate(input.due_date)
      : emptyDate(input.invoice_date)

  return {
    ...extras,
    label: input.label.trim(),
    amount: roundGbp(input.amount),
    status,
    invoice_number: emptyDate(input.invoice_number),
    invoice_date: invoiceDate,
    due_date: emptyDate(input.due_date),
    paid_date: paidDate,
    notes: emptyDate(input.notes),
  }
}

function isSaloCreativeClient(clientName: string | null | undefined) {
  return clientName?.trim().toLowerCase() === 'salo creative'
}

function hasZeroQuoteValue(quoteValue: unknown): boolean {
  if (quoteValue == null || quoteValue === '') return false
  const amount = typeof quoteValue === 'number' ? quoteValue : parseFloat(String(quoteValue))
  return Number.isFinite(amount) && amount === 0
}

async function billingBoardIds() {
  const {
    mainBoardIds,
    completedBoardIds,
    flexiBoardIds,
    flexiCompletedBoardId,
  } = await getMondayBoardConfig()

  const flexiIds = new Set(flexiBoardIds)
  if (flexiCompletedBoardId) flexiIds.add(flexiCompletedBoardId)

  return [...mainBoardIds, ...completedBoardIds].filter((id) => !flexiIds.has(id))
}

/**
 * Active and completed Main-board jobs (Flexi-Design excluded) with invoice rollups.
 */
export async function getBillingJobs() {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  const supabase = auth.supabase
  const today = londonToday()

  try {
    const boardIds = await billingBoardIds()
    if (boardIds.length === 0) {
      return { success: true as const, jobs: [] as BillingJob[] }
    }

    const projects = await fetchByIdChunks<{
      id: string
      name: string
      client_name: string | null
      agency: string | null
      status: 'active' | 'archived' | 'locked'
      monday_item_id: string | null
      monday_board_id: string | null
      monday_status: string | null
      quote_value: number | string | null
      completed_date: string | null
      due_date: string | null
    }>(boardIds, (boardChunk, from, to) =>
      supabase
        .from('monday_projects')
        .select(
          'id, name, client_name, agency, status, monday_item_id, monday_board_id, monday_status, quote_value, completed_date, due_date'
        )
        .in('monday_board_id', boardChunk)
        .in('status', ['active', 'locked'])
        .order('name', { ascending: true })
        .range(from, to)
    )

    const billableProjects = projects.filter(
      (project) => !isSaloCreativeClient(project.client_name) && !hasZeroQuoteValue(project.quote_value)
    )

    if (billableProjects.length === 0) {
      return { success: true as const, jobs: [] as BillingJob[] }
    }

    let invoiceRows: Array<{
      id: string
      project_id: string
      label: string
      amount: unknown
      status: string
      invoice_number: string | null
      invoice_date: string | null
      due_date: string | null
      paid_date: string | null
      notes: string | null
      sort_order: number
      created_at: string
      updated_at: string
    }> = []

    try {
      invoiceRows = await fetchByIdChunks(billableProjects.map((p) => p.id), (idChunk, from, to) =>
        supabase
          .from('project_invoices')
          .select(
            'id, project_id, label, amount, status, invoice_number, invoice_date, due_date, paid_date, notes, sort_order, xero_invoice_id, created_at, updated_at'
          )
          .in('project_id', idChunk)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
          .range(from, to)
      )
    } catch (error) {
      if (!isMissingTableError(error as { code?: string; message?: string })) {
        throw error
      }
    }

    const invoicesByProject = new Map<string, ProjectInvoice[]>()
    for (const row of invoiceRows) {
      const invoice = mapInvoiceRow(row, today)
      const list = invoicesByProject.get(invoice.project_id) ?? []
      list.push(invoice)
      invoicesByProject.set(invoice.project_id, list)
    }

    const mondaySlug = await getMondayAccountSlug()
    const jobs: BillingJob[] = billableProjects.map((project) => {
      const invoices = invoicesByProject.get(project.id) ?? []
      const quoteValue =
        project.quote_value == null || project.quote_value === ''
          ? null
          : toGbpNumber(project.quote_value)
      const rollup = projectBillingRollup(quoteValue, invoices, today)

      return {
        id: project.id,
        name: project.name,
        client_name: project.client_name,
        agency: project.agency,
        status: project.status,
        monday_item_id: project.monday_item_id,
        monday_board_id: project.monday_board_id,
        monday_url:
          mondaySlug && project.monday_board_id && project.monday_item_id
            ? mondayPulseUrl(mondaySlug, project.monday_board_id, project.monday_item_id)
            : null,
        monday_status: project.monday_status ?? null,
        quote_value: quoteValue,
        completed_date: project.completed_date,
        due_date: project.due_date,
        invoice_count: invoices.length,
        invoiced_total: rollup.invoicedTotal,
        unbilled: rollup.unbilled,
        paid_total: rollup.paidTotal,
        outstanding_total: rollup.outstandingTotal,
        billing_status: rollup.billingStatus,
        invoices,
      }
    })

    jobs.sort((a, b) => {
      const statusDelta = INVOICE_STATUS_PRIORITY[a.billing_status] - INVOICE_STATUS_PRIORITY[b.billing_status]
      if (statusDelta !== 0) return statusDelta
      return a.name.localeCompare(b.name)
    })

    return { success: true as const, jobs }
  } catch (err) {
    console.error('Error fetching billing jobs:', err)
    return {
      error: err instanceof Error ? err.message : 'Failed to fetch billing jobs',
    }
  }
}

export async function getProjectInvoices(projectId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  const supabase = auth.supabase
  const today = londonToday()

  try {
    const { data: project, error: projectError } = await supabase
      .from('monday_projects')
      .select(
        'id, name, client_name, agency, status, monday_item_id, monday_board_id, monday_status, quote_value, completed_date, due_date'
      )
      .eq('id', projectId)
      .maybeSingle()

    if (projectError) throw projectError
    if (!project) return { error: 'Project not found' }

    let invoiceRows: Array<{
      id: string
      project_id: string
      label: string
      amount: unknown
      status: string
      invoice_number: string | null
      invoice_date: string | null
      due_date: string | null
      paid_date: string | null
      notes: string | null
      sort_order: number
      created_at: string
      updated_at: string
    }> = []

    const { data, error } = await supabase
      .from('project_invoices')
      .select(
        'id, project_id, label, amount, status, invoice_number, invoice_date, due_date, paid_date, notes, sort_order, xero_invoice_id, created_at, updated_at'
      )
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      if (!isMissingTableError(error)) throw error
    } else {
      invoiceRows = data ?? []
    }

    const invoices = invoiceRows.map((row) => mapInvoiceRow(row, today))
    const mondaySlug = await getMondayAccountSlug()
    const quoteValue =
      project.quote_value == null || project.quote_value === ''
        ? null
        : toGbpNumber(project.quote_value)
    const rollup = projectBillingRollup(quoteValue, invoices, today)

    return {
      success: true as const,
      job: {
        id: project.id,
        name: project.name,
        client_name: project.client_name,
        agency: project.agency,
        status: project.status as BillingJob['status'],
        monday_item_id: project.monday_item_id ?? null,
        monday_board_id: project.monday_board_id ?? null,
        monday_url:
          mondaySlug && project.monday_board_id && project.monday_item_id
            ? mondayPulseUrl(mondaySlug, project.monday_board_id, project.monday_item_id)
            : null,
        monday_status: project.monday_status ?? null,
        quote_value: quoteValue,
        completed_date: project.completed_date,
        due_date: project.due_date,
        invoice_count: invoices.length,
        invoiced_total: rollup.invoicedTotal,
        unbilled: rollup.unbilled,
        paid_total: rollup.paidTotal,
        outstanding_total: rollup.outstandingTotal,
        billing_status: rollup.billingStatus,
        invoices,
      } satisfies BillingJob,
    }
  } catch (err) {
    console.error('Error fetching project invoices:', err)
    return {
      error: err instanceof Error ? err.message : 'Failed to fetch project invoices',
    }
  }
}

export async function getXeroInvoiceOptions() {
  const auth = await requireAdmin()
  if (auth.error) {
    return { error: auth.error }
  }
  return getXeroInvoiceSetup()
}

export async function createProjectInvoice(
  projectId: string,
  input: ProjectInvoiceInput,
  xero?: CreateInvoiceXeroOptions | null
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  const validationError = validateInvoiceInput(input)
  if (validationError) return { error: validationError }

  try {
    let xeroInvoiceId: string | null = null
    let invoiceNumber = input.invoice_number ?? null
    let status = input.status
    let invoiceDate = emptyDate(input.invoice_date)
    const dueDate = emptyDate(input.due_date)

    if (xero) {
      if (!xero.accountCode.trim()) return { error: 'Choose a Xero account' }
      if (!xero.taxType.trim()) return { error: 'Choose a tax rate' }

      const { data: project, error: projectError } = await auth.supabase
        .from('monday_projects')
        .select('name, client_name, agency')
        .eq('id', projectId)
        .maybeSingle()

      if (projectError) throw projectError
      if (!project) return { error: 'Project not found' }

      invoiceDate = invoiceDate || londonToday()
      const xeroDueDate = dueDate || invoiceDate
      const contactNames = [project.client_name, project.agency].filter(
        (name): name is string => Boolean(name?.trim())
      )

      const created = await createXeroSalesInvoice({
        contactNames,
        reference: project.name,
        description: `${input.label.trim()} - ${project.name}`,
        amount: input.amount,
        invoiceDate,
        dueDate: xeroDueDate,
        accountCode: xero.accountCode.trim(),
        taxType: xero.taxType.trim(),
      })

      if ('error' in created) {
        return { error: created.error }
      }

      xeroInvoiceId = created.xeroInvoiceId
      invoiceNumber = created.invoiceNumber || invoiceNumber
      if (status === 'need_invoicing') status = 'waiting_payment'
    }

    const { data: last } = await auth.supabase
      .from('project_invoices')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await auth.supabase.from('project_invoices').insert(
      invoiceWritePayload(
        {
          ...input,
          status,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          due_date: xero ? dueDate || invoiceDate : dueDate,
        },
        {
          project_id: projectId,
          created_by: auth.userId ?? undefined,
          sort_order: (last?.sort_order ?? -1) + 1,
          xero_invoice_id: xeroInvoiceId,
        }
      )
    )

    if (error) {
      if (isMissingTableError(error)) {
        return { error: 'Invoices table is missing. Run migration 076_project_invoices.sql.' }
      }
      if (xeroInvoiceId) {
        return {
          error: `Raised in Xero${invoiceNumber ? ` as ${invoiceNumber}` : ''}, but Studio could not save it. Use Reconcile to link it.`,
        }
      }
      throw error
    }

    return { success: true as const, xeroInvoiceNumber: invoiceNumber }
  } catch (err) {
    console.error('Error creating invoice:', err)
    return { error: err instanceof Error ? err.message : 'Failed to create invoice' }
  }
}

export async function updateProjectInvoice(invoiceId: string, input: ProjectInvoiceInput) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  const validationError = validateInvoiceInput(input)
  if (validationError) return { error: validationError }

  try {
    const { error } = await auth.supabase
      .from('project_invoices')
      .update(invoiceWritePayload(input))
      .eq('id', invoiceId)

    if (error) {
      if (isMissingTableError(error)) {
        return { error: 'Invoices table is missing. Run migration 076_project_invoices.sql.' }
      }
      throw error
    }

    return { success: true as const }
  } catch (err) {
    console.error('Error updating invoice:', err)
    return { error: err instanceof Error ? err.message : 'Failed to update invoice' }
  }
}

export async function updateProjectInvoiceStatus(invoiceId: string, status: InvoiceStatus) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  if (!isInvoiceStatus(status)) return { error: 'Invalid invoice status' }

  try {
    const { data: existing, error: existingError } = await auth.supabase
      .from('project_invoices')
      .select('invoice_date, paid_date, due_date')
      .eq('id', invoiceId)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existing) return { error: 'Invoice not found' }

    const patch: {
      status: InvoiceStatus
      invoice_date?: string | null
      paid_date?: string | null
    } = { status }

    if (status === 'paid' && !existing.paid_date) {
      patch.paid_date = londonToday()
    }
    if (status !== 'paid') {
      patch.paid_date = null
    }
    if (
      (status === 'waiting_payment' || status === 'overdue' || status === 'paid') &&
      !existing.invoice_date
    ) {
      patch.invoice_date = londonToday()
    }

    const { error } = await auth.supabase.from('project_invoices').update(patch).eq('id', invoiceId)
    if (error) throw error

    return { success: true as const }
  } catch (err) {
    console.error('Error updating invoice status:', err)
    return { error: err instanceof Error ? err.message : 'Failed to update invoice status' }
  }
}

export async function deleteProjectInvoice(invoiceId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  try {
    const { error } = await auth.supabase.from('project_invoices').delete().eq('id', invoiceId)
    if (error) throw error
    return { success: true as const }
  } catch (err) {
    console.error('Error deleting invoice:', err)
    return { error: err instanceof Error ? err.message : 'Failed to delete invoice' }
  }
}

/**
 * Create two invoices for the remaining unbilled quote value (deposit + final).
 */
export async function splitRemainingFiftyFifty(projectId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  const result = await getProjectInvoices(projectId)
  if (result.error || !result.job) {
    return { error: result.error || 'Project not found' }
  }

  const remaining = result.job.unbilled
  if (remaining <= 0) {
    return { error: 'Nothing left to split. Add a quote value, or invoices that do not cover it yet.' }
  }

  const first = roundGbp(remaining / 2)
  const second = roundGbp(remaining - first)
  if (first <= 0 || second <= 0) {
    return { error: 'Remaining amount is too small to split' }
  }

  const nextOrder = result.job.invoices.reduce((max, invoice) => Math.max(max, invoice.sort_order), -1) + 1

  try {
    const { error } = await auth.supabase.from('project_invoices').insert([
      invoiceWritePayload(
        { label: '50% deposit', amount: first, status: 'need_invoicing' },
        { project_id: projectId, created_by: auth.userId ?? undefined, sort_order: nextOrder }
      ),
      invoiceWritePayload(
        { label: '50% on delivery', amount: second, status: 'need_invoicing' },
        { project_id: projectId, created_by: auth.userId ?? undefined, sort_order: nextOrder + 1 }
      ),
    ])

    if (error) {
      if (isMissingTableError(error)) {
        return { error: 'Invoices table is missing. Run migration 076_project_invoices.sql.' }
      }
      throw error
    }

    return { success: true as const }
  } catch (err) {
    console.error('Error splitting invoices:', err)
    return { error: err instanceof Error ? err.message : 'Failed to split remaining amount' }
  }
}

/**
 * Close out remaining quote value as a single paid invoice (historic Xero billing).
 */
export async function markQuoteAsPaid(projectId: string, paidDate?: string | null) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  const result = await getProjectInvoices(projectId)
  if (result.error || !result.job) {
    return { error: result.error || 'Project not found' }
  }

  const remaining = result.job.unbilled
  if (remaining <= 0) {
    return { error: 'Nothing left to mark as paid. Add a quote value first if this job has none.' }
  }

  const date = emptyDate(paidDate) || londonToday()
  const nextOrder = result.job.invoices.reduce((max, invoice) => Math.max(max, invoice.sort_order), -1) + 1

  try {
    const { error } = await auth.supabase.from('project_invoices').insert(
      invoiceWritePayload(
        {
          label: 'Quote marked paid',
          amount: remaining,
          status: 'paid',
          invoice_date: date,
          paid_date: date,
          notes: 'Closed out remaining quote value in Studio (already billed in Xero).',
        },
        { project_id: projectId, created_by: auth.userId ?? undefined, sort_order: nextOrder }
      )
    )

    if (error) {
      if (isMissingTableError(error)) {
        return { error: 'Invoices table is missing. Run migration 076_project_invoices.sql.' }
      }
      throw error
    }

    return { success: true as const, amount: remaining }
  } catch (err) {
    console.error('Error marking quote as paid:', err)
    return { error: err instanceof Error ? err.message : 'Failed to mark quote as paid' }
  }
}

export async function createLinkedXeroInvoice(
  projectId: string,
  input: {
    xero_invoice_id: string
    invoice_number: string | null
    reference: string | null
    amount: number
    status: InvoiceStatus
    invoice_date: string | null
    due_date: string | null
    paid_date: string | null
  }
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  if (!input.xero_invoice_id.trim()) return { error: 'Missing Xero invoice id' }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { error: 'Amount must be greater than zero' }
  }

  try {
    const { data: existing, error: existingError } = await auth.supabase
      .from('project_invoices')
      .select('id, project_id')
      .eq('xero_invoice_id', input.xero_invoice_id)
      .maybeSingle()

    if (existingError && !isMissingTableError(existingError)) {
      if (existingError.message?.includes('xero_invoice_id')) {
        return { error: 'Run migration 077_project_invoices_xero_id.sql first.' }
      }
      throw existingError
    }
    if (existing) {
      return { error: 'That Xero invoice is already linked to a job.' }
    }

    const { data: last } = await auth.supabase
      .from('project_invoices')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const label = input.invoice_number
      ? `Xero ${input.invoice_number}`
      : input.reference?.trim() || 'Xero invoice'

    const { error } = await auth.supabase.from('project_invoices').insert(
      invoiceWritePayload(
        {
          label,
          amount: input.amount,
          status: input.status,
          invoice_number: input.invoice_number,
          invoice_date: input.invoice_date,
          due_date: input.due_date,
          paid_date: input.paid_date,
        },
        {
          project_id: projectId,
          created_by: auth.userId ?? undefined,
          sort_order: (last?.sort_order ?? -1) + 1,
          xero_invoice_id: input.xero_invoice_id,
        }
      )
    )

    if (error) {
      if (error.message?.includes('xero_invoice_id')) {
        return { error: 'Run migration 077_project_invoices_xero_id.sql first.' }
      }
      if (isMissingTableError(error)) {
        return { error: 'Invoices table is missing. Run migration 076_project_invoices.sql.' }
      }
      throw error
    }

    return { success: true as const }
  } catch (err) {
    console.error('Error linking Xero invoice:', err)
    return { error: err instanceof Error ? err.message : 'Failed to link Xero invoice' }
  }
}

export async function attachLinkedXeroInvoice(
  studioInvoiceId: string,
  input: {
    xero_invoice_id: string
    invoice_number: string | null
    amount: number
    status: InvoiceStatus
    invoice_date: string | null
    due_date: string | null
    paid_date: string | null
  }
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) {
    return { error: auth.error }
  }

  if (!studioInvoiceId.trim()) return { error: 'Missing Studio invoice' }
  if (!input.xero_invoice_id.trim()) return { error: 'Missing Xero invoice id' }

  try {
    const { data: existing, error: existingError } = await auth.supabase
      .from('project_invoices')
      .select('id, xero_invoice_id, invoice_number, invoice_date, due_date, paid_date')
      .eq('id', studioInvoiceId)
      .maybeSingle()

    if (existingError) {
      if (isMissingTableError(existingError)) {
        return { error: 'Invoices table is missing. Run migration 076_project_invoices.sql.' }
      }
      if (existingError.message?.includes('xero_invoice_id')) {
        return { error: 'Run migration 077_project_invoices_xero_id.sql first.' }
      }
      throw existingError
    }
    if (!existing) return { error: 'Studio invoice not found' }
    if (existing.xero_invoice_id && existing.xero_invoice_id !== input.xero_invoice_id) {
      return { error: 'That Studio invoice is already linked to a different Xero invoice.' }
    }
    if (existing.xero_invoice_id === input.xero_invoice_id) {
      return { success: true as const }
    }

    const { data: clash, error: clashError } = await auth.supabase
      .from('project_invoices')
      .select('id')
      .eq('xero_invoice_id', input.xero_invoice_id)
      .maybeSingle()

    if (clashError && !isMissingTableError(clashError)) {
      if (clashError.message?.includes('xero_invoice_id')) {
        return { error: 'Run migration 077_project_invoices_xero_id.sql first.' }
      }
      throw clashError
    }
    if (clash) {
      return { error: 'That Xero invoice is already linked to a job.' }
    }

    const status = input.status
    const paidDate =
      status === 'paid'
        ? emptyDate(input.paid_date) || londonToday()
        : emptyDate(existing.paid_date)

    const { error } = await auth.supabase
      .from('project_invoices')
      .update({
        xero_invoice_id: input.xero_invoice_id,
        invoice_number: emptyDate(input.invoice_number) || existing.invoice_number,
        invoice_date: emptyDate(input.invoice_date) || existing.invoice_date,
        due_date: emptyDate(input.due_date) || existing.due_date,
        paid_date: paidDate,
        status,
      })
      .eq('id', studioInvoiceId)

    if (error) {
      if (error.message?.includes('xero_invoice_id')) {
        return { error: 'Run migration 077_project_invoices_xero_id.sql first.' }
      }
      if (isMissingTableError(error)) {
        return { error: 'Invoices table is missing. Run migration 076_project_invoices.sql.' }
      }
      throw error
    }

    return { success: true as const }
  } catch (err) {
    console.error('Error attaching Xero invoice:', err)
    return { error: err instanceof Error ? err.message : 'Failed to attach Xero invoice' }
  }
}
