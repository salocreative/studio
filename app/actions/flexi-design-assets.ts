'use server'

import { createClient } from '@/lib/supabase/server'

const FLEXI_STORAGE_BUCKET = 'flexi-design'

function getActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

async function requireAuth() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, supabase: null, user: null, isAdmin: false }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  const isAdmin = userProfile?.role === 'admin'
  return { supabase, user, isAdmin, error: null as null }
}

async function requireAdmin() {
  const auth = await requireAuth()
  if (auth.error || !auth.supabase || !auth.user) {
    return { error: auth.error ?? 'Not authenticated' as const, supabase: null, user: null }
  }
  if (!auth.isAdmin) {
    return { error: 'Unauthorized: Admin access required' as const, supabase: null, user: null }
  }
  return { supabase: auth.supabase, user: auth.user, error: null as null }
}

export async function checkCanManageFlexiAssets() {
  const auth = await requireAuth()
  if (auth.error) return { canManage: false }
  return { canManage: auth.isAdmin }
}

export interface FlexiDesignFile {
  id: string
  client_id: string
  file_name: string
  title: string | null
  storage_path: string
  mime_type: string | null
  file_size: number | null
  created_by: string | null
  created_at: string
}

export interface FlexiDesignGalleryItem {
  id: string
  client_id: string
  title: string | null
  caption: string | null
  storage_path: string
  mime_type: string | null
  file_size: number | null
  sort_order: number
  created_by: string | null
  created_at: string
}

export interface FlexiDesignContact {
  id: string
  client_id: string
  name: string
  email: string
  role: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export async function getFlexiDesignSignedUrls(
  filePaths: string[],
  expiresIn: number = 3600
) {
  const auth = await requireAuth()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  const uniquePaths = Array.from(new Set((filePaths || []).filter(Boolean)))
  if (uniquePaths.length === 0) return { success: true, urls: {} as Record<string, string> }

  try {
    const { data, error } = await auth.supabase.storage
      .from(FLEXI_STORAGE_BUCKET)
      .createSignedUrls(uniquePaths, expiresIn)

    if (error) throw error

    const urls: Record<string, string> = {}
    for (const row of data || []) {
      if (row?.signedUrl && row?.path) urls[row.path] = row.signedUrl
    }

    return { success: true, urls }
  } catch (error) {
    console.error('Error generating Flexi-Design signed URLs:', error)
    return { error: getActionError(error, 'Failed to generate signed URLs') }
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function getFlexiDesignFiles(clientId: string) {
  const auth = await requireAuth()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_files')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return { success: true, files: (data || []) as FlexiDesignFile[] }
  } catch (error) {
    console.error('Error fetching Flexi-Design files:', error)
    return { error: getActionError(error, 'Failed to fetch files') }
  }
}

export async function createFlexiDesignFile(input: {
  clientId: string
  fileName: string
  title?: string | null
  storagePath: string
  mimeType?: string | null
  fileSize?: number | null
}) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase || !auth.user) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_files')
      .insert({
        client_id: input.clientId,
        file_name: input.fileName.trim(),
        title: input.title?.trim() || null,
        storage_path: input.storagePath,
        mime_type: input.mimeType || null,
        file_size: input.fileSize ?? null,
        created_by: auth.user.id,
      })
      .select()
      .single()

    if (error) throw error
    return { success: true, file: data as FlexiDesignFile }
  } catch (error) {
    console.error('Error creating Flexi-Design file:', error)
    return { error: getActionError(error, 'Failed to save file') }
  }
}

export async function deleteFlexiDesignFile(fileId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data: file, error: fetchError } = await auth.supabase
      .from('flexi_design_files')
      .select('id, storage_path')
      .eq('id', fileId)
      .single()

    if (fetchError || !file) return { error: 'File not found' }

    const { error } = await auth.supabase.from('flexi_design_files').delete().eq('id', fileId)
    if (error) throw error

    if (file.storage_path) {
      await auth.supabase.storage.from(FLEXI_STORAGE_BUCKET).remove([file.storage_path])
    }

    return { success: true }
  } catch (error) {
    console.error('Error deleting Flexi-Design file:', error)
    return { error: getActionError(error, 'Failed to delete file') }
  }
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

export async function getFlexiDesignGalleryItems(clientId: string) {
  const auth = await requireAuth()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_gallery_items')
      .select('*')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (error) throw error
    return { success: true, items: (data || []) as FlexiDesignGalleryItem[] }
  } catch (error) {
    console.error('Error fetching Flexi-Design gallery:', error)
    return { error: getActionError(error, 'Failed to fetch gallery') }
  }
}

