import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import { getTimeTrackingBootstrap } from '@/app/actions/time-tracking'
import { TimeTrackingClient, type TimeTrackingInitialData } from './time-tracking-client'
import { TimeTrackingSkeleton } from './components/time-tracking-skeleton'

// Reads the session cookie, so it can never be static.
export const dynamic = 'force-dynamic'

/**
 * Today in UK time.
 *
 * Deliberately not the server's own `new Date()`: Vercel functions run in UTC, so between
 * midnight and 01:00 BST the server would fetch the previous day while the browser showed
 * today. The team works to UK time, so resolve the date there and let the client adopt it.
 */
function todayInUk(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
}

/**
 * The timesheet's first paint, resolved on the server.
 *
 * This used to be a server action fired from a `useEffect`, which meant the browser had to
 * download and hydrate the page bundle before it could even ask for data, then pay a
 * round trip to Vercel (and a second middleware auth check) on top of the queries. Fetching
 * here streams the data with the HTML instead.
 */
async function TimeTrackingContent() {
  const date = todayInUk()
  const month = parseISO(date)

  // A month at a time, matching how the client caches entries: day navigation within the
  // month is then a client-side slice rather than another request.
  const result = await getTimeTrackingBootstrap({
    boardType: 'main',
    startDate: format(startOfMonth(month), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(month), 'yyyy-MM-dd'),
  })

  if ('error' in result) {
    // The dashboard layout normally catches this first, but a session that expires between
    // the layout's check and this fetch lands here. Match the layout rather than rendering
    // an empty timesheet to someone who is no longer signed in.
    if (result.error === 'Not authenticated') {
      redirect('/auth/login')
    }

    // A data error: render the page empty rather than blank, so the board tabs, sync and
    // date navigation still work and a refresh may well succeed.
    console.error('Error loading time tracking:', result.error)
  } else {
    if (result.projectsError) {
      console.error('Error loading projects:', result.projectsError)
    }
    if (result.entriesError) {
      console.error('Error loading time entries:', result.entriesError)
    }
  }

  const initial: TimeTrackingInitialData = {
    date,
    isAdmin: 'isAdmin' in result ? Boolean(result.isAdmin) : false,
    users: 'users' in result ? (result.users as TimeTrackingInitialData['users']) : [],
    projects: 'projects' in result ? (result.projects as TimeTrackingInitialData['projects']) : [],
    monthEntries:
      'entries' in result ? (result.entries as TimeTrackingInitialData['monthEntries']) : [],
  }

  return <TimeTrackingClient initial={initial} />
}

export default function TimeTrackingPage() {
  return (
    <Suspense fallback={<TimeTrackingSkeleton />}>
      <TimeTrackingContent />
    </Suspense>
  )
}
