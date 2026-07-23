'use server'

import { createClient } from '@/lib/supabase/server'
import { getQuoteRateByType } from '@/app/actions/quote-rates'
import {
  computeLineItem,
  computeSowTotals,
  hourlyRateFromQuoteRate,
  validateLineItemTimeline,
  validatePaymentSchedule,
  type SowLineItemInput,
  type SowPaymentMilestoneInput,
} from '@/lib/sow/calculations'
import crypto from 'crypto'

function getActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export type SowStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'archived'

export interface SowLineItem {
  id: string
  sow_id: string
  title: string
  description: string | null
  quantity: number
  is_days: boolean
  hours: number
  unit_rate_gbp: number
  line_total_gbp: number
  sort_order: number
  timeline_start: string | null
  timeline_end: string | null
  created_at: string
}

export interface SowPaymentMilestone {
  id: string
  sow_id: string
  label: string
  percentage: number
  due_date: string | null
  sort_order: number
  created_at: string
}

export interface SowDocument {
  id: string
  title: string
  client_name: string
  agency_name: string | null
  customer_type: 'partner' | 'client'
  status: SowStatus
  include_vat: boolean
  show_quoted_hours: boolean
  show_payment_schedule: boolean
  start_date: string | null
  end_date: string | null
  day_rate_override_gbp: number | null
  base_day_rate_gbp: number
  hours_per_day: number
  currency: 'GBP' | 'USD'
  fx_rate: number
  subtotal_gbp: number
  vat_amount_gbp: number
  total_gbp: number
  total_hours: number
  notes: string | null
  approved_at: string | null
  approved_by_name: string | null
  approved_by_email: string | null
  rejected_at: string | null
  rejected_by_name: string | null
  rejection_notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  monday_project_id: string | null
  monday_item_id: string | null
  monday_board_id: string | null
  pushed_to_monday_at: string | null
  /** Latest active public share token, when one exists */
  active_share_token?: string | null
  line_items?: SowLineItem[]
  payment_milestones?: SowPaymentMilestone[]
}

export interface SowLinkedLead {
  name: string
  monday_status: string | null
  likelihood: number | null
}

export interface SowShareLink {
  id: string
  sow_id: string
  share_token: string
  created_at: string
  expires_at: string | null
  is_active: boolean
}

async function requireTeamMember() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, supabase: null, userId: null }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (
    !profile ||
    (profile.role !== 'admin' && profile.role !== 'designer' && profile.role !== 'manager')
  ) {
    return { error: 'Unauthorized' as const, supabase: null, userId: null }
  }

  return { supabase, userId: user.id, error: null as null }
}

async function getRatesForCustomerType(customerType: 'partner' | 'client'): Promise<
  { error: string } | { hourlyRate: number; hoursPerDay: number; dayRateGbp: number }
> {
  const rateResult = await getQuoteRateByType(customerType)
  if (rateResult.error || !rateResult.rate) {
    return { error: rateResult.error || 'Quote rates not configured. Set them in Settings.' }
  }
  const hoursPerDay = Number(rateResult.rate.hours_per_day)
  const dayRateGbp = Number(rateResult.rate.day_rate_gbp)
  const hourlyRate = hourlyRateFromQuoteRate(dayRateGbp, hoursPerDay)
  return { hourlyRate, hoursPerDay, dayRateGbp }
}

function normalizeDayRateOverride(value: number | null | undefined): number | null {
  if (value == null || value === undefined) return null
  const n = Number(value)
  if (!(n > 0)) return null
  return Math.round(n * 100) / 100
}

function normalizeHoursPerDay(
  value: number | null | undefined,
  fallback: number
): number {
  const n = Number(value)
  if (n > 0) return Math.round(n * 100) / 100
  return fallback > 0 ? fallback : 6
}

function normalizeCurrency(value: string | null | undefined): 'GBP' | 'USD' {
  return value === 'USD' ? 'USD' : 'GBP'
}