export async function createFlexiDesignGalleryItem(input: {
  clientId: string
  storagePath: string
  mimeType?: string | null
  fileSize?: number | null
  title?: string | null
  caption?: string | null
  sortOrder?: number
}) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase || !auth.user) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_gallery_items')
      .insert({
        client_id: input.clientId,
        storage_path: input.storagePath,
        mime_type: input.mimeType || null,
        file_size: input.fileSize ?? null,
        title: input.title?.trim() || null,
        caption: input.caption?.trim() || null,
        sort_order: input.sortOrder ?? 0,
        created_by: auth.user.id,
      })
      .select()
      .single()

    if (error) throw error
    return { success: true, item: data as FlexiDesignGalleryItem }
  } catch (error) {
    console.error('Error creating Flexi-Design gallery item:', error)
    return { error: getActionError(error, 'Failed to save gallery item') }
  }
}

export async function updateFlexiDesignGalleryItem(
  itemId: string,
  input: { title?: string | null; caption?: string | null }
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_gallery_items')
      .update({
        title: input.title?.trim() || null,
        caption: input.caption?.trim() || null,
      })
      .eq('id', itemId)
      .select()
      .single()

    if (error) throw error
    return { success: true, item: data as FlexiDesignGalleryItem }
  } catch (error) {
    console.error('Error updating Flexi-Design gallery item:', error)
    return { error: getActionError(error, 'Failed to update gallery item') }
  }
}

export async function deleteFlexiDesignGalleryItem(itemId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data: item, error: fetchError } = await auth.supabase
      .from('flexi_design_gallery_items')
      .select('id, storage_path')
      .eq('id', itemId)
      .single()

    if (fetchError || !item) return { error: 'Gallery item not found' }

    const { error } = await auth.supabase
      .from('flexi_design_gallery_items')
      .delete()
      .eq('id', itemId)

    if (error) throw error

    if (item.storage_path) {
      await auth.supabase.storage.from(FLEXI_STORAGE_BUCKET).remove([item.storage_path])
    }

    return { success: true }
  } catch (error) {
    console.error('Error deleting Flexi-Design gallery item:', error)
    return { error: getActionError(error, 'Failed to delete gallery item') }
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function getFlexiDesignContacts(clientId: string) {
  const auth = await requireAuth()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_contacts')
      .select('*')
      .eq('client_id', clientId)
      .order('name', { ascending: true })

    if (error) throw error
    return { success: true, contacts: (data || []) as FlexiDesignContact[] }
  } catch (error) {
    console.error('Error fetching Flexi-Design contacts:', error)
    return { error: getActionError(error, 'Failed to fetch contacts') }
  }
}

export async function createFlexiDesignContact(input: {
  clientId: string
  name: string
  email: string
  role?: string | null
  notes?: string | null
}) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (!name) return { error: 'Name is required' }
  if (!email || !isValidEmail(email)) return { error: 'Enter a valid email address' }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_contacts')
      .insert({
        client_id: input.clientId,
        name,
        email,
        role: input.role?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .select()
      .single()

    if (error) throw error
    return { success: true, contact: data as FlexiDesignContact }
  } catch (error) {
    console.error('Error creating Flexi-Design contact:', error)
    return { error: getActionError(error, 'Failed to create contact') }
  }
}

export async function updateFlexiDesignContact(
  contactId: string,
  input: {
    name: string
    email: string
    role?: string | null
    notes?: string | null
  }
) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (!name) return { error: 'Name is required' }
  if (!email || !isValidEmail(email)) return { error: 'Enter a valid email address' }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_contacts')
      .update({
        name,
        email,
        role: input.role?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .eq('id', contactId)
      .select()
      .single()

    if (error) throw error
    return { success: true, contact: data as FlexiDesignContact }
  } catch (error) {
    console.error('Error updating Flexi-Design contact:', error)
    return { error: getActionError(error, 'Failed to update contact') }
  }
}

export async function deleteFlexiDesignContact(contactId: string) {
  const auth = await requireAdmin()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { error } = await auth.supabase
      .from('flexi_design_contacts')
      .delete()
      .eq('id', contactId)

    if (error) throw error
    return { success: true }
  } catch (error) {
    console.error('Error deleting Flexi-Design contact:', error)
    return { error: getActionError(error, 'Failed to delete contact') }
  }
}
