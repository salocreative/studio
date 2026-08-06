'use server'

import { createClient } from '@/lib/supabase/server'

export type FlexiDesignIdeaStatus = 'pushed' | 'confirmed' | 'declined'

export interface FlexiDesignIdea {
  id: string
  client_id: string
  title: string
  summary: string
  deliverable: string
  goal: string
  credit_estimate: number | null
  status: FlexiDesignIdeaStatus
  slack_thread_url: string | null
  pushed_at: string
  decided_at: string | null
  decided_by_name: string | null
  decision_notes: string | null
  created_at: string
  updated_at: string
}

export interface PushFlexiDesignIdeaInput {
  clientId: string
  title: string
  summary: string
  deliverable: string
  goal: string
  creditEstimate?: number | null
  slackThreadUrl?: string | null
}

/**
 * Team-side: list all ideas pushed to a client's portal (any status).
 * Source of truth for Draft/Team Review stays clients/{Client}/ideas.md in Drive —
 * this table only ever holds ideas that have reached Finalised and been pushed.
 */
export async function getFlexiDesignIdeasForClient(clientId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  try {
    const { data, error } = await supabase
      .from('flexi_design_ideas')
      .select('*')
      .eq('client_id', clientId)
      .order('pushed_at', { ascending: false })

    if (error) throw error

    return { success: true, ideas: (data || []) as FlexiDesignIdea[] }
  } catch (error) {
    console.error('Error fetching Flexi-Design ideas:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch ideas' }
  }
}

/**
 * Team-side: push a Finalised idea live to a client's portal.
 * Requires an authenticated admin session.
 */
export async function pushFlexiDesignIdea(input: PushFlexiDesignIdeaInput) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const title = input.title.trim()
  if (!title) return { error: 'Title is required' }

  try {
    const { data, error } = await supabase
      .from('flexi_design_ideas')
      .insert({
        client_id: input.clientId,
        title,
        summary: input.summary.trim(),
        deliverable: input.deliverable.trim(),
        goal: input.goal.trim(),
        credit_estimate: input.creditEstimate ?? null,
        slack_thread_url: input.slackThreadUrl?.trim() || null,
        status: 'pushed' as FlexiDesignIdeaStatus,
        created_by: user.id,
      })
      .select('*')
      .single()

    if (error) throw error

    return { success: true, idea: data as FlexiDesignIdea }
  } catch (error) {
    console.error('Error pushing Flexi-Design idea:', error)
    return { error: error instanceof Error ? error.message : 'Failed to push idea' }
  }
}

/**
 * Team-side: remove an idea from the portal entirely (e.g. pushed by mistake).
 * Does not touch clients/{Client}/ideas.md in Drive — that's a separate, manual edit.
 */
export async function deleteFlexiDesignIdea(ideaId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  try {
    const { error } = await supabase.from('flexi_design_ideas').delete().eq('id', ideaId)
    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error deleting Flexi-Design idea:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete idea' }
  }
}
