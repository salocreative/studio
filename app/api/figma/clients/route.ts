import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  authErrorResponse,
  figmaOptionsResponse,
  jsonWithCors,
  requireFigmaApiAuth,
} from '@/lib/api/figma-auth'

export async function OPTIONS() {
  return figmaOptionsResponse()
}

/** Plugin contract: GET /api/figma/clients */
export async function GET(request: NextRequest) {
  const auth = await requireFigmaApiAuth(request)
  if ('error' in auth && auth.error) {
    return authErrorResponse(auth)
  }

  const admin = await createAdminClient()
  if (!admin) {
    return jsonWithCors(
      { error: 'service_unavailable', message: 'Service unavailable' },
      { status: 503 }
    )
  }

  const { data, error } = await admin
    .from('flexi_design_clients')
    .select('id, client_name')
    .order('client_name', { ascending: true })

  if (error) {
    console.error('Figma API list clients error:', error)
    return jsonWithCors(
      { error: 'Failed to list Flexi-Design clients' },
      { status: 500 }
    )
  }

  return jsonWithCors({
    clients: (data || []).map((c) => ({
      id: c.id,
      client_name: c.client_name,
    })),
  })
}
