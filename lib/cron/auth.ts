import { NextRequest, NextResponse } from 'next/server'

export function cronRequestAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '')
  const headerSecret = request.headers.get('X-Cron-Secret')
  return bearer === cronSecret || headerSecret === cronSecret
}

export function unauthorizedCronResponse() {
  return NextResponse.json({ error: 'Unauthorised: Invalid cron secret' }, { status: 401 })
}
