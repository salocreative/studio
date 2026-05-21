'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Plus, Trash2, Loader2, Edit2, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  getThankYouClients,
  createThankYouClient,
  updateThankYouClient,
  deleteThankYouClient,
  setThankYouClientPublished,
  type ThankYouClient,
  type ThankYouClientInput,
} from '@/app/actions/thank-you-clients'

const THANK_YOU_BASE_URL = 'https://thankyou.salo.uk/thank-you'

function getThankYouPageUrl(slug: string) {
  return `${THANK_YOU_BASE_URL}/${slug}`
}

function personalMessageToParagraphs(value: ThankYouClient['personal_message']): string[] {
  if (Array.isArray(value)) return value.length > 0 ? value : ['']
  if (typeof value === 'string' && value.trim()) return [value]
  return ['']
}

function emptyFormState(): ThankYouClientInput {
  return {
    slug: '',
    client_name: '',
    recipient_names: '',
    project_description: '',
    personal_message: [''],
    team_video_presenters: null,
    team_video_url: null,
    team_video_placeholder_text: null,
    show_upsell: true,
    referral_action_description: null,
    upsell_heading: null,
    upsell_description: null,
    upsell_button_text: null,
    published: false,
  }
}

function clientToFormState(client: ThankYouClient): ThankYouClientInput {
  return {
    slug: client.slug,
    client_name: client.client_name,
    recipient_names: client.recipient_names,
    project_description: client.project_description,
    personal_message: personalMessageToParagraphs(client.personal_message),
    team_video_presenters: client.team_video_presenters,
    team_video_url: client.team_video_url,
    team_video_placeholder_text: client.team_video_placeholder_text,
    show_upsell: client.show_upsell,
    referral_action_description: client.referral_action_description,
    upsell_heading: client.upsell_heading,
    upsell_description: client.upsell_description,
    upsell_button_text: client.upsell_button_text,
    published: client.published,
  }
}

