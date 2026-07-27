import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashStudioApiToken, looksLikeStudioApiToken } from '@/lib/studio-api-tokens'

export type FigmaApiUser = {
  id: string | null
  role: string
  email: string | null
  full_name: string | null
}

/** Plugin contract: allow any origin (Figma iframe / null). */
export function figmaApiCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export function figmaOptionsResponse() {
  return new NextResponse(null, {
    status: 204,
    headers: figmaApiCorsHeaders(),
  })
}

export function jsonWithCors(
  body: unknown,
  init?: { status?: number }
) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: figmaApiCorsHeaders(),
  })
}

/**
 * Auth for Figma plugin:
 * 1. Shared env secret FIGMA_PLUGIN_API_TOKEN (plugin contract v1)
 * 2. Or a Studio API token (salo_…) from Settings → Integrations
 */
export async function requireFigmaApiAuth(request: NextRequest): Promise<
  | { error: 'unauthenticated' | 'forbidden' | 'Service unavailable'; user?: undefined }
  | { error?: undefined; user: FigmaApiUser; tokenId: string | null }
> {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  if (!token) return { error: 'unauthenticated' }

  const envToken = process.env.FIGMA_PLUGIN_API_TOKEN?.trim()
  if (envToken && token === envToken) {
    return {
      tokenId: null,
      user: {
        id: null,
        role: 'admin',
        email: null,
        full_name: 'Figma plugin',
      },
    }
  }

  if (!looksLikeStudioApiToken(token)) {
    // Wrong secret, or env not configured
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

export function authErrorResponse(
  auth: { error: string }
) {
  const status = auth.error === 'forbidden' ? 403 : auth.error === 'Service unavailable' ? 503 : 401
  const code =
    auth.error === 'forbidden'
      ? 'forbidden'
      : auth.error === 'Service unavailable'
        ? 'service_unavailable'
        : 'unauthenticated'
  return jsonWithCors(
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
