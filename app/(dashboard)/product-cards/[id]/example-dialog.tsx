'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteProductCardExample,
  saveProductCardExample,
  type ProductCardExample,
} from '@/app/actions/product-cards'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { EXAMPLE_KIND_LABELS, EXAMPLE_KINDS, type ExampleKind } from '@/lib/product-cards/model'
import { uploadProductCardAsset } from '@/lib/product-cards/upload'

export function ExampleDialog({
  cardId,
  example,
  open,
  onOpenChange,
  onSaved,
}: {
  cardId: string
  example: ProductCardExample | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (warning: string | null) => void
}) {
  const [kind, setKind] = useState<ExampleKind>('image')
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [url, setUrl] = useState('')
  const [caseStudyPath, setCaseStudyPath] = useState('')
  const [storagePath, setStoragePath] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [signoff, setSignoff] = useState(false)
  const [signoffNote, setSignoffNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setKind(example?.kind ?? 'image')
    setTitle(example?.title ?? '')
    setCaption(example?.caption ?? '')
    setCompanyName(example?.company_name ?? '')
    setUrl(example?.url ?? '')
    setCaseStudyPath(example?.case_study_path ?? '')
    setStoragePath(example?.storage_path ?? null)
    setFile(null)
    setFileInputKey((key) => key + 1)
    setSignoff(Boolean(example?.signoff_at))
    setSignoffNote(example?.signoff_note ?? '')
  }, [open, example])

  async function save() {
    setSaving(true)
    try {
      let nextPath = storagePath
      if (file) {
        nextPath = await uploadProductCardAsset(cardId, file)
      }
      const result = await saveProductCardExample({
        id: example?.id,
        card_id: cardId,
        kind,
        title,
        caption,
        storage_path: nextPath,
        url,
        company_name: companyName,
        case_study_path: caseStudyPath,
        signoff,
        signoff_note: signoffNote,
      })
      if ('error' in result && result.error) {
        toast.error('Could not save the example', { description: result.error })
        return
      }
      if (!('success' in result)) return
      toast.success(signoff ? 'Example signed off' : 'Example saved')
      onOpenChange(false)
      onSaved(result.revalidateWarning)
    } catch (error) {
      toast.error('Could not save the example', {
        description: error instanceof Error ? error.message : 'Upload failed',
      })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!example) return
    if (!window.confirm('Remove this example?')) return
    setSaving(true)
    try {
      const result = await deleteProductCardExample(example.id)
      if ('error' in result && result.error) {
        toast.error('Could not remove the example', { description: result.error })
        return
      }
      if (!('success' in result)) return
      toast.success('Example removed')
      onOpenChange(false)
      onSaved(result.revalidateWarning)
    } finally {
      setSaving(false)
    }
  }

  const needsCompany = kind === 'logo' || kind === 'quote'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{example ? 'Edit example' : 'Add example'}</DialogTitle>
          <DialogDescription>
            Unsigned examples stay off the public page. Logos and quotes also need the client’s name.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as ExampleKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXAMPLE_KINDS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {EXAMPLE_KIND_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="example-title">Title</Label>
            <Input id="example-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="example-caption">{kind === 'quote' ? 'Quote' : 'Caption'}</Label>
            <Textarea
              id="example-caption"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="example-company">Client {needsCompany ? '' : '(optional)'}</Label>
            <Input
              id="example-company"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Company name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="example-file">File</Label>
            <Input
              id="example-file"
              key={fileInputKey}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,video/mp4,video/webm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {storagePath && !file && (
              <p className="text-xs text-muted-foreground">A file is already attached.</p>
            )}
            {(storagePath || file) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStoragePath(null)
                  setFile(null)
                  setFileInputKey((key) => key + 1)
                }}
              >
                Remove file
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="example-url">Link (optional)</Label>
            <Input
              id="example-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="example-case">Case study path (optional)</Label>
            <Input
              id="example-case"
              value={caseStudyPath}
              onChange={(event) => setCaseStudyPath(event.target.value)}
              placeholder="case-studies/projects/…"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div>
              <Label htmlFor="example-signoff">Signed off for the public page</Label>
              <p className="text-xs text-muted-foreground">
                {example?.signoff_name ? `Currently ${example.signoff_name}` : 'Not signed off yet'}
              </p>
            </div>
            <Switch id="example-signoff" checked={signoff} onCheckedChange={setSignoff} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="example-note">Sign-off note</Label>
            <Textarea
              id="example-note"
              value={signoffNote}
              onChange={(event) => setSignoffNote(event.target.value)}
              placeholder="Where the permission was given"
            />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {example ? (
            <Button variant="ghost" onClick={() => void remove()} disabled={saving}>
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save example
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
