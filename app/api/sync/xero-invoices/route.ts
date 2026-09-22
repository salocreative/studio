import { NextRequest, NextResponse } from 'next/server'
import { cronRequestAuthorized, unauthorizedCronResponse } from '@/lib/cron/auth'
import { refreshLinkedXeroInvoiceStatuses } from '@/lib/billing/xero-status-sync'

export const maxDuration = 60

/**
 * Daily refresh of linked Studio invoice statuses from Xero.
 * Separate from Monday sync. Vercel Cron sends CRON_SECRET as Bearer;
 * external services can send X-Cron-Secret instead.
 */
export async function GET(request: NextRequest) {
  if (!cronRequestAuthorized(request)) {
    return unauthorizedCronResponse()
  }

  try {
    const result = await refreshLinkedXeroInvoiceStatuses()
    if ('error' in result) {
      const message = result.error || 'Failed to refresh Xero invoices'
      const notConnected =
        message.includes('not connected') || message.includes('Xero not connected')
      return NextResponse.json(
        notConnected ? { skipped: true, message } : { error: message },
        { status: notConnected ? 200 : 500 }
      )
    }

    return NextResponse.json({
      success: true,
      updated: result.updated,
      checked: result.checked,
      fetched: result.fetched,
      truncated: result.truncated,
      changes: result.changes,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Xero invoice status cron error:', error)
    return NextResponse.json(
      {
        error: 'Xero invoice status sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
