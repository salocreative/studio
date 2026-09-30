'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  createProjectInvoice,
  getProjectBillingProgress,
  type ProjectBillingProgressResult,
} from '@/app/actions/invoices'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatGbp } from '@/lib/billing/invoices'

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10
  if (rounded === 0 && hours > 0) return `${hours.toFixed(1)}h`
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}h`
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const percent = value * 100
  const rounded = Math.round(percent * 10) / 10
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

export function JobWorkProgress({
  projectId,
  enabled,
  refreshKey,
  onAdded,
  hideIntro,
}: {
  projectId: string
  enabled: boolean
  refreshKey?: string | number
  onAdded?: () => void | Promise<void>
  hideIntro?: boolean
}) {
  const [progress, setProgress] = useState<ProjectBillingProgressResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    void getProjectBillingProgress(projectId)
      .then((result) => {
        if (cancelled) return
        if (result.error || !('monthLabel' in result)) {
          toast.error('Could not load sub-items', { description: result.error })
          setProgress(null)
        } else {
          setProgress(result)
        }
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Error loading billing progress:', error)
        toast.error('Could not load sub-items')
        setProgress(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, projectId, refreshKey])

  const completedCount = useMemo(
    () => progress?.tasks.filter((task) => task.isCompleted === true).length ?? 0,
    [progress]
  )

  async function handleAddSuggested() {
    if (!progress || progress.suggestedAmount <= 0.009) return
    setAdding(true)
    try {
      const result = await createProjectInvoice(projectId, {
        label: progress.monthLabel,
        amount: progress.suggestedAmount,
        status: 'need_invoicing',
        notes: progress.suggestedNotes || null,
      })
      if (result.error) {
        toast.error('Could not add invoice', { description: result.error })
      } else {
        toast.success(`Added ${progress.monthLabel} for ${formatGbp(progress.suggestedAmount)}`)
        await onAdded?.()
      }
    } finally {
      setAdding(false)
    }
  }

  if (!enabled) return null

  return (
    <div className="space-y-3">
      {hideIntro ? null : (
        <div>
          <h3 className="text-sm font-semibold">Work</h3>
          <p className="text-xs text-muted-foreground">
            Suggested invoice is completed quoted hours as a share of the quote, minus what is already
            invoiced. Completed sub-items are listed on the invoice and sent to Xero as line items.
          </p>
        </div>
      )}

      {loading && !progress ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sub-items
        </div>
      ) : !progress || progress.tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Monday sub-items on this job yet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Completed</dt>
              <dd className="mt-0.5 font-medium tabular-nums">
                {formatHours(progress.completedQuotedHours)} of {formatHours(progress.totalQuotedHours)}
                {progress.completedPercent != null ? ` · ${formatPercent(progress.completedPercent)}` : ''}
              </dd>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Earned</dt>
              <dd className="mt-0.5 font-medium tabular-nums">
                {progress.earned != null ? formatGbp(progress.earned) : '—'}
              </dd>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Logged this month</dt>
              <dd className="mt-0.5 font-medium tabular-nums">
                {formatHours(progress.loggedHoursThisMonth)}
              </dd>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Logged all time</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{formatHours(progress.loggedHours)}</dd>
            </div>
          </dl>

          {progress.invoicedAhead ? (
            <p className="text-sm text-muted-foreground">
              Invoiced is ahead of completed work, so nothing extra is suggested.
            </p>
          ) : !progress.canRecommend ? (
            <p className="text-sm text-muted-foreground">
              Add a quote value and quoted hours on sub-items to recommend an amount.
            </p>
          ) : progress.suggestedAmount > 0.009 ? (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleAddSuggested()}
                disabled={adding}
              >
                {adding ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-4 w-4" />
                )}
                Add invoice for {formatGbp(progress.suggestedAmount)}
              </Button>
              {progress.suggestedNotes ? (
                <p className="whitespace-pre-line text-xs text-muted-foreground">
                  {`Includes:\n${progress.suggestedNotes}`}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Completed work is already covered by invoices.
            </p>
          )}

          <ul className="divide-y rounded-lg border">
            {progress.tasks.map((task) => (
              <li key={task.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{task.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Quoted {task.quotedHours > 0 ? formatHours(task.quotedHours) : '—'}
                    {' · '}
                    Logged {formatHours(task.loggedHours)}
                    {task.loggedHoursThisMonth > 0
                      ? ` · ${formatHours(task.loggedHoursThisMonth)} this month`
                      : ''}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 font-medium">
                  {task.isCompleted === true
                    ? 'Completed'
                    : task.isCompleted === false
                      ? 'Open'
                      : 'No status'}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {completedCount} of {progress.tasks.length} sub-item
            {progress.tasks.length === 1 ? '' : 's'} completed
          </p>
        </>
      )}
    </div>
  )
}
