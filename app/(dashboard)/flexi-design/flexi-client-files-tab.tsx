'use client'

import { useEffect, useRef, useState } from 'react'
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
import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  checkCanManageFlexiAssets,
  createFlexiDesignFile,
  deleteFlexiDesignFile,
  getFlexiDesignFiles,
  getFlexiDesignSignedUrls,
  type FlexiDesignFile,
} from '@/app/actions/flexi-design-assets'
import { buildFlexiDesignStoragePath } from '@/lib/flexi-design/storage'

const FLEXI_BUCKET = 'flexi-design'
const ACCEPTED_TYPES =
  '.pdf,.md,.txt,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,application/pdf,text/markdown,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*'

function formatBytes(bytes: number | null) {
  if (bytes == null || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FlexiClientFilesTab({ clientId }: { clientId: string }) {
  const [files, setFiles] = useState<FlexiDesignFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void load()
  }, [clientId])

  async function load() {
    setLoading(true)
    try {
      const [filesResult, manageResult] = await Promise.all([
        getFlexiDesignFiles(clientId),
        checkCanManageFlexiAssets(),
      ])
      setCanManage(manageResult.canManage)
      if (filesResult.error) {
        toast.error('Could not load files', { description: filesResult.error })
        setFiles([])
      } else {
        setFiles(filesResult.files || [])
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
        const storagePath = buildFlexiDesignStoragePath(clientId, 'files', file.name)
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

        const result = await createFlexiDesignFile({
          clientId,
          fileName: file.name,
          title: file.name.replace(/\.[^.]+$/, ''),
          storagePath,
          mimeType: file.type || null,
          fileSize: file.size,
        })

        if (result.error) {
          await supabase.storage.from(FLEXI_BUCKET).remove([storagePath])
          toast.error(`Failed to save ${file.name}`, { description: result.error })
        }
      }

      toast.success('Files uploaded')
      await load()
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleDownload(file: FlexiDesignFile) {
    const result = await getFlexiDesignSignedUrls([file.storage_path])
    if (result.error || !result.urls?.[file.storage_path]) {
      toast.error('Could not download file', { description: result.error })
      return
    }
    window.open(result.urls[file.storage_path], '_blank', 'noopener,noreferrer')
  }

  async function handleDelete(file: FlexiDesignFile) {
    if (!canManage) return
    if (!confirm(`Delete “${file.file_name}”?`)) return
    setDeletingId(file.id)
    try {
      const result = await deleteFlexiDesignFile(file.id)
      if (result.error) {
        toast.error('Could not delete file', { description: result.error })
      } else {
        toast.success('File deleted')
        setFiles((prev) => prev.filter((f) => f.id !== file.id))
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Files</CardTitle>
            <CardDescription>
              Reference documents for this client (PDFs, Markdown, docs). For future AI briefing
              context.
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
                Upload
              </Button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPTED_TYPES}
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
        ) : files.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <FileText className="mx-auto mb-3 h-8 w-8 opacity-50" />
            <p>No files yet</p>
            {canManage && (
              <p className="mt-1 text-sm">Upload PDFs, Markdown, or docs to build context.</p>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="font-medium">
                    {file.title || file.file_name}
                    {file.title && file.title !== file.file_name && (
                      <div className="text-xs text-muted-foreground">{file.file_name}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {file.mime_type || '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm">{formatBytes(file.file_size)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(file.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Download"
                        onClick={() => void handleDownload(file)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      {canManage && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          disabled={deletingId === file.id}
                          onClick={() => void handleDelete(file)}
                        >
                          {deletingId === file.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
