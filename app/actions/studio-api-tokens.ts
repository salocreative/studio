'use server'

import { createClient } from '@/lib/supabase/server'
import { generateStudioApiToken } from '@/lib/studio-api-tokens'

function getActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, supabase: null, user: null }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (profile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' as const, supabase: null, user: null }
  }

  return { supabase, user, error: null as null }
}

export interface StudioApiTokenRow {
  id: string
  name: string
  token_prefix: string
  created_by: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
  created_by_name?: string | null
}

export async function listStudioApiTokens() {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('studio_api_tokens')
      .select('id, name, token_prefix, created_by, last_used_at, revoked_at, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error

    const creatorIds = Array.from(
      new Set((data || []).map((t) => t.created_by).filter(Boolean))
    ) as string[]

    let nameById = new Map<string, string | null>()
    if (creatorIds.length > 0) {
      const { data: users } = await auth.supabase
        .from('users')
        .select('id, full_name, email')
        .in('id', creatorIds)
      nameById = new Map(
        (users || []).map((u) => [u.id, u.full_name || u.email || null])
      )
    }

    const tokens: StudioApiTokenRow[] = (data || []).map((t) => ({
      ...t,
      created_by_name: t.created_by ? nameById.get(t.created_by) ?? null : null,
    }))

    return { success: true, tokens }
  } catch (error) {
    console.error('Error listing studio API tokens:', error)
    return { error: getActionError(error, 'Failed to list API tokens') }
  }
}

export async function createStudioApiToken(name: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase || !auth.user) {
    return { error: auth.error ?? 'Not authenticated' }
  }

  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name is required' }

  try {
    const { token, prefix, hash } = generateStudioApiToken()

    const { data, error } = await auth.supabase
      .from('studio_api_tokens')
      .insert({
        name: trimmed,
        token_prefix: prefix,
        token_hash: hash,
        created_by: auth.user.id,
      })
      .select('id, name, token_prefix, created_by, last_used_at, revoked_at, created_at')
      .single()

    if (error) throw error

    return {
      success: true,
      token: data as StudioApiTokenRow,
      /** Plaintext — only returned once at creation */
      plaintextToken: token,
    }
  } catch (error) {
    console.error('Error creating studio API token:', error)
    return { error: getActionError(error, 'Failed to create API token') }
  }
}

export async function revokeStudioApiToken(tokenId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { error } = await auth.supabase
      .from('studio_api_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenId)
      .is('revoked_at', null)

    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error revoking studio API token:', error)
    return { error: getActionError(error, 'Failed to revoke API token') }
  }
}

export async function deleteStudioApiToken(tokenId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { error } = await auth.supabase.from('studio_api_tokens').delete().eq('id', tokenId)
    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error deleting studio API token:', error)
    return { error: getActionError(error, 'Failed to delete API token') }
  }
}
