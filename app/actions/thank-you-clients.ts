'use server'

import { createClient } from '@/lib/supabase/server'

export interface ThankYouClient {
  id: string
  slug: string
  client_name: string
  recipient_names: string
  project_description: string
  personal_message: string | string[]
  team_video_presenters: string | null
  team_video_url: string | null
  team_video_placeholder_text: string | null
  show_upsell: boolean
  referral_action_description: string | null
  upsell_heading: string | null
  upsell_description: string | null
  upsell_button_text: string | null
  published: boolean
  created_at: string
  updated_at: string
}

export type ThankYouClientInput = {
  slug: string
  client_name: string
  recipient_names: string
  project_description: string
  personal_message: string[]
  team_video_presenters: string | null
  team_video_url: string | null
  team_video_placeholder_text: string | null
  show_upsell: boolean
  referral_action_description: string | null
  upsell_heading: string | null
  upsell_description: string | null
  upsell_button_text: string | null
  published: boolean
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' as const, supabase: null }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' as const, supabase: null }
  }

  return { supabase, error: null as null }
}

function normalizePersonalMessage(paragraphs: string[]): string[] {
  return paragraphs.map((p) => p.trim()).filter(Boolean)
}

function validateInput(input: ThankYouClientInput): string | null {
  const slug = input.slug.trim().toLowerCase()
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return 'Slug must be lowercase letters, numbers, and hyphens only (e.g. provenant or acme-corp)'
  }

  if (!input.client_name.trim()) return 'Client name is required'
  if (!input.recipient_names.trim()) return 'Recipient names are required'
  if (!input.project_description.trim()) return 'Project description is required'

  const message = normalizePersonalMessage(input.personal_message)
  if (message.length === 0) return 'At least one personal message paragraph is required'

  return null
}

function toDbRow(input: ThankYouClientInput) {
  const paragraphs = normalizePersonalMessage(input.personal_message)
  return {
    slug: input.slug.trim().toLowerCase(),
    client_name: input.client_name.trim(),
    recipient_names: input.recipient_names.trim(),
    project_description: input.project_description.trim(),
    personal_message: paragraphs,
    team_video_presenters: input.team_video_presenters?.trim() || null,
    team_video_url: input.team_video_url?.trim() || null,
    team_video_placeholder_text: input.team_video_placeholder_text?.trim() || null,
    show_upsell: input.show_upsell,
    referral_action_description: input.referral_action_description?.trim() || null,
    upsell_heading: input.upsell_heading?.trim() || null,
    upsell_description: input.upsell_description?.trim() || null,
    upsell_button_text: input.upsell_button_text?.trim() || null,
    published: input.published,
  }
}

export async function getThankYouClients() {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('thank_you_clients')
      .select('*')
      .order('client_name', { ascending: true })

    if (error) throw error

    return { success: true, clients: (data || []) as ThankYouClient[] }
  } catch (error) {
    console.error('Error fetching thank you clients:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch thank you clients' }
  }
}

export async function createThankYouClient(input: ThankYouClientInput) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  const validationError = validateInput(input)
  if (validationError) return { error: validationError }

  try {
    const { data, error } = await auth.supabase
      .from('thank_you_clients')
      .insert(toDbRow(input))
      .select()
      .single()

    if (error) throw error

    return { success: true, client: data as ThankYouClient }
  } catch (error) {
    console.error('Error creating thank you client:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create thank you client' }
  }
}

export async function updateThankYouClient(id: string, input: ThankYouClientInput) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  const validationError = validateInput(input)
  if (validationError) return { error: validationError }

  try {
    const { data, error } = await auth.supabase
      .from('thank_you_clients')
      .update(toDbRow(input))
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return { success: true, client: data as ThankYouClient }
  } catch (error) {
    console.error('Error updating thank you client:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update thank you client' }
  }
}

export async function setThankYouClientPublished(id: string, published: boolean) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('thank_you_clients')
      .update({ published })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return { success: true, client: data as ThankYouClient }
  } catch (error) {
    console.error('Error updating thank you client published status:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update published status' }
  }
}

export async function deleteThankYouClient(id: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { error } = await auth.supabase
      .from('thank_you_clients')
      .delete()
      .eq('id', id)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error deleting thank you client:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete thank you client' }
  }
}
