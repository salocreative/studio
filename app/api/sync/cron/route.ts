import { NextRequest, NextResponse } from 'next/server'
import { syncMondayProjects } from '@/app/actions/monday'
import { updateSyncTimestamp, getSyncSettings } from '@/app/actions/sync-settings'

/**
 * API route for cron jobs to trigger automatic sync
 * This endpoint should be called by a cron service (Vercel Cron, EasyCron, etc.)
 * 
 * To secure this endpoint, set CRON_SECRET in your environment variables
 * and include it in the X-Cron-Secret header when calling this endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret if configured
    const cronSecret = process.env.CRON_SECRET
    const providedSecret = request.headers.get('X-Cron-Secret')
    
    if (cronSecret && providedSecret !== cronSecret) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid cron secret' },
        { status: 401 }
      )
    }

    // Check if sync is enabled
    const settingsResult = await getSyncSettings()
    if (settingsResult.error || !settingsResult.settings) {
      return NextResponse.json(
        { error: 'Failed to check sync settings', details: settingsResult.error },
        { status: 500 }
      )
    }

    if (!settingsResult.settings.enabled) {
      return NextResponse.json(
        { message: 'Automatic sync is disabled', skipped: true },
        { status: 200 }
      )
    }

    // Perform the sync (this function checks for admin, but in cron context we bypass)
    // We need to create a version that doesn't require user auth for cron
    const mondayApiToken = process.env.MONDAY_API_TOKEN
    if (!mondayApiToken) {
      return NextResponse.json(
        { error: 'Monday.com API token not configured' },
        { status: 500 }
      )
    }

    // Import and call sync directly
    const { syncMondayData } = await import('@/lib/monday/api')
    const result = await syncMondayData(mondayApiToken)

    // Update sync timestamp
    await updateSyncTimestamp()

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

