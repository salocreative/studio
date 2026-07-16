'use server'

import { createClient } from '@/lib/supabase/server'
import { getQuoteRateByType } from '@/app/actions/quote-rates'
import {
  computeLineItem,
  computeSowTotals,
  hourlyRateFromQuoteRate,
  type SowLineItemInput,
} from '@/lib/sow/calculations'
import crypto from 'crypto'

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
  line_items?: SowLineItem[]
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
  { error: string } | { hourlyRate: number; hoursPerDay: number }
> {
  const rateResult = await getQuoteRateByType(customerType)
  if (rateResult.error || !rateResult.rate) {
    return { error: rateResult.error || 'Quote rates not configured. Set them in Settings.' }
  }
  const hoursPerDay = Number(rateResult.rate.hours_per_day)
  const hourlyRate = hourlyRateFromQuoteRate(
    Number(rateResult.rate.day_rate_gbp),
    hoursPerDay
  )
  return { hourlyRate, hoursPerDay }
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
      sort_order: index,
    }
  })
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
    return { error: error instanceof Error ? error.message : 'Failed to fetch agencies' }
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
    return { error: error instanceof Error ? error.message : 'Failed to fetch clients' }
  }
}

function validateSowInput(input: SowDocumentInput): string | null {
  if (!input.title.trim()) return 'Title is required'
  if (!input.client_name.trim()) return 'End client is required'
  if (!input.line_items.length) return 'Add at least one line item'
  if (input.customer_type === 'partner' && !input.agency_name?.trim()) {
    return 'Agency partner is required when using partner rates'
  }
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

    return { success: true, documents: (data || []) as SowDocument[] }
  } catch (error) {
    console.error('Error fetching SoW documents:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch statements of work' }
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
      document: { ...(document as SowDocument), line_items: (lineItems || []) as SowLineItem[] },
      shareLinks: (shareLinks || []) as SowShareLink[],
      linkedLead,
    }
  } catch (error) {
    console.error('Error fetching SoW document:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch statement of work' }
  }
}

export type SowDocumentInput = {
  title: string
  client_name: string
  agency_name?: string | null
  customer_type: 'partner' | 'client'
  include_vat: boolean
  show_quoted_hours?: boolean
  notes?: string | null
  line_items: SowLineItemInput[]
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

  const mappedItems = mapLineItems(input.line_items, rates.hoursPerDay, rates.hourlyRate)
  const totals = computeSowTotals(mappedItems, input.include_vat)
  const agencyName =
    input.customer_type === 'partner' ? input.agency_name?.trim() || null : null

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
        show_quoted_hours: input.show_quoted_hours ?? true,
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
    return { error: error instanceof Error ? error.message : 'Failed to create statement of work' }
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

  const mappedItems = mapLineItems(input.line_items, rates.hoursPerDay, rates.hourlyRate)
  const totals = computeSowTotals(mappedItems, input.include_vat)
  const agencyName =
    input.customer_type === 'partner' ? input.agency_name?.trim() || null : null

  try {
    const { error: docError } = await auth.supabase
      .from('sow_documents')
      .update({
        title: input.title.trim(),
        client_name: input.client_name.trim(),
        agency_name: agencyName,
        customer_type: input.customer_type,
        include_vat: input.include_vat,
        show_quoted_hours: input.show_quoted_hours ?? true,
        notes: input.notes?.trim() || null,
        ...totals,
      })
      .eq('id', id)

    if (docError) throw docError

    await auth.supabase.from('sow_line_items').delete().eq('sow_id', id)
    const rows = mappedItems.map((item) => ({ ...item, sow_id: id }))
    const { error: itemsError } = await auth.supabase.from('sow_line_items').insert(rows)
    if (itemsError) throw itemsError

    return { success: true }
  } catch (error) {
    console.error('Error updating SoW:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update statement of work' }
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
    return { error: error instanceof Error ? error.message : 'Failed to archive statement of work' }
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
    return { error: error instanceof Error ? error.message : 'Failed to delete statement of work' }
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
    return { error: error instanceof Error ? error.message : 'Failed to create share link' }
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
    return { error: error instanceof Error ? error.message : 'Failed to deactivate share link' }
  }
}