function normalizeFxRate(currency: 'GBP' | 'USD', value: number | null | undefined): number {
  if (currency === 'GBP') return 1
  const n = Number(value)
  if (!(n > 0)) return 1
  return Math.round(n * 1_000_000) / 1_000_000
}

function mapLineItems(
  items: SowLineItemInput[],
  hoursPerDay: number,
  hourlyRate: number
) {
  return items.map((item, index) => {
    const computed = computeLineItem(item, hoursPerDay, hourlyRate)
    return {
      title: computed.title.trim(),
      description: computed.description?.trim() || null,
      quantity: computed.quantity,
      is_days: computed.is_days,
      hours: computed.hours,
      unit_rate_gbp: computed.unit_rate_gbp,
      line_total_gbp: computed.line_total_gbp,
      timeline_start: computed.timeline_start || null,
      timeline_end: computed.timeline_end || null,
      sort_order: index,
    }
  })
}

function mapPaymentMilestones(milestones: SowPaymentMilestoneInput[], sowId: string) {
  return milestones.map((m, index) => ({
    sow_id: sowId,
    label: m.label.trim(),
    percentage: Number(m.percentage),
    due_date: m.due_date || null,
    sort_order: index,
  }))
}

export async function getSowAgencies() {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('monday_projects')
      .select('agency')
      .not('agency', 'is', null)
      .neq('agency', '')

    if (error) throw error

    const agencies = Array.from(
      new Set(
        (data || [])
          .map((p) => p.agency?.trim())
          .filter((name): name is string => !!name && name.toLowerCase() !== 'salo creative')
      )
    ).sort()

    return { success: true, agencies }
  } catch (error) {
    console.error('Error fetching SoW agencies:', error)
    return { error: getActionError(error, 'Failed to fetch agencies') }
  }
}

export async function getSowClients(agencyName?: string | null) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    let query = auth.supabase
      .from('monday_projects')
      .select('client_name')
      .not('client_name', 'is', null)
      .neq('client_name', '')

    if (agencyName?.trim()) {
      query = query.eq('agency', agencyName.trim())
    }

    const { data, error } = await query

    if (error) throw error

    const clients = Array.from(
      new Set((data || []).map((p) => p.client_name).filter(Boolean))
    ).sort() as string[]

    return { success: true, clients }
  } catch (error) {
    console.error('Error fetching SoW clients:', error)
    return { error: getActionError(error, 'Failed to fetch clients') }
  }
}

function validateSowInput(input: SowDocumentInput): string | null {
  if (!input.title.trim()) return 'Title is required'
  if (!input.client_name.trim()) return 'End client is required'
  if (!input.line_items.length) return 'Add at least one line item'
  if (input.customer_type === 'partner' && !input.agency_name?.trim()) {
    return 'Agency partner is required when using partner rates'
  }
  if (input.start_date && input.end_date && input.start_date > input.end_date) {
    return 'Project end date must be on or after the start date'
  }
  if (
    input.day_rate_override_gbp != null &&
    !(Number(input.day_rate_override_gbp) > 0)
  ) {
    return 'Quoted day rate must be greater than 0'
  }
  if (input.hours_per_day != null && !(Number(input.hours_per_day) > 0)) {
    return 'Hours per day must be greater than 0'
  }
  const currency = input.currency === 'USD' ? 'USD' : 'GBP'
  const fxRate = Number(input.fx_rate ?? 1)
  if (!(fxRate > 0)) return 'Exchange rate must be greater than 0'
  if (currency === 'GBP' && Math.abs(fxRate - 1) > 0.000001) {
    // allow slight drift but prefer normalizing on save
  }
  for (const item of input.line_items) {
    const timelineError = validateLineItemTimeline(item.timeline_start, item.timeline_end)
    if (timelineError) return `${item.title || 'Line item'}: ${timelineError}`
  }
  const scheduleError = validatePaymentSchedule(input.payment_milestones || [])
  if (scheduleError) return scheduleError
  return null
}

