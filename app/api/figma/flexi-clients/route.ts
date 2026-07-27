import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  figmaOptionsResponse,
  jsonWithCors,
  requireFigmaApiAuth,
} from '@/lib/api/figma-auth'

export async function OPTIONS(request: NextRequest) {
  return figmaOptionsResponse(request)
}

export async function GET(request: NextRequest) {
  const auth = await requireFigmaApiAuth(request)
  if ('error' in auth) {
    return jsonWithCors(request, { error: auth.error }, { status: 401 })
  }

  const admin = await createAdminClient()
  if (!admin) {
    return jsonWithCors(request, { error: 'Service unavailable' }, { status: 503 })
  }

  const { data, error } = await admin
    .from('flexi_design_clients')
    .select('id, client_name')
    .order('client_name', { ascending: true })

  if (error) {
    console.error('Figma API list clients error:', error)
    return jsonWithCors(
      request,
      { error: 'Failed to list Flexi-Design clients' },
      { status: 500 }
    )
  }

  return jsonWithCors(request, {
    clients: (data || []).map((c) => ({
      id: c.id,
      client_name: c.client_name,
    })),
  })
}
