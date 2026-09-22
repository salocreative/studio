'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { GitCompare, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  deleteCompletedProjects,
  reviewCompletedProjectsVsMonday,
  type CompletedMondayReview,
  type CompletedReviewLeftover,
} from '@/app/actions/projects'
import { cn } from '@/lib/utils'

function formatHours(hours: number) {
  return `${hours.toFixed(1)}h`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'd MMM yyyy')
  } catch {
    return value
  }
}

function HoursBadge({ hours }: { hours: number }) {
  if (hours <= 0) {
    return <span className="text-muted-foreground">No time</span>
  }

  return (
    <Badge
      variant="outline"
      className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400"
    >
      {formatHours(hours)} logged
    </Badge>
  )
}

function HeaderCheckbox({
  checked,
  indeterminate,
  disabled,
  ariaLabel,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  disabled?: boolean
  ariaLabel: string
  onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 accent-primary"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={onChange}
    />
  )
}

export function CompletedMondayReviewDialog({
  open,
  onOpenChange,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: (ids: string[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<CompletedMondayReview | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) {
      setConfirming(false)
      setSelectedIds(new Set())
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setReview(null)
    setSelectedIds(new Set())
    setConfirming(false)

    reviewCompletedProjectsVsMonday()
      .then((result) => {
        if (cancelled) return
        if (result.error) {
          setError(result.error)
          return
        }
        setReview(result.review || null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to review completed projects')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const leftovers = review?.leftovers ?? []
  const selectedLeftovers = useMemo(
    () => leftovers.filter((project) => selectedIds.has(project.id)),
    [leftovers, selectedIds]
  )
  const selectedHours = selectedLeftovers.reduce((sum, project) => sum + project.loggedHours, 0)
  const selectedWithTime = selectedLeftovers.filter((project) => project.loggedHours > 0).length
  const allSelected = leftovers.length > 0 && selectedLeftovers.length === leftovers.length
  const someSelected = selectedLeftovers.length > 0 && !allSelected
  const leftoversWithoutTime = leftovers.filter((project) => project.loggedHours <= 0)

  function toggleId(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds((current) => {
      if (allSelected) return new Set()
      const next = new Set(current)
      for (const project of leftovers) next.add(project.id)
      return next
    })
  }

  function selectWithoutTime() {
    setSelectedIds(new Set(leftoversWithoutTime.map((project) => project.id)))
    setConfirming(false)
  }

  async function handleDeleteSelected() {
    if (selectedLeftovers.length === 0) return
    setDeleting(true)
    try {
      const result = await deleteCompletedProjects(selectedLeftovers.map((project) => project.id))
      if (result.error) {
        toast.error('Could not delete projects', { description: result.error })
        return
      }
      const deletedIds = selectedLeftovers.map((project) => project.id)
      toast.success(
        `Deleted ${result.deleted} leftover project${result.deleted === 1 ? '' : 's'}`
      )
      onDeleted(deletedIds)
      setReview((current) =>
        current
          ? {
              ...current,
              leftovers: current.leftovers.filter((project) => !deletedIds.includes(project.id)),
              studioCount: Math.max(0, current.studioCount - deletedIds.length),
            }
          : current
      )
      setSelectedIds(new Set())
      setConfirming(false)
    } catch (err) {
      toast.error('Could not delete projects', {
        description: err instanceof Error ? err.message : 'Something went wrong',
      })
    } finally {
      setDeleting(false)
    }
  }

  const mismatchCount =
    (review?.leftovers.length || 0) +
    (review?.renamed.length || 0) +
    (review?.missing.length || 0) +
    (review?.elsewhere.length || 0)

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Review vs Monday</DialogTitle>
          <DialogDescription>
            Compares Studio completed jobs with the current Monday completed board. Leftovers can be
            deleted here; renamed jobs are updated by a sync.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning Monday completed boards...
          </div>
        ) : error ? (
          <p className="py-8 text-sm text-destructive">{error}</p>
        ) : review ? (
          <Tabs defaultValue="leftovers" className="min-h-0 flex-1 overflow-hidden">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="leftovers">
                Leftover in Studio ({review.leftovers.length})
              </TabsTrigger>
              <TabsTrigger value="renamed">Renamed ({review.renamed.length})</TabsTrigger>
              <TabsTrigger value="missing">On Monday only ({review.missing.length})</TabsTrigger>
              <TabsTrigger value="elsewhere">
                On another board ({review.elsewhere.length})
              </TabsTrigger>
            </TabsList>

            <p className="text-xs text-muted-foreground">
              {review.studioCount} completed jobs in Studio · {review.mondayItemCount} items on
              Monday completed boards
              {mismatchCount === 0 ? ' · no differences' : ''}
            </p>

            <TabsContent value="leftovers" className="min-h-0 overflow-y-auto">
              {leftovers.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Every completed job in Studio is still on Monday.
                </p>
              ) : (
                <LeftoverTable
                  leftovers={leftovers}
                  selectedIds={selectedIds}
                  allSelected={allSelected}
                  someSelected={someSelected}
                  onToggle={toggleId}
                  onToggleAll={toggleAll}
                />
              )}
            </TabsContent>

            <TabsContent value="renamed" className="min-h-0 overflow-y-auto">
              {review.renamed.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No name differences on jobs that still exist on Monday.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    These jobs still exist on Monday under a different name. A Quick Sync will
                    update Studio.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Studio name</TableHead>
                        <TableHead>Monday name</TableHead>
                        <TableHead>Client</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {review.renamed.map((project) => (
                        <TableRow key={project.id}>
                          <TableCell className="font-medium">{project.studioName}</TableCell>
                          <TableCell>{project.mondayName}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {project.clientName || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </TabsContent>

            <TabsContent value="missing" className="min-h-0 overflow-y-auto">
              {review.missing.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Monday’s completed board has no jobs that Studio is missing.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    These items are on Monday but not in Studio. Use Sync all Boards to pull them
                    in.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Monday name</TableHead>
                        <TableHead>Board</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {review.missing.map((item) => (
                        <TableRow key={item.mondayItemId}>
                          <TableCell className="font-medium">{item.mondayName}</TableCell>
                          <TableCell className="text-muted-foreground">{item.boardName}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </TabsContent>

            <TabsContent value="elsewhere" className="min-h-0 overflow-y-auto">
              {review.elsewhere.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No completed Studio jobs were found on a different Monday board.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    These are still on Monday, just not on the completed board. They are not
                    leftovers and should not be deleted.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Studio name</TableHead>
                        <TableHead>Monday name</TableHead>
                        <TableHead>Current board</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {review.elsewhere.map((project) => (
                        <TableRow key={project.id}>
                          <TableCell className="font-medium">{project.name}</TableCell>
                          <TableCell>{project.mondayName}</TableCell>
                          <TableCell className="text-muted-foreground">{project.boardName}</TableCell>
                          <TableCell>
                            <HoursBadge hours={project.loggedHours} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </TabsContent>
          </Tabs>
        ) : null}

        <DialogFooter className="shrink-0 border-t pt-4 sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {leftoversWithoutTime.length > 0 && leftoversWithoutTime.length < leftovers.length && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectWithoutTime}
                disabled={deleting || loading}
              >
                Select {leftoversWithoutTime.length} with no time
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {confirming ? (
              <>
                <p className="max-w-md text-sm text-muted-foreground">
                  Delete {selectedLeftovers.length} leftover
                  {selectedLeftovers.length === 1 ? '' : 's'}
                  {selectedWithTime > 0
                    ? `, including ${selectedWithTime} with time (${formatHours(selectedHours)})`
                    : ''}
                  ? This cannot be undone.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleDeleteSelected()}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete selected'}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirming(true)}
                  disabled={selectedLeftovers.length === 0 || deleting || loading}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete{selectedLeftovers.length > 0 ? ` ${selectedLeftovers.length}` : ''} selected
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeftoverTable({
  leftovers,
  selectedIds,
  allSelected,
  someSelected,
  onToggle,
  onToggleAll,
}: {
  leftovers: CompletedReviewLeftover[]
  selectedIds: Set<string>
  allSelected: boolean
  someSelected: boolean
  onToggle: (id: string) => void
  onToggleAll: () => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <HeaderCheckbox
              checked={allSelected}
              indeterminate={someSelected}
              ariaLabel="Select all leftover projects"
              onChange={onToggleAll}
            />
          </TableHead>
          <TableHead>Job</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Completed</TableHead>
          <TableHead>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leftovers.map((project) => {
          const selected = selectedIds.has(project.id)
          const hasTime = project.loggedHours > 0
          return (
            <TableRow
              key={project.id}
              data-state={selected ? 'selected' : undefined}
              className={cn('cursor-pointer', hasTime && 'bg-amber-500/5')}
              onClick={() => onToggle(project.id)}
            >
              <TableCell onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={selected}
                  aria-label={`Select ${project.name}`}
                  onChange={() => onToggle(project.id)}
                />
              </TableCell>
              <TableCell className="font-medium whitespace-normal">
                {project.name}
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-normal">
                {[project.clientName, project.agency].filter(Boolean).join(' · ') || '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(project.completedDate)}
              </TableCell>
              <TableCell>
                <HoursBadge hours={project.loggedHours} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function ReviewVsMondayButton({ onDeleted }: { onDeleted: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <GitCompare className="h-4 w-4" />
        Review vs Monday
      </Button>
      <CompletedMondayReviewDialog
        open={open}
        onOpenChange={setOpen}
        onDeleted={onDeleted}
      />
    </>
  )
}