export async function getSowDocuments() {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('sow_documents')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) throw error

    const documents = (data || []) as SowDocument[]
    if (documents.length === 0) {
      return { success: true, documents }
    }

    const { data: shareLinks, error: linksError } = await auth.supabase
      .from('sow_share_links')
      .select('sow_id, share_token, created_at')
      .in(
        'sow_id',
        documents.map((doc) => doc.id)
      )
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (linksError) throw linksError

    const latestTokenBySow = new Map<string, string>()
    for (const link of shareLinks || []) {
      if (!latestTokenBySow.has(link.sow_id)) {
        latestTokenBySow.set(link.sow_id, link.share_token)
      }
    }

    return {
      success: true,
      documents: documents.map((doc) => ({
        ...doc,
        active_share_token: latestTokenBySow.get(doc.id) ?? null,
      })),
    }
  } catch (error) {
    console.error('Error fetching SoW documents:', error)
    return { error: getActionError(error, 'Failed to fetch statements of work') }
  }
}

export async function getSowDocument(id: string) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data: document, error: docError } = await auth.supabase
      .from('sow_documents')
      .select('*')
      .eq('id', id)
      .single()

    if (docError) throw docError

    const { data: lineItems, error: itemsError } = await auth.supabase
      .from('sow_line_items')
      .select('*')
      .eq('sow_id', id)
      .order('sort_order', { ascending: true })

    if (itemsError) throw itemsError

    const { data: paymentMilestones, error: milestonesError } = await auth.supabase
      .from('sow_payment_milestones')
      .select('*')
      .eq('sow_id', id)
      .order('sort_order', { ascending: true })

    if (milestonesError) throw milestonesError

    const { data: shareLinks, error: linksError } = await auth.supabase
      .from('sow_share_links')
      .select('*')
      .eq('sow_id', id)
      .order('created_at', { ascending: false })

    if (linksError) throw linksError

    let linkedLead: SowLinkedLead | null = null

    if (document.monday_project_id) {
      const { data: project } = await auth.supabase
        .from('monday_projects')
        .select('id, name, monday_status, likelihood')
        .eq('id', document.monday_project_id)
        .maybeSingle()

      if (project) {
        linkedLead = {
          name: project.name,
          monday_status: project.monday_status,
          likelihood: project.likelihood != null ? Number(project.likelihood) : null,
        }
      }
    } else if (document.monday_item_id) {
      const { data: project } = await auth.supabase
        .from('monday_projects')
        .select('id, name, monday_status, likelihood')
        .eq('monday_item_id', document.monday_item_id)
        .maybeSingle()

      if (project) {
        linkedLead = {
          name: project.name,
          monday_status: project.monday_status,
          likelihood: project.likelihood != null ? Number(project.likelihood) : null,
        }
        await auth.supabase
          .from('sow_documents')
          .update({ monday_project_id: project.id })
          .eq('id', id)
        document.monday_project_id = project.id
      }
    }

    return {
      success: true,
      document: {
        ...(document as SowDocument),
        line_items: (lineItems || []) as SowLineItem[],
        payment_milestones: (paymentMilestones || []) as SowPaymentMilestone[],
      },
      shareLinks: (shareLinks || []) as SowShareLink[],
      linkedLead,
    }
  } catch (error) {
    console.error('Error fetching SoW document:', error)
    return { error: getActionError(error, 'Failed to fetch statement of work') }
  }
}

export type SowDocumentInput = {
  title: string
  client_name: string
  agency_name?: string | null
  customer_type: 'partner' | 'client'
  include_vat: boolean
  show_quoted_hours?: boolean
  show_payment_schedule?: boolean
  start_date?: string | null
  end_date?: string | null
  day_rate_override_gbp?: number | null
  hours_per_day?: number
  currency?: 'GBP' | 'USD'
  fx_rate?: number
  notes?: string | null
  line_items: SowLineItemInput[]
  payment_milestones: SowPaymentMilestoneInput[]
  monday_project_id?: string | null
  push_to_monday?: boolean
}