export function ThankYouClientsForm() {
  const [clients, setClients] = useState<ThankYouClient[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<ThankYouClient | null>(null)
  const [form, setForm] = useState<ThankYouClientInput>(emptyFormState())
  const [saving, setSaving] = useState(false)
  const [togglingPublished, setTogglingPublished] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ThankYouClient | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    try {
      const result = await getThankYouClients()
      if (result.error) {
        toast.error('Error loading thank-you pages', { description: result.error })
      } else if (result.success && result.clients) {
        setClients(result.clients)
      }
    } catch (error) {
      console.error('Error loading thank you clients:', error)
      toast.error('Failed to load thank-you pages')
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditingClient(null)
    setForm(emptyFormState())
    setFormOpen(true)
  }

  function openEdit(client: ThankYouClient) {
    setEditingClient(client)
    setForm(clientToFormState(client))
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingClient(null)
    setForm(emptyFormState())
  }

  function updateField<K extends keyof ThankYouClientInput>(key: K, value: ThankYouClientInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateParagraph(index: number, value: string) {
    setForm((prev) => {
      const next = [...prev.personal_message]
      next[index] = value
      return { ...prev, personal_message: next }
    })
  }

  function addParagraph() {
    setForm((prev) => ({ ...prev, personal_message: [...prev.personal_message, ''] }))
  }

  function removeParagraph(index: number) {
    setForm((prev) => {
      if (prev.personal_message.length <= 1) return prev
      return {
        ...prev,
        personal_message: prev.personal_message.filter((_, i) => i !== index),
      }
    })
  }

  function moveParagraph(index: number, direction: -1 | 1) {
    setForm((prev) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= prev.personal_message.length) return prev
      const next = [...prev.personal_message]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return { ...prev, personal_message: next }
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const result = editingClient
        ? await updateThankYouClient(editingClient.id, form)
        : await createThankYouClient(form)

      if (result.error) {
        toast.error(editingClient ? 'Error updating page' : 'Error creating page', {
          description: result.error,
        })
      } else {
        toast.success(editingClient ? 'Thank-you page updated' : 'Thank-you page created')
        closeForm()
        await loadClients()
      }
    } catch (error) {
      console.error('Error saving thank you client:', error)
      toast.error('Failed to save thank-you page')
    } finally {
      setSaving(false)
    }
  }

  async function handleTogglePublished(client: ThankYouClient, published: boolean) {
    setTogglingPublished(client.id)
    try {
      const result = await setThankYouClientPublished(client.id, published)
      if (result.error) {
        toast.error('Error updating published status', { description: result.error })
      } else {
        setClients((prev) =>
          prev.map((c) => (c.id === client.id ? { ...c, published } : c))
        )
      }
    } catch (error) {
      console.error('Error toggling published:', error)
      toast.error('Failed to update published status')
    } finally {
      setTogglingPublished(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      const result = await deleteThankYouClient(deleteTarget.id)
      if (result.error) {
        toast.error('Error deleting page', { description: result.error })
      } else {
        toast.success('Thank-you page deleted')
        setDeleteTarget(null)
        await loadClients()
      }
    } catch (error) {
      console.error('Error deleting thank you client:', error)
      toast.error('Failed to delete thank-you page')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Thank-You Pages</CardTitle>
              <CardDescription>
                Manage personalised client thank-you pages. Each entry maps to a URL slug on the
                thank-you site (e.g. /provenant).
              </CardDescription>
            </div>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              New page
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : clients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No thank-you pages yet. Create one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-mono text-sm">{client.slug}</TableCell>
                    <TableCell className="font-medium">{client.client_name}</TableCell>
                    <TableCell>{client.recipient_names}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={client.published}
                          disabled={togglingPublished === client.id}
                          onCheckedChange={(checked) => handleTogglePublished(client, checked)}
                        />
                        <Badge variant={client.published ? 'default' : 'secondary'}>
                          {client.published ? 'Published' : 'Draft'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            window.open(getThankYouPageUrl(client.slug), '_blank', 'noopener,noreferrer')
                          }
                          className="h-8 w-8"
                          title="View thank-you page"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(client)}
                          className="h-8 w-8"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(client)}
                          className="text-destructive hover:text-destructive h-8 w-8"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingClient ? 'Edit Thank-You Page' : 'New Thank-You Page'}</DialogTitle>
            <DialogDescription>
              {editingClient
                ? `Update content for ${editingClient.client_name}`
                : 'Create a new personalised thank-you page'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ty-slug">Slug</Label>
                <Input
                  id="ty-slug"
                  value={form.slug}
                  onChange={(e) => updateField('slug', e.target.value.toLowerCase())}
                  placeholder="provenant"
                  disabled={!!editingClient}
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, numbers, and hyphens only. Cannot be changed after creation.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ty-client-name">Client name</Label>
                <Input
                  id="ty-client-name"
                  value={form.client_name}
                  onChange={(e) => updateField('client_name', e.target.value)}
                  placeholder="Provenant"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ty-recipients">Recipient names</Label>
              <Input
                id="ty-recipients"
                value={form.recipient_names}
                onChange={(e) => updateField('recipient_names', e.target.value)}
                placeholder="Kai, Kate"
              />
              <p className="text-xs text-muted-foreground">
                Shown in the page heading, e.g. &quot;Kai, Kate — it&apos;s been a real pleasure.&quot;
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ty-project">Project description</Label>
              <Input
                id="ty-project"
                value={form.project_description}
                onChange={(e) => updateField('project_description', e.target.value)}
                placeholder="Provenant brand and website"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Personal message</Label>
                <Button type="button" variant="outline" size="sm" onClick={addParagraph}>
                  <Plus className="mr-1 h-3 w-3" />
                  Add paragraph
                </Button>
              </div>
              <div className="space-y-3">
                {form.personal_message.map((paragraph, index) => (
                  <div key={index} className="flex gap-2">
                    <Textarea
                      value={paragraph}
                      onChange={(e) => updateParagraph(index, e.target.value)}
                      placeholder={`Paragraph ${index + 1}`}
                      rows={3}
                      className="flex-1"
                    />
                    <div className="flex flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={index === 0}
                        onClick={() => moveParagraph(index, -1)}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={index === form.personal_message.length - 1}
                        onClick={() => moveParagraph(index, 1)}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        disabled={form.personal_message.length <= 1}
                        onClick={() => removeParagraph(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <Label className="text-base">Team video</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Set presenter names to show the team video section. Add a Vimeo ID when the
                  recording is ready, or leave it blank to show a placeholder.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ty-presenters">Presenter names</Label>
                <Input
                  id="ty-presenters"
                  value={form.team_video_presenters ?? ''}
                  onChange={(e) => updateField('team_video_presenters', e.target.value || null)}
                  placeholder="Carl & Toby"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to hide the team video section entirely.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ty-video">Vimeo video ID</Label>
                <Input
                  id="ty-video"
                  value={form.team_video_url ?? ''}
                  onChange={(e) => updateField('team_video_url', e.target.value || null)}
                  placeholder="123456789"
                />
                <p className="text-xs text-muted-foreground">
                  Vimeo ID only, not the full URL. When blank but presenters are set, the page shows
                  a placeholder until the video is ready.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ty-video-placeholder">Placeholder text</Label>
                <Input
                  id="ty-video-placeholder"
                  value={form.team_video_placeholder_text ?? ''}
                  onChange={(e) =>
                    updateField('team_video_placeholder_text', e.target.value || null)
                  }
                  placeholder="Message coming shortly"
                />
                <p className="text-xs text-muted-foreground">
                  Subtext shown under presenter names while the video is not ready. Defaults to
                  &quot;Message coming shortly&quot; on the site if left blank.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="ty-show-upsell">Show Flexi-Design upsell</Label>
                <p className="text-xs text-muted-foreground">
                  Display the Flexi-Design credit packs section on this page
                </p>
              </div>
              <Switch
                id="ty-show-upsell"
                checked={form.show_upsell}
                onCheckedChange={(checked) => updateField('show_upsell', checked)}
              />
            </div>

            <Accordion type="single" collapsible>
              <AccordionItem value="overrides" className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  Overrides
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
                  <p className="text-xs text-muted-foreground">
                    Optional copy overrides. Leave blank to use the default thank-you page text.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="ty-referral">Referral action description</Label>
                    <Textarea
                      id="ty-referral"
                      value={form.referral_action_description ?? ''}
                      onChange={(e) =>
                        updateField('referral_action_description', e.target.value || null)
                      }
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ty-upsell-heading">Upsell heading</Label>
                    <Input
                      id="ty-upsell-heading"
                      value={form.upsell_heading ?? ''}
                      onChange={(e) => updateField('upsell_heading', e.target.value || null)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ty-upsell-description">Upsell description</Label>
                    <Textarea
                      id="ty-upsell-description"
                      value={form.upsell_description ?? ''}
                      onChange={(e) => updateField('upsell_description', e.target.value || null)}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ty-upsell-button">Upsell button text</Label>
                    <Input
                      id="ty-upsell-button"
                      value={form.upsell_button_text ?? ''}
                      onChange={(e) => updateField('upsell_button_text', e.target.value || null)}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="ty-published">Published</Label>
                <p className="text-xs text-muted-foreground">
                  Only published pages are visible on the thank-you site
                </p>
              </div>
              <Switch
                id="ty-published"
                checked={form.published}
                onCheckedChange={(checked) => updateField('published', checked)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingClient ? 'Save changes' : 'Create page'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete thank-you page</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the page for{' '}
              <span className="font-medium">{deleteTarget?.client_name}</span> (
              <span className="font-mono">{deleteTarget?.slug}</span>)? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
