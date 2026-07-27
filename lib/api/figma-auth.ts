import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashStudioApiToken } from '@/lib/studio-api-tokens'

export function figmaApiCorsHeaders(request?: NextRequest) {
  const origin = request?.headers.get('origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export function figmaOptionsResponse(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: figmaApiCorsHeaders(request),
  })
}

export function jsonWithCors(
  request: NextRequest,
  body: unknown,
  init?: { status?: number }
) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: figmaApiCorsHeaders(request),
  })
}

export async function requireFigmaApiAuth(request: NextRequest) {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) {
    return { error: 'Missing Authorization Bearer token' as const }
  }

  const token = match[1].trim()
  if (!token) return { error: 'Missing Authorization Bearer token' as const }

  const admin = await createAdminClient()
  if (!admin) return { error: 'Service unavailable' as const }

  const hash = hashStudioApiToken(token)

  const { data: row, error } = await admin
    .from('studio_api_tokens')
    .select('id, created_by, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (error) {
    console.error('Error looking up studio API token:', error)
    return { error: 'Failed to validate API token' as const }
  }
  if (!row) return { error: 'Invalid API token' as const }
  if (row.revoked_at) return { error: 'API token has been revoked' as const }
  if (!row.created_by) return { error: 'API token has no owner' as const }

  const { data: user, error: userError } = await admin
    .from('users')
    .select('id, role, email, full_name, deleted_at')
    .eq('id', row.created_by)
    .single()

  if (userError || !user || user.deleted_at) {
    return { error: 'API token owner is inactive' as const }
  }

  if (user.role !== 'admin' && user.role !== 'designer' && user.role !== 'manager') {
    return { error: 'API token owner is not authorized' as const }
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