export async function createSowDocument(input: SowDocumentInput) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase || !auth.userId) return { error: auth.error ?? 'Not authenticated' }

  const validationError = validateSowInput(input)
  if (validationError) return { error: validationError }

  const rates = await getRatesForCustomerType(input.customer_type)
  if ('error' in rates) return { error: rates.error }

  const hoursPerDay = normalizeHoursPerDay(input.hours_per_day, rates.hoursPerDay)
  const hourlyRate = hourlyRateFromQuoteRate(rates.dayRateGbp, hoursPerDay)
  const mappedItems = mapLineItems(input.line_items, hoursPerDay, hourlyRate)
  const totals = computeSowTotals(mappedItems, input.include_vat)
  const agencyName =
    input.customer_type === 'partner' ? input.agency_name?.trim() || null : null
  const dayRateOverride = normalizeDayRateOverride(input.day_rate_override_gbp)
  const currency = normalizeCurrency(input.currency)
  const fxRate = normalizeFxRate(currency, input.fx_rate)

  let mondayLink: {
    monday_project_id?: string | null
    monday_item_id?: string | null
    monday_board_id?: string | null
  } = {}

  if (input.monday_project_id) {
    const { data: project } = await auth.supabase
      .from('monday_projects')
      .select('id, monday_item_id, monday_board_id, status')
      .eq('id', input.monday_project_id)
      .eq('status', 'lead')
      .maybeSingle()

    if (project) {
      mondayLink = {
        monday_project_id: project.id,
        monday_item_id: project.monday_item_id,
        monday_board_id: project.monday_board_id,
      }
    }
  }

  try {
    const { data: document, error: docError } = await auth.supabase
      .from('sow_documents')
      .insert({
        title: input.title.trim(),
        client_name: input.client_name.trim(),
        agency_name: agencyName,
        customer_type: input.customer_type,
        include_vat: input.include_vat,
        show_quoted_hours: input.show_quoted_hours ?? false,
        show_payment_schedule: input.show_payment_schedule ?? true,
        start_date: input.start_date || null,
        end_date: input.end_date || null,
        day_rate_override_gbp: dayRateOverride,
        base_day_rate_gbp: rates.dayRateGbp,
        hours_per_day: hoursPerDay,
        currency,
        fx_rate: fxRate,
        notes: input.notes?.trim() || null,
        status: 'draft',
        created_by: auth.userId,
        ...totals,
        ...mondayLink,
      })
      .select()
      .single()

    if (docError) throw docError

    const rows = mappedItems.map((item) => ({ ...item, sow_id: document.id }))
    const { error: itemsError } = await auth.supabase.from('sow_line_items').insert(rows)
    if (itemsError) throw itemsError

    const milestoneRows = mapPaymentMilestones(input.payment_milestones, document.id)
    const { error: milestonesError } = await auth.supabase
      .from('sow_payment_milestones')
      .insert(milestoneRows)
    if (milestonesError) throw milestonesError

    let pushWarning: string | undefined
    if (input.push_to_monday && !mondayLink.monday_project_id) {
      const { pushSowToMonday } = await import('./sow-to-monday')
      const pushResult = await pushSowToMonday(document.id)
      if (pushResult.error) {
        pushWarning = pushResult.error
      }
    }

    return {
      success: true,
      document: document as SowDocument,
      pushWarning,
    }
  } catch (error) {
    console.error('Error creating SoW:', error)
    return { error: getActionError(error, 'Failed to create statement of work') }
  }
}

