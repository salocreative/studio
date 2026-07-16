'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, Loader2, ScrollText, ExternalLink, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteSowDocument, getSowDocuments, type SowDocument, type SowStatus } from '@/app/actions/sow'
import { getClientApprovalStatus } from '@/lib/sow/status'
import { cn } from '@/lib/utils'

const STATUS_TABS: { value: SowStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Declined' },
  { value: 'archived', label: 'Archived' },
]

function approvalBadgeClass(tone: ReturnType<typeof getClientApprovalStatus>['tone']) {
  switch (tone) {
    case 'success':
      return 'bg-green-600'
    case 'warning':
      return 'bg-amber-500 text-white'
    default:
      return ''
  }
}

function formatMoney(value: number) {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function SowListPage() {
  const [documents, setDocuments] = useState<SowDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<SowStatus>('draft')

  useEffect(() => {
    loadDocuments()
  }, [])

  async function loadDocuments() {
    setLoading(true)
    try {
      const result = await getSowDocuments()
      if (result.error) {
        toast.error('Error loading statements of work', { description: result.error })
      } else if (result.documents) {
        setDocuments(result.documents)
      }
    } catch (error) {
      console.error('Error loading SoW list:', error)
      toast.error('Failed to load statements of work')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(doc: SowDocument) {
    const message =
      doc.status === 'approved'
        ? `Permanently delete "${doc.title}"? This approved SoW will be removed and cannot be recovered.`
        : `Permanently delete "${doc.title}"? This cannot be undone.`

    if (!confirm(message)) return

    const result = await deleteSowDocument(doc.id)
    if (result.error) {
      toast.error('Error deleting', { description: result.error })
    } else {
      toast.success('Statement of work deleted')
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
    }
  }

  const counts = useMemo(() => {
    const next: Record<SowStatus, number> = {
      draft: 0,
      sent: 0,
      approved: 0,
      rejected: 0,
      archived: 0,
    }
    for (const doc of documents) {
      next[doc.status] = (next[doc.status] || 0) + 1
    }
    return next
  }, [documents])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ScrollText className="h-7 w-7" />
            Statements of Work
          </h1>
          <p className="text-muted-foreground mt-1">
            Create scoped work documents with tasks, time, and costs — then share with clients for approval.
          </p>
        </div>
        <Button asChild>
          <Link href="/sow/new">
            <Plus className="mr-2 h-4 w-4" />
            New SoW
          </Link>
        </Button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as SowStatus)}
        className="w-full"
      >
        <TabsList className="mb-6 flex h-auto w-full flex-wrap justify-start gap-1">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
              {tab.label}
              {counts[tab.value] > 0 && (
                <Badge variant="secondary" className="ml-0">
                  {counts[tab.value]}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {STATUS_TABS.map((tab) => {
          const tabDocuments = documents.filter((doc) => doc.status === tab.value)
          return (
            <TabsContent key={tab.value} value={tab.value} className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>{tab.label}</CardTitle>
                  <CardDescription>
                    {tab.value === 'draft' && 'SoWs still being prepared'}
                    {tab.value === 'sent' && 'Shared with the client and awaiting approval'}
                    {tab.value === 'approved' && 'Approved by the client'}
                    {tab.value === 'rejected' && 'Declined by the client'}
                    {tab.value === 'archived' && 'Archived statements of work'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : tabDocuments.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <p className="mb-4">No {tab.label.toLowerCase()} statements of work.</p>
                      {tab.value === 'draft' && (
                        <Button asChild variant="outline">
                          <Link href="/sow/new">Create your first SoW</Link>
                        </Button>
                      )}
                    </div>
                  ) : (
                    <SowTable documents={tabDocuments} onDelete={handleDelete} />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}

function SowTable({
  documents,
  onDelete,
}: {
  documents: SowDocument[]
  onDelete: (doc: SowDocument) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Client approval</TableHead>
          <TableHead>Monday</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Hours</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => {
          const approval = getClientApprovalStatus(doc.status, doc)
          return (
            <TableRow key={doc.id}>
              <TableCell className="font-medium">{doc.title}</TableCell>
              <TableCell>
                {doc.agency_name ? (
                  <span>
                    <span className="text-muted-foreground">{doc.agency_name}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    {doc.client_name}
                  </span>
                ) : (
                  doc.client_name
                )}
              </TableCell>
              <TableCell>
                <Badge
                  variant={approval.tone === 'destructive' ? 'destructive' : 'secondary'}
                  className={cn(approvalBadgeClass(approval.tone))}
                >
                  {approval.label}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {doc.monday_project_id || doc.monday_item_id
                  ? 'Linked'
                  : doc.pushed_to_monday_at
                    ? 'Pushed'
                    : '—'}
              </TableCell>
              <TableCell className="text-right">{formatMoney(Number(doc.total_gbp))}</TableCell>
              <TableCell className="text-right">{Number(doc.total_hours).toFixed(1)}h</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {new Date(doc.updated_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/sow/${doc.id}`}>
                      <ExternalLink className="mr-1 h-4 w-4" />
                      Open
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(doc)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
