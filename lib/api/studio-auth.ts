import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashStudioApiToken, looksLikeStudioApiToken } from '@/lib/studio-api-tokens'

export type StudioApiUser = {
  id: string | null
  role: string
  email: string | null
  full_name: string | null
}

export type StudioApiAuthResult =
  | { error: 'unauthenticated' | 'forbidden' | 'Service unavailable'; user?: undefined }
  | { error?: undefined; user: StudioApiUser; tokenId: string | null }

export function bearerTokenFromRequest(request: NextRequest): string | null {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  return token || null
}

/** Look up a `salo_…` token from Settings → Integrations. */
export async function authenticateStudioApiToken(token: string): Promise<StudioApiAuthResult> {
  if (!looksLikeStudioApiToken(token)) {
    return { error: 'unauthenticated' }
  }

  const admin = await createAdminClient()
  if (!admin) return { error: 'Service unavailable' }

  const hash = hashStudioApiToken(token)

  const { data: row, error } = await admin
    .from('studio_api_tokens')
    .select('id, created_by, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (error) {
    console.error('Error looking up studio API token:', error)
    return { error: 'unauthenticated' }
  }
  if (!row || row.revoked_at) return { error: 'unauthenticated' }
  if (!row.created_by) return { error: 'unauthenticated' }

  const { data: user, error: userError } = await admin
    .from('users')
    .select('id, role, email, full_name, deleted_at')
    .eq('id', row.created_by)
    .single()

  if (userError || !user || user.deleted_at) {
    return { error: 'unauthenticated' }
  }

  if (user.role !== 'admin' && user.role !== 'designer' && user.role !== 'manager') {
    return { error: 'forbidden' }
  }

  void admin
    .from('studio_api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)

  return {
    tokenId: row.id as string,
    user: {
      id: user.id as string,
      role: user.role as string,
      email: (user.email as string | null) ?? null,
      full_name: (user.full_name as string | null) ?? null,
    },
  }
}

export async function requireStudioApiAuth(request: NextRequest): Promise<StudioApiAuthResult> {
  const token = bearerTokenFromRequest(request)
  if (!token) return { error: 'unauthenticated' }
  return authenticateStudioApiToken(token)
}

export function studioAuthErrorResponse(auth: { error: string }) {
  const status =
    auth.error === 'forbidden' ? 403 : auth.error === 'Service unavailable' ? 503 : 401
  const code =
    auth.error === 'forbidden'
      ? 'forbidden'
      : auth.error === 'Service unavailable'
        ? 'service_unavailable'
        : 'unauthenticated'
  return NextResponse.json(
    {
      error: code,
      message:
        auth.error === 'forbidden'
          ? 'Token is not allowed to use this API'
          : auth.error === 'Service unavailable'
            ? 'Service unavailable'
            : 'Missing or invalid API token',
    },
    { status }
  )
}
