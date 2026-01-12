'use client'

import { useState, useEffect, useRef } from 'react'
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
import { 
  FileText, 
  Upload, 
  Edit2, 
  Trash2, 
  Download, 
  Plus, 
  Loader2, 
  X, 
  Link as LinkIcon,
  Search,
  FolderOpen,
  Image as ImageIcon,
  ExternalLink
} from 'lucide-react'
import { toast } from 'sonner'
import { 
  getCupboardItems, 
  getCupboardCategories,
  createCupboardCategory,
  deleteCupboardCategory,
  createCupboardItem,
  updateCupboardItem,
  deleteCupboardItem,
  addCupboardFile,
  deleteCupboardFile,
  addCupboardLink,
  deleteCupboardLink,
  getCupboardFileDownloadUrl,
  getCupboardThumbnailUrl,
  checkIsAdmin,
  type CupboardItem,
  type CupboardCategory,
  type CupboardFile,
  type CupboardLink
} from '@/app/actions/cupboard'
import { createClient } from '@/lib/supabase/client'
import { generatePdfThumbnail } from '@/lib/pdf-thumbnail'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface FileToUpload {
  file: File
  id: string
}

interface LinkToAdd {
  url: string
  label: string
  id: string
}

export default function CupboardPageClient() {
  const [items, setItems] = useState<CupboardItem[]>([])
  const [categories, setCategories] = useState<CupboardCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showCategoryDialog, setShowCategoryDialog] = useState(false)
  const [editingItem, setEditingItem] = useState<CupboardItem | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({})

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [filesToUpload, setFilesToUpload] = useState<FileToUpload[]>([])
  const [linksToAdd, setLinksToAdd] = useState<LinkToAdd[]>([])

  // Category management
  const [newCategoryName, setNewCategoryName] = useState('')

  // Check if user is admin
  const [isAdmin, setIsAdmin] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    checkAdminStatus()
    loadCategories()
    loadItems()
  }, [selectedCategoryId, searchQuery])

  async function checkAdminStatus() {
    try {
      const result = await checkIsAdmin()
      setIsAdmin(result.isAdmin)
    } catch (error) {
      console.error('Error checking admin status:', error)
      setIsAdmin(false)
    }
  }

  async function loadCategories() {
    try {
      const result = await getCupboardCategories()
      if (result.error) {
        console.error('Error loading categories:', result.error)
      } else if (result.success && result.categories) {
        setCategories(result.categories)
      }
    } catch (error) {
      console.error('Error loading categories:', error)
    }
  }

  async function loadItems() {
    setLoading(true)
    try {
      const result = await getCupboardItems(
        selectedCategoryId === 'all' ? undefined : selectedCategoryId,
        searchQuery.trim() || undefined
      )
      if (result.error) {
        toast.error('Error loading items', { description: result.error })
      } else if (result.success && result.items) {
        setItems(result.items)
        
        // Load thumbnail URLs for files with thumbnails
        const urls: Record<string, string> = {}
        await Promise.all(
          result.items
            .flatMap(item => item.files || [])
            .filter(file => file.thumbnail_path)
            .map(async (file) => {
              if (file.thumbnail_path) {
                const thumbResult = await getCupboardThumbnailUrl(file.thumbnail_path)
                if (thumbResult.success && thumbResult.url) {
                  urls[file.id] = thumbResult.url
                }
              }
            })
        )
        setThumbnailUrls(urls)
      }
    } catch (error) {
      console.error('Error loading items:', error)
      toast.error('Failed to load items')
    } finally {
      setLoading(false)
    }
  }

  function handleAddClick() {
    setTitle('')
    setDescription('')
    setCategoryId('')
    setFilesToUpload([])
    setLinksToAdd([])
    setShowAddDialog(true)
  }

  function handleEditClick(item: CupboardItem) {
    setEditingItem(item)
    setTitle(item.title)
    setDescription(item.description || '')
    setCategoryId(item.category_id || '')
    setFilesToUpload([]) // Files are already uploaded, we'll manage them separately
    setLinksToAdd([]) // Links are already added, we'll manage them separately
    setShowEditDialog(true)
  }

  function handleClearCategory() {
    setCategoryId('')
  }

  function handleCancel() {
    setShowAddDialog(false)
    setShowEditDialog(false)
    setEditingItem(null)
    setTitle('')
    setDescription('')
    setCategoryId('')
    setFilesToUpload([])
    setLinksToAdd([])
  }

  function handleAddFile() {
    fileInputRef.current?.click()
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files || [])
    const newFiles: FileToUpload[] = selectedFiles.map(file => ({
      file,
      id: `${Date.now()}-${Math.random()}`,
    }))
    setFilesToUpload(prev => [...prev, ...newFiles])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleRemoveFile(fileId: string) {
    setFilesToUpload(prev => prev.filter(f => f.id !== fileId))
  }

  function handleAddLink() {
    setLinksToAdd(prev => [...prev, { url: '', label: '', id: `${Date.now()}-${Math.random()}` }])
  }

  function handleUpdateLink(linkId: string, field: 'url' | 'label', value: string) {
    setLinksToAdd(prev =>
      prev.map(link => link.id === linkId ? { ...link, [field]: value } : link)
    )
  }

  function handleRemoveLink(linkId: string) {
    setLinksToAdd(prev => prev.filter(l => l.id !== linkId))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!title.trim()) {
      toast.error('Title is required')
      return
    }

    if (showAddDialog && filesToUpload.length === 0 && linksToAdd.filter(l => l.url.trim()).length === 0) {
      toast.error('Please add at least one file or link')
      return
    }

    // Validate links
    const validLinks = linksToAdd.filter(l => l.url.trim())
    for (const link of validLinks) {
      try {
        new URL(link.url)
      } catch {
        toast.error(`Invalid URL: ${link.url}`)
        return
      }
    }

    setSaving(true)
    try {
      if (showAddDialog) {
        // Create new item
        const createResult = await createCupboardItem(
          title.trim(),
          description.trim() || null,
          categoryId || null
        )

        if (createResult.error) {
          toast.error('Error creating item', { description: createResult.error })
          setSaving(false)
          return
        }

        const itemId = createResult.item!.id
        setUploading(true)

        // Upload files
        const supabase = createClient()
        let displayOrder = 0

        for (const fileToUpload of filesToUpload) {
          try {
            const file = fileToUpload.file
            const fileExt = file.name.split('.').pop()
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
            const filePath = `cupboard/${fileName}`

            // Upload file to Supabase Storage (try cupboard bucket, fallback to documents)
            let uploadData
            try {
              const result = await supabase.storage
                .from('cupboard')
                .upload(filePath, file, {
                  contentType: file.type,
                  upsert: false,
                })
              uploadData = result.data
              if (result.error) throw result.error
            } catch {
              // Fallback to documents bucket if cupboard doesn't exist yet
              const result = await supabase.storage
                .from('documents')
                .upload(filePath, file, {
                  contentType: file.type,
                  upsert: false,
                })
              uploadData = result.data
              if (result.error) throw result.error
            }

            if (!uploadData?.path) {
              console.error('Failed to upload file:', file.name)
              continue
            }

            // Generate thumbnail for PDFs and images
            let thumbnailPath: string | null = null
            if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
              try {
                const thumbnailBlob = await generatePdfThumbnail(file, 400, 400)
                if (thumbnailBlob) {
                  const thumbFileName = `thumb-${fileName.replace(/\.[^/.]+$/, '')}.png`
                  const thumbPath = `cupboard/${thumbFileName}`
                  
                  try {
                    const thumbResult = await supabase.storage
                      .from('cupboard')
                      .upload(thumbPath, thumbnailBlob, {
                        contentType: 'image/png',
                        upsert: false,
                      })
                    if (thumbResult.data) {
                      thumbnailPath = thumbResult.data.path
                    }
                  } catch {
                    // Try documents bucket
                    const thumbResult = await supabase.storage
                      .from('documents')
                      .upload(thumbPath, thumbnailBlob, {
                        contentType: 'image/png',
                        upsert: false,
                      })
                    if (thumbResult.data) {
                      thumbnailPath = thumbResult.data.path
                    }
                  }
                }
              } catch (thumbError) {
                console.warn('Error generating thumbnail:', thumbError)
              }
            }

            // Add file to database
            await addCupboardFile(
              itemId,
              uploadData.path,
              file.name,
              file.size,
              file.type,
              thumbnailPath,
              displayOrder++
            )
          } catch (fileError) {
            console.error('Error uploading file:', fileError)
            toast.error(`Failed to upload file: ${fileToUpload.file.name}`)
          }
        }

        // Add links
        for (const link of validLinks) {
          try {
            await addCupboardLink(
              itemId,
              link.url.trim(),
              link.label.trim() || null,
              displayOrder++
            )
          } catch (linkError) {
            console.error('Error adding link:', linkError)
            toast.error(`Failed to add link: ${link.url}`)
          }
        }

        setUploading(false)
        toast.success('Item created successfully')
        handleCancel()
        loadItems()
      } else if (showEditDialog && editingItem) {
        // Update existing item
        const updateResult = await updateCupboardItem(
          editingItem.id,
          title.trim(),
          description.trim() || null,
          categoryId || null
        )

        if (updateResult.error) {
          toast.error('Error updating item', { description: updateResult.error })
        } else {
          // Add new files if any
          if (filesToUpload.length > 0) {
            setUploading(true)
            const supabase = createClient()
            let displayOrder = (editingItem.files?.length || 0) + (editingItem.links?.length || 0)

            for (const fileToUpload of filesToUpload) {
              try {
                const file = fileToUpload.file
                const fileExt = file.name.split('.').pop()
                const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
                const filePath = `cupboard/${fileName}`

                let uploadData
                try {
                  const result = await supabase.storage
                    .from('cupboard')
                    .upload(filePath, file, {
                      contentType: file.type,
                      upsert: false,
                    })
                  uploadData = result.data
                  if (result.error) throw result.error
                } catch {
                  const result = await supabase.storage
                    .from('documents')
                    .upload(filePath, file, {
                      contentType: file.type,
                      upsert: false,
                    })
                  uploadData = result.data
                  if (result.error) throw result.error
                }

                if (!uploadData?.path) continue

                let thumbnailPath: string | null = null
                if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
                  try {
                    const thumbnailBlob = await generatePdfThumbnail(file, 400, 400)
                    if (thumbnailBlob) {
                      const thumbFileName = `thumb-${fileName.replace(/\.[^/.]+$/, '')}.png`
                      const thumbPath = `cupboard/${thumbFileName}`
                      
                      try {
                        const thumbResult = await supabase.storage
                          .from('cupboard')
                          .upload(thumbPath, thumbnailBlob, {
                            contentType: 'image/png',
                            upsert: false,
                          })
                        if (thumbResult.data) {
                          thumbnailPath = thumbResult.data.path
                        }
                      } catch {
                        const thumbResult = await supabase.storage
                          .from('documents')
                          .upload(thumbPath, thumbnailBlob, {
                            contentType: 'image/png',
                            upsert: false,
                          })
                        if (thumbResult.data) {
                          thumbnailPath = thumbResult.data.path
                        }
                      }
                    }
                  } catch {}
                }

                await addCupboardFile(
                  editingItem.id,
                  uploadData.path,
                  file.name,
                  file.size,
                  file.type,
                  thumbnailPath,
                  displayOrder++
                )
              } catch {}
            }

            // Add new links
            for (const link of validLinks) {
              try {
                await addCupboardLink(
                  editingItem.id,
                  link.url.trim(),
                  link.label.trim() || null,
                  displayOrder++
                )
              } catch {}
            }

            setUploading(false)
          }

          toast.success('Item updated successfully')
          handleCancel()
          loadItems()
        }
      }
    } catch (error) {
      console.error('Error saving item:', error)
      toast.error('Failed to save item')
    } finally {
      setUploading(false)
      setSaving(false)
    }
  }

  async function handleDeleteItem(item: CupboardItem) {
    if (!confirm(`Are you sure you want to delete "${item.title}"? This will delete all associated files and links.`)) {
      return
    }

    try {
      const result = await deleteCupboardItem(item.id)
      if (result.error) {
        toast.error('Error deleting item', { description: result.error })
      } else {
        toast.success('Item deleted successfully')
        loadItems()
      }
    } catch (error) {
      console.error('Error deleting item:', error)
      toast.error('Failed to delete item')
    }
  }

  async function handleDeleteFile(file: CupboardFile, item: CupboardItem) {
    if (!confirm(`Are you sure you want to delete "${file.file_name}"?`)) {
      return
    }

    try {
      const result = await deleteCupboardFile(file.id)
      if (result.error) {
        toast.error('Error deleting file', { description: result.error })
      } else {
        toast.success('File deleted successfully')
        loadItems()
      }
    } catch (error) {
      console.error('Error deleting file:', error)
      toast.error('Failed to delete file')
    }
  }

  async function handleDeleteLink(link: CupboardLink) {
    try {
      const result = await deleteCupboardLink(link.id)
      if (result.error) {
        toast.error('Error deleting link', { description: result.error })
      } else {
        toast.success('Link deleted successfully')
        loadItems()
      }
    } catch (error) {
      console.error('Error deleting link:', error)
      toast.error('Failed to delete link')
    }
  }

  async function handleDownloadFile(file: CupboardFile) {
    try {
      const result = await getCupboardFileDownloadUrl(file.file_path)
      if (result.error) {
        toast.error('Error downloading file', { description: result.error })
      } else if (result.success && result.url) {
        window.open(result.url, '_blank')
      }
    } catch (error) {
      console.error('Error downloading file:', error)
      toast.error('Failed to download file')
    }
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) {
      toast.error('Category name is required')
      return
    }

    try {
      const result = await createCupboardCategory(
        newCategoryName.trim(),
        categories.length
      )
      if (result.error) {
        toast.error('Error creating category', { description: result.error })
      } else {
        toast.success('Category created successfully')
        setNewCategoryName('')
        setShowCategoryDialog(false)
        loadCategories()
      }
    } catch (error) {
      console.error('Error creating category:', error)
      toast.error('Failed to create category')
    }
  }

  async function handleDeleteCategory(category: CupboardCategory) {
    if (!confirm(`Are you sure you want to delete the "${category.name}" category? Items in this category will be uncategorized.`)) {
      return
    }

    try {
      const result = await deleteCupboardCategory(category.id)
      if (result.error) {
        toast.error('Error deleting category', { description: result.error })
      } else {
        toast.success('Category deleted successfully')
        if (selectedCategoryId === category.id) {
          setSelectedCategoryId('all')
        }
        loadCategories()
        loadItems()
      }
    } catch (error) {
      console.error('Error deleting category:', error)
      toast.error('Failed to delete category')
    }
  }

  const filteredItems = items

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Cupboard</h1>
            <p className="text-sm text-muted-foreground">
              Access files, links, and assets across all categories
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header with Search and Add Button */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 max-w-md relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowCategoryDialog(true)}>
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Manage Categories
                </Button>
                <Button onClick={handleAddClick}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </Button>
              </div>
            )}
          </div>

          {/* Category Filter */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={selectedCategoryId === 'all' ? 'default' : 'outline'}
              onClick={() => setSelectedCategoryId('all')}
              size="sm"
            >
              All
            </Button>
            {categories.map((category) => (
              <Button
                key={category.id}
                variant={selectedCategoryId === category.id ? 'default' : 'outline'}
                onClick={() => setSelectedCategoryId(category.id)}
                size="sm"
              >
                {category.name}
              </Button>
            ))}
          </div>

          {/* Items Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">No items found</p>
                <p className="text-sm text-muted-foreground text-center">
                  {searchQuery ? 'Try adjusting your search query' : isAdmin ? 'Get started by adding your first item' : 'No items available yet'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => {
                // Get the first file with a thumbnail for the main preview
                const firstFileWithThumbnail = item.files?.find(f => thumbnailUrls[f.id])
                const firstFile = item.files?.[0]
                const firstLink = item.links?.[0]
                
                return (
                  <Card key={item.id} className="hover:shadow-lg transition-shadow flex flex-col">
                    {/* Main Thumbnail Preview */}
                    {(firstFileWithThumbnail || (firstFile && (firstFile.file_type?.startsWith('image/') || firstFile.file_type === 'application/pdf'))) && (
                      <div className="relative w-full h-48 bg-muted overflow-hidden rounded-t-lg flex items-center justify-center p-4">
                        {firstFileWithThumbnail && thumbnailUrls[firstFileWithThumbnail.id] ? (
                          <img 
                            src={thumbnailUrls[firstFileWithThumbnail.id]} 
                            alt={firstFileWithThumbnail.file_name}
                            className="max-w-full max-h-full object-contain"
                          />
                        ) : firstFile?.file_type?.startsWith('image/') ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="h-16 w-16 text-muted-foreground" />
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <FileText className="h-16 w-16 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    )}
                    
                    {!firstFileWithThumbnail && !firstFile && firstLink && (
                      <div className="relative w-full h-48 bg-muted overflow-hidden rounded-t-lg flex items-center justify-center">
                        <LinkIcon className="h-16 w-16 text-muted-foreground" />
                      </div>
                    )}

                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg">{item.title}</CardTitle>
                          {item.category && (
                            <Badge variant="secondary" className="mt-2">
                              {item.category.name}
                            </Badge>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditClick(item)}
                              className="h-8 w-8"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteItem(item)}
                              className="h-8 w-8 text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      {item.description && (
                        <CardDescription className="mt-2">{item.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3 flex-1">
                      {/* Files */}
                      {item.files && item.files.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Files ({item.files.length}):</p>
                          {item.files.map((file) => (
                            <div key={file.id} className="flex items-center gap-3 p-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors">
                              {thumbnailUrls[file.id] ? (
                                <div className="h-16 w-16 bg-background rounded border border-border flex items-center justify-center flex-shrink-0 overflow-hidden p-1.5">
                                  <img 
                                    src={thumbnailUrls[file.id]} 
                                    alt={file.file_name}
                                    className="max-h-full max-w-full object-contain"
                                  />
                                </div>
                              ) : file.file_type?.startsWith('image/') ? (
                                <div className="h-16 w-16 bg-background rounded border border-border flex items-center justify-center flex-shrink-0">
                                  <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                </div>
                              ) : (
                                <div className="h-16 w-16 bg-background rounded border border-border flex items-center justify-center flex-shrink-0">
                                  <FileText className="h-8 w-8 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{file.file_name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {file.file_size ? `${(file.file_size / 1024).toFixed(1)} KB` : 'Unknown size'}
                                  {file.file_type && ` • ${file.file_type.split('/')[1]?.toUpperCase() || file.file_type}`}
                                </p>
                              </div>
                              <div className="flex gap-1 flex-shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDownloadFile(file)}
                                  className="h-8 w-8"
                                  title="Download"
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Links */}
                      {item.links && item.links.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Links ({item.links.length}):</p>
                          {item.links.map((link) => {
                            // Try to extract domain for better link display
                            let domain = ''
                            try {
                              const url = new URL(link.url)
                              domain = url.hostname.replace('www.', '')
                            } catch {}
                            
                            return (
                              <div key={link.id} className="flex items-center gap-3 p-2 bg-muted rounded-lg hover:bg-muted/80 transition-colors">
                                <div className="h-16 w-16 bg-background rounded border border-border flex items-center justify-center flex-shrink-0">
                                  <LinkIcon className="h-8 w-8 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">
                                    {link.label || domain || 'External Link'}
                                  </p>
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-muted-foreground hover:text-primary truncate block"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {link.url}
                                  </a>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          Added {format(new Date(item.created_at), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Item Dialog */}
      <Dialog open={showAddDialog || showEditDialog} onOpenChange={handleCancel}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{showAddDialog ? 'Add Item' : 'Edit Item'}</DialogTitle>
            <DialogDescription>
              {showAddDialog 
                ? 'Add a new item with files and/or links to the cupboard'
                : 'Update item details, or add additional files and links'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Brand Guidelines"
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
                placeholder="Brief description of this item..."
                rows={3}
                disabled={saving || uploading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <div className="flex gap-2">
                <Select
                  value={categoryId || undefined}
                  onValueChange={(value) => setCategoryId(value)}
                  disabled={saving || uploading}
                >
                  <SelectTrigger id="category" className="flex-1">
                    <SelectValue placeholder="No category (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categoryId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleClearCategory}
                    disabled={saving || uploading}
                    title="Clear category"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Files Section */}
            <div className="space-y-2">
              <Label>Files</Label>
              <div className="space-y-2">
                {filesToUpload.map((fileToUpload) => (
                  <div key={fileToUpload.id} className="flex items-center gap-2 p-2 border rounded">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{fileToUpload.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(fileToUpload.file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveFile(fileToUpload.id)}
                      disabled={saving || uploading}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                
                {/* Show existing files when editing */}
                {showEditDialog && editingItem && editingItem.files && editingItem.files.length > 0 && (
                  <>
                    {editingItem.files.map((file) => (
                      <div key={file.id} className="flex items-center gap-2 p-2 border rounded bg-muted/50">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.file_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {file.file_size ? `${(file.file_size / 1024).toFixed(1)} KB` : 'Unknown size'}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteFile(file, editingItem)}
                          disabled={saving || uploading}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={saving || uploading}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddFile}
                  disabled={saving || uploading}
                  className="w-full"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Add Files
                </Button>
              </div>
            </div>

            {/* Links Section */}
            <div className="space-y-2">
              <Label>Links</Label>
              <div className="space-y-2">
                {linksToAdd.map((link) => (
                  <div key={link.id} className="flex gap-2">
                    <div className="flex-1 space-y-2">
                      <Input
                        type="url"
                        placeholder="https://example.com"
                        value={link.url}
                        onChange={(e) => handleUpdateLink(link.id, 'url', e.target.value)}
                        disabled={saving || uploading}
                      />
                      <Input
                        type="text"
                        placeholder="Label (optional, e.g., 'Figma File')"
                        value={link.label}
                        onChange={(e) => handleUpdateLink(link.id, 'label', e.target.value)}
                        disabled={saving || uploading}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveLink(link.id)}
                      disabled={saving || uploading}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                {/* Show existing links when editing */}
                {showEditDialog && editingItem && editingItem.links && editingItem.links.length > 0 && (
                  <>
                    {editingItem.links.map((link) => (
                      <div key={link.id} className="flex items-center gap-2 p-2 border rounded bg-muted/50">
                        <LinkIcon className="h-8 w-8 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{link.label || 'Link'}</p>
                          <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteLink(link)}
                          disabled={saving || uploading}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </>
                )}

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddLink}
                  disabled={saving || uploading}
                  className="w-full"
                >
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Add Link
                </Button>
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
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    {showAddDialog ? 'Create Item' : 'Update Item'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Category Management Dialog */}
      <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Categories</DialogTitle>
            <DialogDescription>
              Create and manage cupboard categories. Deleting a category will not delete items, but they will become uncategorized.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-category">New Category Name</Label>
              <div className="flex gap-2">
                <Input
                  id="new-category"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g., Marketing, Brand Assets"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreateCategory()
                    }
                  }}
                />
                <Button onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Existing Categories</Label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No categories yet</p>
                ) : (
                  categories.map((category) => (
                    <div key={category.id} className="flex items-center justify-between p-2 border rounded">
                      <span className="text-sm font-medium">{category.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteCategory(category)}
                        className="h-8 w-8 text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCategoryDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

