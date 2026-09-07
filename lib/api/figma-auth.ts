import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateStudioApiToken,
  bearerTokenFromRequest,
} from '@/lib/api/studio-auth'

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
  const token = bearerTokenFromRequest(request)
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

  return authenticateStudioApiToken(token)
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
