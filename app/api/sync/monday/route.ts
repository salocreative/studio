import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncMondayData, type SyncProgressEvent } from '@/lib/monday/api'

function sseMessage(data: SyncProgressEvent): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

/**
 * POST /api/sync/monday
 * Streams Monday.com sync progress via Server-Sent Events.
 * Body: { syncAllBoards?: boolean } — when true, scans all boards (full resync).
 * Requires admin authentication.
 */
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  let syncAllBoards = false
  try {
    const body = await request.json().catch(() => ({}))
    syncAllBoards = !!body?.syncAllBoards
  } catch {
    // ignore
  }

  // Quick Sync (syncAllBoards: false) is allowed for all employees; Sync all Boards requires admin
  if (syncAllBoards && userProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required for full sync' }, { status: 403 })
  }

  const mondayApiToken = process.env.MONDAY_API_TOKEN
  if (!mondayApiToken) {
    return NextResponse.json(
      { error: 'Monday.com API token not configured' },
      { status: 500 }
    )
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (event: SyncProgressEvent) => {
        controller.enqueue(encoder.encode(sseMessage(event)))
      }

      try {
        await syncMondayData(mondayApiToken, send, syncAllBoards)
      } catch (error) {
        send({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Sync failed',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
