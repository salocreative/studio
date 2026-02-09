'use client'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useState } from 'react'

type SyncProgressEvent =
  | { phase: 'fetching'; message: string; progress: number }
  | { phase: 'checking'; message: string; progress: number }
  | { phase: 'syncing'; message: string; projectIndex: number; totalProjects: number; projectName: string; progress: number }
  | { phase: 'complete'; message: string; progress: number; projectsSynced: number; archived: number; deleted: number }
  | { phase: 'error'; message: string }

export function SyncButton() {
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<{ message: string; error?: string } | null>(null)

  async function handleSync() {
    setIsLoading(true)
    setProgress(0)
    setStatus('')
    setResult(null)

    try {
      const res = await fetch('/api/sync/monday', { method: 'POST', credentials: 'include' })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Sync failed (${res.status})`)
      }

      const reader = res.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: SyncProgressEvent = JSON.parse(line.slice(6))
              setStatus(event.message)
              if (event.phase === 'syncing') {
                setProgress(Math.round(event.progress * 100))
              } else if (event.phase === 'complete') {
                setProgress(100)
                const messages = [`Synced ${event.projectsSynced} projects`]
                if (event.archived > 0) messages.push(`${event.archived} archived`)
                if (event.deleted > 0) messages.push(`${event.deleted} deleted`)
                setResult({ message: messages.join(', ') + ' from Monday.com' })
                window.location.reload()
              } else if (event.phase === 'error') {
                setResult({ message: event.message, error: event.message })
              } else {
                setProgress(Math.round(event.progress * 100))
              }
            } catch {
              // Ignore parse errors for malformed chunks
            }
          }
        }
      }

      if (!result) {
        setResult({ message: 'Sync completed' })
        window.location.reload()
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'An unexpected error occurred'
      setResult({ message: msg, error: msg })
      setStatus('')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-w-[200px] flex-col items-end gap-2">
      <Button onClick={handleSync} disabled={isLoading}>
        {isLoading ? 'Syncing...' : 'Sync Now'}
      </Button>
      {isLoading && (
        <div className="w-full space-y-1">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground">{status}</p>
        </div>
      )}
      {result && !isLoading && (
        <p className={`w-full text-sm ${result.error ? 'text-destructive' : 'text-muted-foreground'}`}>
          {result.message}
        </p>
      )}
    </div>
  )
}
