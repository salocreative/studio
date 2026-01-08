import { NextRequest, NextResponse } from 'next/server'
import { syncScorecardRecentWeeks } from '@/app/actions/scorecard'

/**
 * API route for syncing scorecard data
 * Should be called on Sundays via cron job
 * 
 * To set up with Vercel Cron:
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/sync-scorecard",
 *     "schedule": "0 20 * * 0"
 *   }]
 * }
 * 
 * Or use external cron service (cron-job.org, etc.) to call:
 * https://your-domain.com/api/cron/sync-scorecard?secret=YOUR_SECRET
 */
export async function GET(request: NextRequest) {
  try {
    // Optional: Add authentication check
    const authHeader = request.headers.get('authorization')
    const secret = request.nextUrl.searchParams.get('secret')
    const cronSecret = process.env.CRON_SECRET

    // If CRON_SECRET is set, require it to match
    if (cronSecret) {
      if (!secret || secret !== cronSecret) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      // Alternative: Use Bearer token
      const token = authHeader.substring(7)
      if (token !== process.env.CRON_SECRET) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }
    }

    // Sync last 3 weeks
    const result = await syncScorecardRecentWeeks(3)

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${result.totalEntriesSynced} entries across ${result.weeksSynced} weeks`,
      ...result,
    })
  } catch (error) {
    console.error('Error in scorecard sync cron:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