export async function updateSowDocument(id: string, input: SowDocumentInput) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  const existing = await getSowDocument(id)
  if (existing.error || !existing.document) return { error: existing.error || 'Not found' }
  if (existing.document.status === 'approved') {
    return { error: 'Approved statements of work cannot be edited' }
  }

  const validationError = validateSowInput(input)
  if (validationError) return { error: validationError }

  const rates = await getRatesForCustomerType(input.customer_type)
  if ('error' in rates) return { error: rates.error }

  const hoursPerDay = normalizeHoursPerDay(input.hours_per_day, rates.hoursPerDay)
  const hourlyRate = hourlyRateFromQuoteRate(rates.dayRateGbp, hoursPerDay)
  const mappedItems = mapLineItems(input.line_items, hoursPerDay, hourlyRate)
  const totals = computeSowTotals(mappedItems, input.include_vat)
  const agencyName =
    input.customer_type === 'partner' ? input.agency_name?.trim() || null : null
  const dayRateOverride = normalizeDayRateOverride(input.day_rate_override_gbp)
  const currency = normalizeCurrency(input.currency)
  const fxRate = normalizeFxRate(currency, input.fx_rate)

  try {
    const { error: docError } = await auth.supabase
      .from('sow_documents')
      .update({
        title: input.title.trim(),
        client_name: input.client_name.trim(),
        agency_name: agencyName,
        customer_type: input.customer_type,
        include_vat: input.include_vat,
        show_quoted_hours: input.show_quoted_hours ?? false,
        show_payment_schedule: input.show_payment_schedule ?? true,
        start_date: input.start_date || null,
        end_date: input.end_date || null,
        day_rate_override_gbp: dayRateOverride,
        base_day_rate_gbp: rates.dayRateGbp,
        hours_per_day: hoursPerDay,
        currency,
        fx_rate: fxRate,
        notes: input.notes?.trim() || null,
        ...totals,
      })
      .eq('id', id)

    if (docError) throw docError

    await auth.supabase.from('sow_line_items').delete().eq('sow_id', id)
    const rows = mappedItems.map((item) => ({ ...item, sow_id: id }))
    const { error: itemsError } = await auth.supabase.from('sow_line_items').insert(rows)
    if (itemsError) throw itemsError

    await auth.supabase.from('sow_payment_milestones').delete().eq('sow_id', id)
    const milestoneRows = mapPaymentMilestones(input.payment_milestones, id)
    const { error: milestonesError } = await auth.supabase
      .from('sow_payment_milestones')
      .insert(milestoneRows)
    if (milestonesError) throw milestonesError

    return { success: true }
  } catch (error) {
    console.error('Error updating SoW:', error)
    return { error: getActionError(error, 'Failed to update statement of work') }
  }
}

export async function archiveSowDocument(id: string) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { error } = await auth.supabase
      .from('sow_documents')
      .update({ status: 'archived' })
      .eq('id', id)

    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error archiving SoW:', error)
    return { error: getActionError(error, 'Failed to archive statement of work') }
  }
}

export async function deleteSowDocument(id: string) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { error } = await auth.supabase.from('sow_documents').delete().eq('id', id)

    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error deleting SoW:', error)
    return { error: getActionError(error, 'Failed to delete statement of work') }
  }
}

export async function createSowShareLink(sowId: string) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase || !auth.userId) return { error: auth.error ?? 'Not authenticated' }

  const shareToken = crypto.randomBytes(32).toString('hex')

  try {
    const { data, error } = await auth.supabase
      .from('sow_share_links')
      .insert({
        sow_id: sowId,
        share_token: shareToken,
        created_by: auth.userId,
        is_active: true,
      })
      .select()
      .single()

    if (error) throw error

    await auth.supabase
      .from('sow_documents')
      .update({ status: 'sent' })
      .eq('id', sowId)
      .in('status', ['draft', 'sent', 'rejected'])

    return { success: true, shareLink: data as SowShareLink }
  } catch (error) {
    console.error('Error creating SoW share link:', error)
    return { error: getActionError(error, 'Failed to create share link') }
  }
}

export async function deactivateSowShareLink(linkId: string) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { error } = await auth.supabase
      .from('sow_share_links')
      .update({ is_active: false })
      .eq('id', linkId)

    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error deactivating SoW share link:', error)
    return { error: getActionError(error, 'Failed to deactivate share link') }
  }
}
