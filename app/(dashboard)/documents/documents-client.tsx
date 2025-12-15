'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { FileText, Upload, Edit2, Trash2, Download, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getDocuments, createDocument, updateDocument, deleteDocument, uploadDocumentFile, getDocumentDownloadUrl, checkIsAdmin, type Document, type DocumentCategory } from '@/app/actions/documents'
import { format } from 'date-fns'

export function DocumentsPageContent() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategory | 'all'>('all')
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editingDocument, setEditingDocument] = useState<Document | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<DocumentCategory>('hr')
  const [file, setFile] = useState<File | null>(null)

  // Check if user is admin (for showing upload/edit buttons)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    checkAdminStatus()
    loadDocuments()
  }, [])

  useEffect(() => {
    loadDocuments()
  }, [selectedCategory])

  async function checkAdminStatus() {
    try {
      const result = await checkIsAdmin()
      setIsAdmin(result.isAdmin)
    } catch (error) {
      console.error('Error checking admin status:', error)
      setIsAdmin(false)
    }
  }

  async function loadDocuments() {
    setLoading(true)
    try {
      const result = await getDocuments(selectedCategory === 'all' ? undefined : selectedCategory)
      if (result.error) {
        toast.error('Error loading documents', { description: result.error })
      } else if (result.success && result.documents) {
        setDocuments(result.documents)
      }
    } catch (error) {
      console.error('Error loading documents:', error)
      toast.error('Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  function handleUploadClick() {
    setTitle('')
    setDescription('')
    setCategory('hr')
    setFile(null)
    setShowUploadDialog(true)
  }

  function handleEditClick(doc: Document) {
    setEditingDocument(doc)
    setTitle(doc.title)
    setDescription(doc.description || '')
    setCategory(doc.category)
    setFile(null)
    setShowEditDialog(true)
  }

  function handleCancel() {
    setShowUploadDialog(false)
    setShowEditDialog(false)
    setEditingDocument(null)
    setTitle('')
    setDescription('')
    setCategory('hr')
    setFile(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!title.trim()) {
      toast.error('Title is required')
      return
    }

    if (showUploadDialog && !file) {
      toast.error('Please select a file to upload')
      return
    }

    setSaving(true)
    try {
      if (showUploadDialog) {
        // Upload new document
        if (!file) {
          toast.error('Please select a file')
          setSaving(false)
          return
        }

        setUploading(true)
        const uploadResult = await uploadDocumentFile(file)
        setUploading(false)

        if (uploadResult.error) {
          toast.error('Error uploading file', { description: uploadResult.error })
          setSaving(false)
          return
        }

        if (!uploadResult.filePath) {
          toast.error('Failed to upload file')
          setSaving(false)
          return
        }

        const createResult = await createDocument(
          title.trim(),
          description.trim() || null,
          category,
          uploadResult.filePath,
          file.name,
          file.size
        )

        if (createResult.error) {
          toast.error('Error creating document', { description: createResult.error })
        } else {
          toast.success('Document uploaded successfully')
          handleCancel()
          loadDocuments()
        }
      } else if (showEditDialog && editingDocument) {
        // Update existing document
        const updateResult = await updateDocument(
          editingDocument.id,
          title.trim(),
          description.trim() || null,
          category
        )

        if (updateResult.error) {
          toast.error('Error updating document', { description: updateResult.error })
        } else {
          toast.success('Document updated successfully')
          handleCancel()
          loadDocuments()
        }
      }
    } catch (error) {
      console.error('Error saving document:', error)
      toast.error('Failed to save document')
    } finally {
      setUploading(false)
      setSaving(false)
    }
  }

  async function handleDelete(doc: Document) {
    if (!confirm(`Are you sure you want to delete "${doc.title}"?`)) {
      return
    }

    try {
      const result = await deleteDocument(doc.id)
      if (result.error) {
        toast.error('Error deleting document', { description: result.error })
      } else {
        toast.success('Document deleted successfully')
        loadDocuments()
      }
    } catch (error) {
      console.error('Error deleting document:', error)
      toast.error('Failed to delete document')
    }
  }

  async function handleDownload(doc: Document) {
    try {
      const result = await getDocumentDownloadUrl(doc.file_path)
      if (result.error) {
        toast.error('Error downloading document', { description: result.error })
      } else if (result.url) {
        window.open(result.url, '_blank')
      }
    } catch (error) {
      console.error('Error downloading document:', error)
      toast.error('Failed to download document')
    }
  }

  const filteredDocuments = documents

  const categoryLabels: Record<DocumentCategory, string> = {
    hr: 'HR',
    sales: 'Sales',
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Documents</h1>
            <p className="text-muted-foreground mt-1">
              Access HR and Sales documents
            </p>
          </div>
          <Button onClick={handleUploadClick}>
            <Plus className="h-4 w-4 mr-2" />
            Upload Document
          </Button>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2">
          <Button
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            onClick={() => setSelectedCategory('all')}
          >
            All
          </Button>
          <Button
            variant={selectedCategory === 'hr' ? 'default' : 'outline'}
            onClick={() => setSelectedCategory('hr')}
          >
            HR
          </Button>
          <Button
            variant={selectedCategory === 'sales' ? 'default' : 'outline'}
            onClick={() => setSelectedCategory('sales')}
          >
            Sales
          </Button>
        </div>

        {/* Documents List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No documents found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredDocuments.map((doc) => (
              <Card key={doc.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{doc.title}</CardTitle>
                      <CardDescription className="mt-1">
                        <Badge variant="secondary" className="mr-2">
                          {categoryLabels[doc.category]}
                        </Badge>
                        {format(new Date(doc.created_at), 'MMM d, yyyy')}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  {doc.description && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                      {doc.description}
                    </p>
                  )}
                  <div className="mt-auto space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{doc.file_name}</span>
                      {doc.file_size && (
                        <span>{(doc.file_size / 1024 / 1024).toFixed(2)} MB</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleDownload(doc)}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                      {isAdmin && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditClick(doc)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(doc)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Upload Dialog */}
        <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Upload Document</DialogTitle>
                <DialogDescription>
                  Upload a PDF document with a title, category, and description
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Document title"
                    required
                    disabled={saving || uploading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short description of the document"
                    rows={3}
                    disabled={saving || uploading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select
                    value={category}
                    onValueChange={(value: DocumentCategory) => setCategory(value)}
                    disabled={saving || uploading}
                  >
                    <SelectTrigger id="category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hr">HR</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="file">PDF File *</Label>
                  <Input
                    id="file"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    required
                    disabled={saving || uploading}
                  />
                  {file && (
                    <p className="text-sm text-muted-foreground">
                      Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={saving || uploading}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || uploading}>
                  {(uploading || saving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Edit Document</DialogTitle>
                <DialogDescription>
                  Update document details. File cannot be changed after upload.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-title">Title *</Label>
                  <Input
                    id="edit-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Document title"
                    required
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-description">Description</Label>
                  <Textarea
                    id="edit-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short description of the document"
                    rows={3}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-category">Category *</Label>
                  <Select
                    value={category}
                    onValueChange={(value: DocumentCategory) => setCategory(value)}
                    disabled={saving}
                  >
                    <SelectTrigger id="edit-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hr">HR</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editingDocument && (
                  <div className="rounded-lg border bg-muted/50 p-3">
                    <p className="text-sm text-muted-foreground">Current file:</p>
                    <p className="text-sm font-medium">{editingDocument.file_name}</p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

