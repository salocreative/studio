'use server'

import { createAdminClient } from '@/lib/supabase/server'
import type { SowDocument, SowLineItem, SowPaymentMilestone, SowStatus } from '@/app/actions/sow'

export interface PublicSowDocument extends SowDocument {
  line_items: SowLineItem[]
  payment_milestones: SowPaymentMilestone[]
}

async function validateShareToken(shareToken: string) {
  const adminClient = await createAdminClient()
  if (!adminClient) return { error: 'Service unavailable' as const }

  const { data: link, error: linkError } = await adminClient
    .from('sow_share_links')
    .select('sow_id, expires_at, is_active')
    .eq('share_token', shareToken)
    .single()

  if (linkError || !link) return { error: 'Invalid or expired link' as const }
  if (!link.is_active) return { error: 'This link is no longer active' as const }
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return { error: 'This link has expired' as const }
  }

  return { adminClient, sowId: link.sow_id as string, error: null as null }
}

export async function getSowByToken(shareToken: string) {
  const validated = await validateShareToken(shareToken)
  if (validated.error || !validated.adminClient) return { error: validated.error ?? 'Invalid link' }

  try {
    const { data: document, error: docError } = await validated.adminClient
      .from('sow_documents')
      .select('*')
      .eq('id', validated.sowId)
      .single()

    if (docError || !document) return { error: 'Statement of work not found' }

    const { data: lineItems, error: itemsError } = await validated.adminClient
      .from('sow_line_items')
      .select('*')
      .eq('sow_id', validated.sowId)
      .order('sort_order', { ascending: true })

    if (itemsError) throw itemsError

    const { data: paymentMilestones, error: milestonesError } = await validated.adminClient
      .from('sow_payment_milestones')
      .select('*')
      .eq('sow_id', validated.sowId)
      .order('sort_order', { ascending: true })

    if (milestonesError) throw milestonesError

    return {
      success: true,
      document: {
        ...(document as SowDocument),
        line_items: (lineItems || []) as SowLineItem[],
        payment_milestones: (paymentMilestones || []) as SowPaymentMilestone[],
      } as PublicSowDocument,
    }
  } catch (error) {
    console.error('Error fetching public SoW:', error)
    return { error: error instanceof Error ? error.message : 'Failed to load statement of work' }
  }
}

export async function approveSowByToken(
  shareToken: string,
  approvedByName: string,
  approvedByEmail?: string
) {
  const validated = await validateShareToken(shareToken)
  if (validated.error || !validated.adminClient) return { error: validated.error ?? 'Invalid link' }

  const name = approvedByName.trim()
  if (!name) return { error: 'Please enter your name' }

  try {
    const { data: existing } = await validated.adminClient
      .from('sow_documents')
      .select('status')
      .eq('id', validated.sowId)
      .single()

    if (!existing) return { error: 'Statement of work not found' }
    if (existing.status === 'approved') return { error: 'This statement of work is already approved' }
    if (existing.status === 'rejected') {
      return { error: 'This statement of work was declined. Contact Salo for a revised version.' }
    }

    const { error } = await validated.adminClient
      .from('sow_documents')
      .update({
        status: 'approved' as SowStatus,
        approved_at: new Date().toISOString(),
        approved_by_name: name,
        approved_by_email: approvedByEmail?.trim() || null,
        rejected_at: null,
        rejected_by_name: null,
        rejection_notes: null,
      })
      .eq('id', validated.sowId)

    if (error) throw error

    const { syncSowApprovalToMonday } = await import('./sow-to-monday')
    await syncSowApprovalToMonday(validated.sowId, 'approved')

    return { success: true }
  } catch (error) {
    console.error('Error approving SoW:', error)
    return { error: error instanceof Error ? error.message : 'Failed to approve statement of work' }
  }
}

export async function rejectSowByToken(
  shareToken: string,
  rejectedByName: string,
  rejectionNotes?: string
) {
  const validated = await validateShareToken(shareToken)
  if (validated.error || !validated.adminClient) return { error: validated.error ?? 'Invalid link' }

  const name = rejectedByName.trim()
  if (!name) return { error: 'Please enter your name' }

  try {
    const { data: existing } = await validated.adminClient
      .from('sow_documents')
      .select('status')
      .eq('id', validated.sowId)
      .single()

    if (!existing) return { error: 'Statement of work not found' }
    if (existing.status === 'approved') {
      return { error: 'This statement of work has already been approved' }
    }

    const { error } = await validated.adminClient
      .from('sow_documents')
      .update({
        status: 'rejected' as SowStatus,
        rejected_at: new Date().toISOString(),
        rejected_by_name: name,
        rejection_notes: rejectionNotes?.trim() || null,
      })
      .eq('id', validated.sowId)

    if (error) throw error

    const { syncSowApprovalToMonday } = await import('./sow-to-monday')
    await syncSowApprovalToMonday(validated.sowId, 'rejected')

    return { success: true }
  } catch (error) {
    console.error('Error rejecting SoW:', error)
    return { error: error instanceof Error ? error.message : 'Failed to decline statement of work' }
  }
}
