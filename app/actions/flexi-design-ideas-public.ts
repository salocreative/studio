'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getFlexiDesignClientByToken } from './flexi-design'
import type { FlexiDesignIdea } from './flexi-design-ideas'

/**
 * Public: list ideas pushed to a client's portal, for the share-token view.
 * Validates the token via the existing helper, then reads with the admin
 * client (no client-side auth session exists — same pattern as SOW/gallery).
 */
export async function getFlexiDesignIdeasByShareToken(shareToken: string) {
  const shareResult = await getFlexiDesignClientByToken(shareToken)
  if (shareResult.error || !shareResult.client) {
    return { error: shareResult.error || 'Invalid or expired share link' }
  }

  const adminClient = await createAdminClient()
  if (!adminClient) return { error: 'Admin client not available' }

  try {
    const { data, error } = await adminClient
      .from('flexi_design_ideas')
      .select('*')
      .eq('client_id', shareResult.client.id)
      .order('pushed_at', { ascending: false })

    if (error) throw error

    return { success: true, ideas: (data || []) as FlexiDesignIdea[] }
  } catch (error) {
    console.error('Error fetching public Flexi-Design ideas:', error)
    return { error: error instanceof Error ? error.message : 'Failed to load ideas' }
  }
}

async function loadIdeaForDecision(shareToken: string, ideaId: string) {
  const shareResult = await getFlexiDesignClientByToken(shareToken)
  if (shareResult.error || !shareResult.client) {
    return { error: shareResult.error || 'Invalid or expired share link' as string }
  }

  const adminClient = await createAdminClient()
  if (!adminClient) return { error: 'Admin client not available' }

  const { data: idea, error: ideaError } = await adminClient
    .from('flexi_design_ideas')
    .select('id, client_id, status')
    .eq('id', ideaId)
    .single()

  if (ideaError || !idea) return { error: 'Idea not found' }
  if (idea.client_id !== shareResult.client.id) return { error: 'Idea not found' }

  return { adminClient, idea, error: null as null }
}

/**
 * Client confirms interest in an idea. Flags intent only — does not touch
 * flexi_design_credit_transactions. The team still schedules and costs the
 * work once confirmed (Carl, 06/08/2026).
 */
export async function confirmFlexiDesignIdeaByToken(
  shareToken: string,
  ideaId: string,
  decidedByName: string
) {
  const loaded = await loadIdeaForDecision(shareToken, ideaId)
  if (loaded.error || !loaded.adminClient || !loaded.idea) {
    return { error: loaded.error ?? 'Invalid link' }
  }

  const name = decidedByName.trim()
  if (!name) return { error: 'Please enter your name' }

  if (loaded.idea.status !== 'pushed') {
    return { error: 'This idea has already been responded to' }
  }

  try {
    const { error } = await loaded.adminClient
      .from('flexi_design_ideas')
      .update({
        status: 'confirmed',
        decided_at: new Date().toISOString(),
        decided_by_name: name,
        decision_notes: null,
      })
      .eq('id', ideaId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error confirming Flexi-Design idea:', error)
    return { error: error instanceof Error ? error.message : 'Failed to confirm idea' }
  }
}

/**
 * Client declines an idea, with optional feedback.
 */
export async function declineFlexiDesignIdeaByToken(
  shareToken: string,
  ideaId: string,
  decidedByName: string,
  decisionNotes?: string
) {
  const loaded = await loadIdeaForDecision(shareToken, ideaId)
  if (loaded.error || !loaded.adminClient || !loaded.idea) {
    return { error: loaded.error ?? 'Invalid link' }
  }

  const name = decidedByName.trim()
  if (!name) return { error: 'Please enter your name' }

  if (loaded.idea.status !== 'pushed') {
    return { error: 'This idea has already been responded to' }
  }

  try {
    const { error } = await loaded.adminClient
      .from('flexi_design_ideas')
      .update({
        status: 'declined',
        decided_at: new Date().toISOString(),
        decided_by_name: name,
        decision_notes: decisionNotes?.trim() || null,
      })
      .eq('id', ideaId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error declining Flexi-Design idea:', error)
    return { error: error instanceof Error ? error.message : 'Failed to decline idea' }
  }
}
