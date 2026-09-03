import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** Widths vary per row so the placeholder reads as a list rather than a repeated stamp. */
const PROJECT_ROW_WIDTHS = ['w-1/3', 'w-1/2', 'w-2/5', 'w-1/4', 'w-1/3']

/**
 * Streamed while the server component resolves the timesheet's first paint.
 *
 * Mirrors the daily view's structure — page header, the dark date-navigation card, then the
 * project list — so the layout doesn't jump when the real content arrives.
 */
export function TimeTrackingSkeleton() {
  return (
    <div className="flex flex-col h-full" aria-busy="true" aria-label="Loading time tracking">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-2xl font-semibold">Time Tracking</h1>
            <p className="text-sm text-muted-foreground">Track your time against projects</p>
          </div>
          <div className="flex items-center gap-2 animate-pulse">
            <div className="h-9 w-20 rounded-md bg-muted" />
            <div className="h-9 w-24 rounded-md bg-muted" />
            <div className="h-9 w-9 rounded-md bg-muted" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6 animate-pulse">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="h-6 w-64 rounded bg-slate-800" />
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-md bg-slate-800" />
                  <div className="h-9 w-16 rounded-md bg-slate-800" />
                  <div className="h-9 w-9 rounded-md bg-slate-800" />
                </div>
              </div>
              <div className="h-4 w-80 rounded bg-slate-800" />
            </CardHeader>
            <CardContent>
              <div className="h-20 rounded-lg bg-slate-800/60" />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 py-8">
              {PROJECT_ROW_WIDTHS.map((width, i) => (
                <div key={i} className="border rounded-lg overflow-hidden">
                  <div className="w-full px-4 py-3 flex items-center justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className={cn('h-4 rounded bg-muted', width)} />
                      <div className="h-3 w-1/4 rounded bg-muted" />
                      <div className="h-3 w-1/5 rounded bg-muted" />
                    </div>
                    <div className="h-5 w-16 rounded-full bg-muted shrink-0" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
