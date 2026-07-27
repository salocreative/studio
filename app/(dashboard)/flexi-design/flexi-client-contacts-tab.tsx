'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  checkCanManageFlexiAssets,
  createFlexiDesignContact,
  deleteFlexiDesignContact,
  getFlexiDesignContacts,
  updateFlexiDesignContact,
  type FlexiDesignContact,
} from '@/app/actions/flexi-design-assets'

type ContactForm = {
  name: string
  email: string
  role: string
  notes: string
}

const emptyForm: ContactForm = { name: '', email: '', role: '', notes: '' }

export function FlexiClientContactsTab({ clientId }: { clientId: string }) {
  const [contacts, setContacts] = useState<FlexiDesignContact[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<FlexiDesignContact | null>(null)
  const [form, setForm] = useState<ContactForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [clientId])

  async function load() {
    setLoading(true)
    try {
      const [contactsResult, manageResult] = await Promise.all([
        getFlexiDesignContacts(clientId),
        checkCanManageFlexiAssets(),
      ])
      setCanManage(manageResult.canManage)
      if (contactsResult.error) {
        toast.error('Could not load contacts', { description: contactsResult.error })
        setContacts([])
      } else {
        setContacts(contactsResult.contacts || [])
      }
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(contact: FlexiDesignContact) {
    setEditing(contact)
    setForm({
      name: contact.name,
      email: contact.email,
      role: contact.role || '',
      notes: contact.notes || '',
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!canManage) return
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role || null,
        notes: form.notes || null,
      }

      const result = editing
        ? await updateFlexiDesignContact(editing.id, payload)
        : await createFlexiDesignContact({ clientId, ...payload })

      if (result.error) {
        toast.error(editing ? 'Could not update contact' : 'Could not add contact', {
          description: result.error,
        })
      } else {
        toast.success(editing ? 'Contact updated' : 'Contact added')
        setDialogOpen(false)
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(contact: FlexiDesignContact) {
    if (!canManage) return
    if (!confirm(`Remove ${contact.name}?`)) return
    setDeletingId(contact.id)
    try {
      const result = await deleteFlexiDesignContact(contact.id)
      if (result.error) {
        toast.error('Could not delete contact', { description: result.error })
      } else {
        toast.success('Contact removed')
        setContacts((prev) => prev.filter((c) => c.id !== contact.id))
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Contacts</CardTitle>
              <CardDescription>
                People at this business for future emails and reminders.
              </CardDescription>
            </div>
            {canManage && (
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" />
                Add contact
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <Users className="mx-auto mb-3 h-8 w-8 opacity-50" />
              <p>No contacts yet</p>
              {canManage && (
                <p className="mt-1 text-sm">Add names and emails for outreach later.</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Notes</TableHead>
                  {canManage && <TableHead className="w-24 text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">{contact.name}</TableCell>
                    <TableCell>
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-sm text-primary hover:underline"
                      >
                        {contact.email}
                      </a>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{contact.role || '—'}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {contact.notes || '—'}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => openEdit(contact)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            disabled={deletingId === contact.id}
                            onClick={() => void handleDelete(contact)}
                          >
                            {deletingId === contact.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit contact' : 'Add contact'}</DialogTitle>
            <DialogDescription>
              Store a name and email for future automated messages.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="contact-name">Name</Label>
              <Input
                id="contact-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-role">Role / title</Label>
              <Input
                id="contact-role"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                placeholder="e.g. Marketing manager"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-notes">Notes</Label>
              <Textarea
                id="contact-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save' : 'Add contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
