import { NextRequest, NextResponse } from 'next/server'
import { getSyncSettingsAdmin, markSyncCompleteAdmin } from '@/lib/monday/sync-settings-admin'

/**
 * API route for cron jobs to trigger automatic sync
 * Called by Vercel Cron (see vercel.json) or an external cron service.
 *
 * To secure this endpoint, set CRON_SECRET in your environment variables.
 * Vercel Cron sends it automatically as `Authorization: Bearer <CRON_SECRET>`;
 * external services can send it as an `X-Cron-Secret` header instead.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret if configured
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret) {
      const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '')
      const headerSecret = request.headers.get('X-Cron-Secret')

      if (bearer !== cronSecret && headerSecret !== cronSecret) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid cron secret' },
          { status: 401 }
        )
      }
    }

    // Check if sync is enabled. Read with the service-role client: a cron request
    // carries no session, and monday_sync_settings is admin-only under RLS.
    const settingsResult = await getSyncSettingsAdmin()
    if (settingsResult.error || !settingsResult.settings) {
      return NextResponse.json(
        { error: 'Failed to check sync settings', details: settingsResult.error },
        { status: 500 }
      )
    }

    // Respect sync interval: only run if enough time has passed since last sync
    const settings = settingsResult.settings
    if (!settings.enabled) {
      return NextResponse.json(
        { message: 'Automatic sync is disabled', skipped: true },
        { status: 200 }
      )
    }

    const intervalMinutes = settings.interval_minutes || 60
    const intervalMs = intervalMinutes * 60 * 1000
    // Allow a small tolerance, capped at 5 minutes. The Vercel cron fires once a
    // day, so a 1440-minute interval would otherwise be skipped whenever the run
    // lands seconds earlier than the previous one — turning a daily sync into an
    // every-other-day sync.
    const toleranceMs = Math.min(5 * 60 * 1000, intervalMs * 0.1)
    if (settings.last_sync_at) {
      const elapsed = Date.now() - new Date(settings.last_sync_at).getTime()
      if (elapsed < intervalMs - toleranceMs) {
        return NextResponse.json(
          {
            message: 'Sync skipped: interval not reached',
            skipped: true,
            nextSyncIn: Math.ceil((intervalMs - toleranceMs - elapsed) / 60000) + ' minutes',
          },
          { status: 200 }
        )
      }
    }

    const mondayApiToken = process.env.MONDAY_API_TOKEN
    if (!mondayApiToken) {
      return NextResponse.json(
        { error: 'Monday.com API token not configured' },
        { status: 500 }
      )
    }

    // Import and call sync directly (respect avoid_deletion setting)
    const { syncMondayData } = await import('@/lib/monday/api')
    const avoidDeletion = settings.avoid_deletion !== false
    const result = await syncMondayData(mondayApiToken, undefined, false, avoidDeletion)

    // Update sync timestamp
    const timestampResult = await markSyncCompleteAdmin(intervalMinutes)
    if (timestampResult.error) {
      console.error('Cron sync: failed to record sync timestamp:', timestampResult.error)
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${result.projectsSynced} projects`,
      projectsSynced: result.projectsSynced,
      archived: result.archived,
      deleted: result.deleted,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Cron sync error:', error)
    return NextResponse.json(
      {
        error: 'Sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
