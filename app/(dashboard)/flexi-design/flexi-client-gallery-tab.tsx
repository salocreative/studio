'use client'

import { useEffect, useRef, useState } from 'react'
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
import { ImageIcon, Loader2, Pencil, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  checkCanManageFlexiAssets,
  createFlexiDesignGalleryItem,
  deleteFlexiDesignGalleryItem,
  getFlexiDesignGalleryItems,
  getFlexiDesignSignedUrls,
  updateFlexiDesignGalleryItem,
  type FlexiDesignGalleryItem,
} from '@/app/actions/flexi-design-assets'
import { buildFlexiDesignStoragePath } from '@/lib/flexi-design/storage'

const FLEXI_BUCKET = 'flexi-design'
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif'

export function FlexiClientGalleryTab({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<FlexiDesignGalleryItem[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [viewing, setViewing] = useState<FlexiDesignGalleryItem | null>(null)
  const [editing, setEditing] = useState<FlexiDesignGalleryItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editCaption, setEditCaption] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void load()
  }, [clientId])

  async function load() {
    setLoading(true)
    try {
      const [itemsResult, manageResult] = await Promise.all([
        getFlexiDesignGalleryItems(clientId),
        checkCanManageFlexiAssets(),
      ])
      setCanManage(manageResult.canManage)

      if (itemsResult.error) {
        toast.error('Could not load gallery', { description: itemsResult.error })
        setItems([])
        setUrls({})
        return
      }

      const nextItems = itemsResult.items || []
      setItems(nextItems)

      if (nextItems.length > 0) {
        const signed = await getFlexiDesignSignedUrls(nextItems.map((i) => i.storage_path))
        if (signed.urls) setUrls(signed.urls)
      } else {
        setUrls({})
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList?.length || !canManage) return
    setUploading(true)
    const supabase = createClient()

    try {
      for (const file of Array.from(fileList)) {
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} is not an image`)
          continue
        }

        const storagePath = buildFlexiDesignStoragePath(clientId, 'gallery', file.name)
        const { error: uploadError } = await supabase.storage
          .from(FLEXI_BUCKET)
          .upload(storagePath, file, {
            contentType: file.type || undefined,
            upsert: false,
          })

        if (uploadError) {
          toast.error(`Failed to upload ${file.name}`, { description: uploadError.message })
          continue
        }

        const result = await createFlexiDesignGalleryItem({
          clientId,
          storagePath,
          mimeType: file.type || null,
          fileSize: file.size,
          title: file.name.replace(/\.[^.]+$/, ''),
        })

        if (result.error) {
          await supabase.storage.from(FLEXI_BUCKET).remove([storagePath])
          toast.error(`Failed to save ${file.name}`, { description: result.error })
        }
      }

      toast.success('Images uploaded')
      await load()
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function openEdit(item: FlexiDesignGalleryItem) {
    setEditing(item)
    setEditTitle(item.title || '')
    setEditCaption(item.caption || '')
  }

  async function handleSaveEdit() {
    if (!editing) return
    setSaving(true)
    try {
      const result = await updateFlexiDesignGalleryItem(editing.id, {
        title: editTitle,
        caption: editCaption,
      })
      if (result.error) {
        toast.error('Could not update', { description: result.error })
      } else {
        toast.success('Updated')
        setEditing(null)
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item: FlexiDesignGalleryItem) {
    if (!canManage) return
    if (!confirm('Delete this gallery image?')) return
    setDeletingId(item.id)
    try {
      const result = await deleteFlexiDesignGalleryItem(item.id)
      if (result.error) {
        toast.error('Could not delete', { description: result.error })
      } else {
        toast.success('Deleted')
        setItems((prev) => prev.filter((i) => i.id !== item.id))
        if (viewing?.id === item.id) setViewing(null)
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
              <CardTitle>Gallery</CardTitle>
              <CardDescription>
                Examples of work for this client. Not tied to a specific project.
              </CardDescription>
            </div>
            {canManage && (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={uploading}
                  onClick={() => inputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-4 w-4" />
                  )}
                  Upload images
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={IMAGE_ACCEPT}
                  className="hidden"
                  onChange={(e) => void handleUpload(e.target.files)}
                />
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <ImageIcon className="mx-auto mb-3 h-8 w-8 opacity-50" />
              <p>No gallery images yet</p>
              {canManage && (
                <p className="mt-1 text-sm">Upload JPGs, PNGs, WebP, or GIFs.</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item) => {
                const src = urls[item.storage_path]
                return (
                  <div
                    key={item.id}
                    className="group relative overflow-hidden rounded-lg border bg-muted/30"
                  >
                    <button
                      type="button"
                      className="block aspect-square w-full"
                      onClick={() => setViewing(item)}
                    >
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={src}
                          alt={item.title || 'Gallery image'}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-8 w-8" />
                        </div>
                      )}
                    </button>
                    {(item.title || item.caption) && (
                      <div className="border-t p-2">
                        {item.title && (
                          <div className="truncate text-sm font-medium">{item.title}</div>
                        )}
                        {item.caption && (
                          <div className="line-clamp-2 text-xs text-muted-foreground">
                            {item.caption}
                          </div>
                        )}
                      </div>
                    )}
                    {canManage && (
                      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          disabled={deletingId === item.id}
                          onClick={() => void handleDelete(item)}
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{viewing?.title || 'Gallery image'}</DialogTitle>
            {viewing?.caption && <DialogDescription>{viewing.caption}</DialogDescription>}
          </DialogHeader>
          {viewing && urls[viewing.storage_path] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={urls[viewing.storage_path]}
              alt={viewing.title || 'Gallery image'}
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit gallery item</DialogTitle>
            <DialogDescription>Optional title and caption for this image.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="gallery-title">Title</Label>
              <Input
                id="gallery-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gallery-caption">Caption</Label>
              <Textarea
                id="gallery-caption"
                rows={3}
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSaveEdit()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
