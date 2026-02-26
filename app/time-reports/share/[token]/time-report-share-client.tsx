'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Loader2, FileText, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { getTimeReportByToken, type ClientTimeEntry } from '@/app/actions/client-time-report'

interface TimeReportShareClientProps {
  shareToken: string
}

export default function TimeReportShareClient({ shareToken }: TimeReportShareClientProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string>('')
  const [entries, setEntries] = useState<ClientTimeEntry[]>([])
  const [totalHours, setTotalHours] = useState(0)

  async function loadReport() {
    setLoading(true)
    setError(null)
    const result = await getTimeReportByToken(shareToken)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      setClientName('')
      setEntries([])
      setTotalHours(0)
      return
    }
    setClientName(result.clientName ?? '')
    setEntries(result.entries ?? [])
    setTotalHours(result.totalHours ?? 0)
  }

  useEffect(() => {
    loadReport()
  }, [shareToken])

  if (loading && !clientName) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading time report…</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Unable to load report</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Time report — {clientName}
              </CardTitle>
              <CardDescription>
                Live report · Data is current as of when you opened or refreshed this page
              </CardDescription>
            </div>
            <button
              onClick={() => loadReport()}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Refresh report"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm font-medium">
              {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · Total: <strong>{totalHours.toFixed(1)}h</strong>
            </p>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Designer</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No time entries for this client yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>{format(new Date(e.date), 'd MMM yyyy')}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2 flex-wrap">
                            {e.project_name}
                            {e.is_flexi && <Badge variant="secondary" className="text-xs">Flexi</Badge>}
                            {(e.project_status === 'locked' || e.project_status === 'archived') && (
                              <Badge variant="outline" className="text-xs">Completed</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>{e.task_name}</TableCell>
                        <TableCell>{e.user_name || e.user_email || '—'}</TableCell>
                        <TableCell className="text-right">{e.hours}h</TableCell>
                        <TableCell className="max-w-[200px] truncate text-muted-foreground" title={e.notes || undefined}>
                          {e.notes || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
