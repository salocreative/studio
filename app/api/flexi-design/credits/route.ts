import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioApiAuth, studioAuthErrorResponse } from '@/lib/api/studio-auth'
import { getFlexiDesignCreditBalances } from '@/lib/flexi-design/credits'

export const runtime = 'nodejs'

function parseBooleanParam(value: string | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

/** GET /api/flexi-design/credits — remaining/total Flexi credits (same formula as admin). */
export async function GET(request: NextRequest) {
  const auth = await requireStudioApiAuth(request)
  if ('error' in auth && auth.error) {
    return studioAuthErrorResponse(auth)
  }

  const admin = await createAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'service_unavailable', message: 'Service unavailable' },
      { status: 503 }
    )
  }

  const clientName = request.nextUrl.searchParams.get('client')?.trim() || undefined
  const includeHidden = parseBooleanParam(request.nextUrl.searchParams.get('include_hidden'))

  const result = await getFlexiDesignCreditBalances(admin, {
    includeHidden,
    clientName,
  })

  if ('error' in result) {
    return NextResponse.json({ error: 'Failed to load Flexi-Design credits' }, { status: 500 })
  }

  if (clientName && result.clients.length === 0) {
    return NextResponse.json(
      { error: 'not_found', message: `No Flexi-Design client named "${clientName}"` },
      { status: 404 }
    )
  }

  const clients = result.clients.map((client) => ({
    id: client.id || null,
    client_name: client.client_name,
    total_credits: client.total_credits,
    credits_used: client.credits_used,
    remaining_credits: client.remaining_credits,
    is_hidden: client.is_hidden,
    last_credit_hours: client.last_credit_hours,
    last_credit_date: client.last_credit_date,
  }))

  if (clientName) {
    return NextResponse.json(
      { client: clients[0] },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  return NextResponse.json(
    { clients },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
