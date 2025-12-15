'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Check if current user is admin
 */
export async function checkIsAdmin() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { isAdmin: false }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  return { isAdmin: userProfile?.role === 'admin' }
}

export type DocumentCategory = 'hr' | 'sales' | 'operations'

export interface Document {
  id: string
  title: string
  description: string | null
  category: DocumentCategory
  file_path: string
  file_name: string
  file_size: number | null
  thumbnail_path: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Get all documents
 */
export async function getDocuments(category?: DocumentCategory) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    let query = supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })

    if (category) {
      query = query.eq('category', category)
    }

    const { data, error } = await query

    if (error) throw error

    return { success: true, documents: (data || []) as Document[] }
  } catch (error) {
    console.error('Error fetching documents:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch documents' }
  }
}

/**
 * Get a single document by ID
 */
export async function getDocument(id: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error

    return { success: true, document: data as Document }
  } catch (error) {
    console.error('Error fetching document:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch document' }
  }
}

/**
 * Upload a document file to Supabase Storage
 */
export async function uploadDocumentFile(file: File): Promise<{ error?: string; filePath?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if user is admin
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Generate unique filename
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
    const filePath = `documents/${fileName}`

    // Convert File to ArrayBuffer for upload
    const arrayBuffer = await file.arrayBuffer()
    const { data, error } = await supabase.storage
      .from('documents')
      .upload(filePath, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      })

    if (error) throw error

    return { filePath: data.path }
  } catch (error) {
    console.error('Error uploading document file:', error)
    return { error: error instanceof Error ? error.message : 'Failed to upload file' }
  }
}

/**
 * Create a new document (admin only)
 */
export async function createDocument(
  title: string,
  description: string | null,
  category: DocumentCategory,
  filePath: string,
  fileName: string,
  fileSize: number | null,
  thumbnailPath: string | null = null
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if user is admin
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        title,
        description,
        category,
        file_path: filePath,
        file_name: fileName,
        file_size: fileSize,
        thumbnail_path: thumbnailPath,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, document: data as Document }
  } catch (error) {
    console.error('Error creating document:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create document' }
  }
}

/**
 * Update a document (admin only)
 */
export async function updateDocument(
  id: string,
  title: string,
  description: string | null,
  category: DocumentCategory
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if user is admin
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('documents')
      .update({
        title,
        description,
        category,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return { success: true, document: data as Document }
  } catch (error) {
    console.error('Error updating document:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update document' }
  }
}

/**
 * Delete a document (admin only)
 */
export async function deleteDocument(id: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if user is admin
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // First get the document to get the file path and thumbnail path
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('file_path, thumbnail_path')
      .eq('id', id)
      .single()

    if (fetchError) throw fetchError

    // Delete the file and thumbnail from storage
    const filesToDelete: string[] = []
    if (document?.file_path) {
      filesToDelete.push(document.file_path)
    }
    if (document?.thumbnail_path) {
      filesToDelete.push(document.thumbnail_path)
    }

    if (filesToDelete.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('documents')
        .remove(filesToDelete)

      if (storageError) {
        console.error('Error deleting files from storage:', storageError)
        // Continue with database deletion even if storage deletion fails
      }
    }

    // Delete the document record
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', id)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error deleting document:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete document' }
  }
}

/**
 * Get a signed URL for downloading a document
 */
export async function getDocumentDownloadUrl(filePath: string): Promise<{ error?: string; url?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(filePath, 3600) // URL valid for 1 hour

    if (error) throw error

    return { url: data.signedUrl }
  } catch (error) {
    console.error('Error generating download URL:', error)
    return { error: error instanceof Error ? error.message : 'Failed to generate download URL' }
  }
}

/**
 * Get a signed URL for a thumbnail image
 */
export async function getThumbnailUrl(thumbnailPath: string): Promise<{ error?: string; url?: string }> {
  return getDocumentDownloadUrl(thumbnailPath)
}

