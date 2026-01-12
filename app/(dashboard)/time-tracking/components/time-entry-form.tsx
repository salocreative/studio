'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Clock } from 'lucide-react'

interface Task {
  id: string
  name: string
  quoted_hours?: number | null
}

interface Project {
  id: string
  name: string
  client_name?: string | null
  status?: 'active' | 'archived' | 'locked'
}

interface TimeEntryFormProps {
  task: Task | null
  project: Project | null
  date: string
  onSuccess: () => void
  onCancel: () => void
  targetUserId?: string
}

export function TimeEntryForm({
  task,
  project,
  date,
  onSuccess,
  onCancel,
  targetUserId,
}: TimeEntryFormProps) {
  const [hours, setHours] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!task || !project) return null

  const isLocked = project.status === 'locked'

  const handleQuickAdd = (h: number) => {
    if (isLocked) return
    setHours(h.toString())
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (isLocked) {
      setError('Cannot log time to locked projects')
      setLoading(false)
      return
    }

    const hoursNum = parseFloat(hours)
    if (isNaN(hoursNum) || hoursNum <= 0) {
      setError('Please enter a valid number of hours')
      setLoading(false)
      return
    }

    try {
      const { createTimeEntry } = await import('@/app/actions/time-tracking')
      const result = await createTimeEntry(
        task.id,
        project.id,
        date,
        hoursNum,
        notes || undefined,
        targetUserId
      )

      if (result.error) {
        setError(result.error)
      } else {
        setHours('')
        setNotes('')
        onSuccess()
      }
    } catch (err) {
      setError('An error occurred while creating the time entry')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log Time</DialogTitle>
          <DialogDescription>
            Log time for <strong>{task.name}</strong> on{' '}
            <strong>{project.name}</strong>
            {isLocked && (
              <span className="block mt-2 text-destructive">
                This project is locked and cannot accept new time entries.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLocked ? (
          <div className="space-y-4">
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              This project has been completed and is locked. You cannot add new time entries to locked projects.
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={onCancel}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="hours">Hours *</Label>
            <Input
              id="hours"
              type="number"
              step="0.25"
              min="0.25"
              placeholder="0.00"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
              disabled={loading}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleQuickAdd(1)}
                disabled={loading}
              >
                1h
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleQuickAdd(3)}
                disabled={loading}
              >
                3h
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleQuickAdd(6)}
                disabled={loading}
              >
                6h
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about this time entry..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={loading}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              <Clock className="mr-2 h-4 w-4" />
              {loading ? 'Logging...' : 'Log Time'}
            </Button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

