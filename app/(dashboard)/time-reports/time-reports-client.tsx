'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, FileText, Share2, Copy, Check } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  getClientsWithTimeEntries,
  getProjectsByClientName,
  getUsersWithTimeForClient,
  getClientTimeEntries,
  createTimeReportShareLink,
  type ClientTimeEntry,
} from '@/app/actions/client-time-report'

type ProjectOption = { id: string; name: string; is_flexi: boolean; status: string }
type UserOption = { id: string; full_name: string | null; email: string | null }

export default function TimeReportsClient() {
  const [clients, setClients] = useState<string[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [entries, setEntries] = useState<ClientTimeEntry[]>([])
  const [totalHours, setTotalHours] = useState(0)
  const [loadingClients, setLoadingClients] = useState(true)
  const [loadingReport, setLoadingReport] = useState(false)
  const [selectedClient, setSelectedClient] = useState<string>('')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [creatingLink, setCreatingLink] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  useEffect(() => {
    if (!selectedClient) {
      setProjects([])
      setUsers([])
      setEntries([])
      setTotalHours(0)
      setSelectedProjectId('')
      setSelectedUserId('')
      return
    }
    loadProjectsAndUsers()
  }, [selectedClient])

  useEffect(() => {
    if (!selectedClient) {
      setEntries([])
      setTotalHours(0)
      return
    }
    loadReport()
  }, [selectedClient, selectedProjectId, selectedUserId, dateFrom, dateTo])

  useEffect(() => {
    if (!shareDialogOpen) {
      setShareUrl(null)
      setCopied(false)
    }
  }, [shareDialogOpen])

  async function loadClients() {
    setLoadingClients(true)
    const result = await getClientsWithTimeEntries()
    setLoadingClients(false)
    if (result.error) {
      toast.error(result.error)
      if (result.error.includes('Admin or manager')) setClients([])
      return
    }
    setClients(result.clients || [])
    if (result.clients?.length && !selectedClient) setSelectedClient(result.clients[0])
  }

  async function loadProjectsAndUsers() {
    if (!selectedClient) return
    const [projResult, userResult] = await Promise.all([
      getProjectsByClientName(selectedClient),
      getUsersWithTimeForClient(selectedClient),
    ])
    if (projResult.error) toast.error(projResult.error)
    else setProjects(projResult.projects || [])
    if (userResult.error) toast.error(userResult.error)
    else setUsers(userResult.users || [])
    setSelectedProjectId('')
    setSelectedUserId('')
  }

  async function loadReport() {
    if (!selectedClient) return
    setLoadingReport(true)
    const result = await getClientTimeEntries(selectedClient, {
      projectId: selectedProjectId || undefined,
      userId: selectedUserId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    })
    setLoadingReport(false)
    if (result.error) {
      toast.error(result.error)
      setEntries([])
      setTotalHours(0)
      return
    }
    setEntries(result.entries || [])
    setTotalHours(result.totalHours ?? 0)
  }

  async function handleCreateShareLink() {
    if (!selectedClient) return
    setCreatingLink(true)
    const result = await createTimeReportShareLink(selectedClient)
    setCreatingLink(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    if (result.shareToken) {
      const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/time-reports/share/${result.shareToken}`
      setShareUrl(url)
      toast.success('Share link created')
    }
  }

  async function handleCopyUrl() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      toast.success('Link copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy')
    }
  }

  const displayName = (u: UserOption) => u.full_name || u.email || 'Unknown'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Time Reports
        </CardTitle>
        <CardDescription>
          Select a client to see all time entries across active and completed projects (main board and Flexi-Design). Share a live report with the client.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-2">
            <Label>Client</Label>
            <Select
              value={selectedClient}
              onValueChange={setSelectedClient}
              disabled={loadingClients}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={loadingClients ? 'Loading…' : 'Select client'} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Project</Label>
            <Select
              value={selectedProjectId || 'all'}
              onValueChange={(v) => setSelectedProjectId(v === 'all' ? '' : v)}
              disabled={!selectedClient}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      {p.name}
                      {p.is_flexi && <Badge variant="secondary" className="text-xs">Flexi</Badge>}
                      {(p.status === 'locked' || p.status === 'archived') && (
                        <Badge variant="outline" className="text-xs">Completed</Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Designer</Label>
            <Select
              value={selectedUserId || 'all'}
              onValueChange={(v) => setSelectedUserId(v === 'all' ? '' : v)}
              disabled={!selectedClient}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All designers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All designers</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {displayName(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>From date</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              disabled={!selectedClient}
            />
          </div>
          <div className="space-y-2">
            <Label>To date</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              disabled={!selectedClient}
            />
          </div>
        </div>

        {!selectedClient && !loadingClients && (
          <p className="text-sm text-muted-foreground">Select a client to view time logs.</p>
        )}

        {selectedClient && (
          <>
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-sm font-medium">
                {loadingReport ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </span>
                ) : (
                  <>
                    {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · Total: <strong>{totalHours.toFixed(1)}h</strong>
                  </>
                )}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShareDialogOpen(true)}
                className="gap-2"
              >
                <Share2 className="h-4 w-4" />
                Share report
              </Button>
            </div>
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
                  {loadingReport ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                        Loading entries…
                      </TableCell>
                    </TableRow>
                  ) : entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No time entries match the filters.
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
          </>
        )}
      </CardContent>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share time report</DialogTitle>
            <DialogDescription>
              Create a link to share a live time report for <strong>{selectedClient}</strong>. Anyone with the link can view current data (no login required).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!shareUrl ? (
              <Button
                onClick={handleCreateShareLink}
                disabled={creatingLink}
                className="w-full gap-2"
              >
                {creatingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                Create share link
              </Button>
            ) : (
              <div className="space-y-2">
                <Label className="text-muted-foreground">Share link (live report)</Label>
                <div className="flex gap-2">
                  <Input readOnly value={shareUrl} className="font-mono text-sm" />
                  <Button variant="outline" size="icon" onClick={handleCopyUrl} title="Copy">
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The report updates automatically when the recipient opens the link.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
