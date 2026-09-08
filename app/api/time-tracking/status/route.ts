import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioApiAuth, studioAuthErrorResponse } from '@/lib/api/studio-auth'
import { getWeeklyTimesheetStatus } from '@/lib/time-tracking/status'

export const runtime = 'nodejs'

/** GET /api/time-tracking/status?week_start=YYYY-MM-DD — Mon–Fri log status per teammate. */
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

  const weekStart = request.nextUrl.searchParams.get('week_start')?.trim() || undefined
  const result = await getWeeklyTimesheetStatus(admin, { weekStart })

  if ('error' in result) {
    const status = result.error.includes('week_start') ? 400 : 500
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
