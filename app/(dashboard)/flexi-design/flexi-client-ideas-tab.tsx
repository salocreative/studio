'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Lightbulb, Plus, Trash2, Link as LinkIcon } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { checkCanManageFlexiAssets } from '@/app/actions/flexi-design-assets'
import {
  getFlexiDesignIdeasForClient,
  pushFlexiDesignIdea,
  deleteFlexiDesignIdea,
  type FlexiDesignIdea,
} from '@/app/actions/flexi-design-ideas'

type IdeaForm = {
  title: string
  summary: string
  deliverable: string
  goal: string
  creditEstimate: string
  slackThreadUrl: string
}

const emptyForm: IdeaForm = {
  title: '',
  summary: '',
  deliverable: '',
  goal: '',
  creditEstimate: '',
  slackThreadUrl: '',
}

export function FlexiClientIdeasTab({ clientId }: { clientId: string }) {
  const [ideas, setIdeas] = useState<FlexiDesignIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<IdeaForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [clientId])

  async function load() {
    setLoading(true)
    try {
      const [ideasResult, manageResult] = await Promise.all([
        getFlexiDesignIdeasForClient(clientId),
        checkCanManageFlexiAssets(),
      ])
      setCanManage(manageResult.canManage)
      if (ideasResult.error) {
        toast.error('Could not load ideas', { description: ideasResult.error })
        setIdeas([])
      } else {
        setIdeas(ideasResult.ideas || [])
      }
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setForm(emptyForm)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!canManage) return
    if (!form.title.trim()) {
      toast.error('Give the idea a title')
      return
    }
    setSaving(true)
    try {
      const creditEstimate = form.creditEstimate.trim()
        ? Number.parseFloat(form.creditEstimate)
        : null

      const result = await pushFlexiDesignIdea({
        clientId,
        title: form.title,
        summary: form.summary,
        deliverable: form.deliverable,
        goal: form.goal,
        creditEstimate: creditEstimate != null && !Number.isNaN(creditEstimate) ? creditEstimate : null,
        slackThreadUrl: form.slackThreadUrl || null,
      })

      if (result.error) {
        toast.error('Could not push idea', { description: result.error })
      } else {
        toast.success('Idea pushed to the client portal')
        setDialogOpen(false)
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(idea: FlexiDesignIdea) {
    if (!canManage) return
    if (!confirm(`Remove "${idea.title}" from the client portal? This can't be undone.`)) return
    setDeletingId(idea.id)
    try {
      const result = await deleteFlexiDesignIdea(idea.id)
      if (result.error) {
        toast.error('Could not remove idea', { description: result.error })
      } else {
        toast.success('Idea removed')
        setIdeas((prev) => prev.filter((i) => i.id !== idea.id))
      }
    } finally {
      setDeletingId(null)
    }
  }

  function formatDate(dateString: string): string {
    try {
      return format(parseISO(dateString), 'd MMM yyyy')
    } catch {
      return dateString
    }
  }

  function statusBadge(idea: FlexiDesignIdea) {
    if (idea.status === 'confirmed') {
      return <Badge className="bg-green-600 text-white hover:bg-green-600">Confirmed</Badge>
    }
    if (idea.status === 'declined') {
      return <Badge variant="outline">Declined</Badge>
    }
    return <Badge variant="secondary">Awaiting response</Badge>
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Ideas</CardTitle>
              <CardDescription>
                Finalised creative ideas pushed live to this client&apos;s portal. Draft and Team
                Review stages stay in the Drive backlog (clients/{'{Client}'}/ideas.md) — only
                push once an idea is genuinely finalised.
              </CardDescription>
            </div>
            {canManage && (
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" />
                Push idea
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : ideas.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <Lightbulb className="mx-auto mb-3 h-8 w-8 opacity-50" />
              <p>No ideas pushed yet</p>
              {canManage && (
                <p className="mt-1 text-sm">
                  Once an idea is Finalised in the Drive backlog, push it here so the client can
                  confirm or decline it.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {ideas.map((idea) => (
                <div key={idea.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{idea.title}</h3>
                        {statusBadge(idea)}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{idea.summary}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {idea.credit_estimate != null && (
                        <span className="text-sm font-semibold text-primary">
                          ~{Number(idea.credit_estimate).toFixed(1)}h
                        </span>
                      )}
                      {canManage && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Remove"
                          disabled={deletingId === idea.id}
                          onClick={() => void handleDelete(idea)}
                        >
                          {deletingId === idea.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    {idea.deliverable && (
                      <p>
                        <span className="text-muted-foreground">Deliverable: </span>
                        {idea.deliverable}
                      </p>
                    )}
                    {idea.goal && (
                      <p>
                        <span className="text-muted-foreground">Goal: </span>
                        {idea.goal}
                      </p>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                    <span>Pushed {formatDate(idea.pushed_at)}</span>
                    {idea.slack_thread_url && (
                      <a
                        href={idea.slack_thread_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        <LinkIcon className="h-3 w-3" />
                        Slack thread
                      </a>
                    )}
                  </div>

                  {idea.status !== 'pushed' && idea.decided_by_name && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {idea.status === 'confirmed' ? 'Confirmed' : 'Declined'} by{' '}
                      {idea.decided_by_name}
                      {idea.decided_at ? ` on ${formatDate(idea.decided_at)}` : ''}
                      {idea.decision_notes ? ` — "${idea.decision_notes}"` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Push an idea</DialogTitle>
            <DialogDescription>
              Only push ideas already Finalised in the Drive backlog — this goes straight to the
              client.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
            <div className="space-y-2">
              <Label htmlFor="idea-title">Title</Label>
              <Input
                id="idea-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="idea-summary">Summary</Label>
              <Textarea
                id="idea-summary"
                rows={3}
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="idea-deliverable">Deliverable</Label>
              <Textarea
                id="idea-deliverable"
                rows={2}
                value={form.deliverable}
                onChange={(e) => setForm((f) => ({ ...f, deliverable: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="idea-goal">Goal / objective</Label>
              <Textarea
                id="idea-goal"
                rows={2}
                value={form.goal}
                onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="idea-credits">Credit estimate</Label>
                <Input
                  id="idea-credits"
                  type="number"
                  step="0.5"
                  min="0"
                  value={form.creditEstimate}
                  onChange={(e) => setForm((f) => ({ ...f, creditEstimate: e.target.value }))}
                  placeholder="e.g. 4"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="idea-slack">Slack thread (optional)</Label>
                <Input
                  id="idea-slack"
                  value={form.slackThreadUrl}
                  onChange={(e) => setForm((f) => ({ ...f, slackThreadUrl: e.target.value }))}
                  placeholder="https://salocreative.slack.com/..."
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Push to client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
