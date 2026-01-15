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
    .is('deleted_at', null)
    .single()

  return { isAdmin: userProfile?.role === 'admin' }
}

export interface CupboardCategory {
  id: string
  name: string
  display_order: number
  created_at: string
}

export interface CupboardFile {
  id: string
  item_id: string
  file_path: string
  file_name: string
  file_size: number | null
  file_type: string | null
  thumbnail_path: string | null
  display_order: number
  created_at: string
}

export interface CupboardLink {
  id: string
  item_id: string
  url: string
  label: string | null
  display_order: number
  created_at: string
}

export interface CupboardItem {
  id: string
  title: string
  description: string | null
  category_id: string | null
  category?: CupboardCategory | null
  cover_image_path: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  files?: CupboardFile[]
  links?: CupboardLink[]
}

/**
 * Get all cupboard categories
 */
export async function getCupboardCategories() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('cupboard_categories')
      .select('*')
      .order('display_order', { ascending: true })

    if (error) throw error

    return { success: true, categories: (data || []) as CupboardCategory[] }
  } catch (error) {
    console.error('Error fetching cupboard categories:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch categories' }
  }
}

/**
 * Create a new cupboard category (admin only)
 */
export async function createCupboardCategory(name: string, displayOrder: number = 0) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('cupboard_categories')
      .insert({ name, display_order: displayOrder })
      .select()
      .single()

    if (error) throw error

    return { success: true, category: data as CupboardCategory }
  } catch (error) {
    console.error('Error creating cupboard category:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create category' }
  }
}

/**
 * Delete a cupboard category (admin only)
 */
export async function deleteCupboardCategory(categoryId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { error } = await supabase
      .from('cupboard_categories')
      .delete()
      .eq('id', categoryId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error deleting cupboard category:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete category' }
  }
}

/**
 * Get all cupboard items with optional filtering by category and search
 */
export async function getCupboardItems(categoryId?: string, searchQuery?: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    let query = supabase
      .from('cupboard_items')
      .select(`
        *,
        category:cupboard_categories(*)
      `)
      .order('created_at', { ascending: false })

    if (categoryId) {
      query = query.eq('category_id', categoryId)
    }

    if (searchQuery && searchQuery.trim()) {
      // Use case-insensitive search on title and description
      const searchTerm = `%${searchQuery.trim()}%`
      query = query.or(`title.ilike.${searchTerm},description.ilike.${searchTerm}`)
    }

    const { data, error } = await query

    if (error) throw error

    const items = (data || []) as any[]

    // Load files and links for each item
    const itemsWithRelations = await Promise.all(
      items.map(async (item) => {
        const [filesResult, linksResult] = await Promise.all([
          supabase
            .from('cupboard_files')
            .select('*')
            .eq('item_id', item.id)
            .order('display_order', { ascending: true }),
          supabase
            .from('cupboard_links')
            .select('*')
            .eq('item_id', item.id)
            .order('display_order', { ascending: true }),
        ])

        return {
          ...item,
          files: (filesResult.data || []) as CupboardFile[],
          links: (linksResult.data || []) as CupboardLink[],
        } as CupboardItem
      })
    )

    return { success: true, items: itemsWithRelations }
  } catch (error) {
    console.error('Error fetching cupboard items:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch items' }
  }
}

/**
 * Get a single cupboard item by ID
 */
export async function getCupboardItem(id: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const { data, error } = await supabase
      .from('cupboard_items')
      .select(`
        *,
        category:cupboard_categories(*)
      `)
      .eq('id', id)
      .single()

    if (error) throw error

    // Load files and links
    const [filesResult, linksResult] = await Promise.all([
      supabase
        .from('cupboard_files')
        .select('*')
        .eq('item_id', id)
        .order('display_order', { ascending: true }),
      supabase
        .from('cupboard_links')
        .select('*')
        .eq('item_id', id)
        .order('display_order', { ascending: true }),
    ])

    const item = {
      ...data,
      files: (filesResult.data || []) as CupboardFile[],
      links: (linksResult.data || []) as CupboardLink[],
    } as CupboardItem

    return { success: true, item }
  } catch (error) {
    console.error('Error fetching cupboard item:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch item' }
  }
}

/**
 * Create a new cupboard item (admin only)
 * Files and links are handled separately after item creation
 */
export async function createCupboardItem(
  title: string,
  description: string | null,
  categoryId: string | null
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('cupboard_items')
      .insert({
        title,
        description,
        category_id: categoryId,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, item: data as CupboardItem }
  } catch (error) {
    console.error('Error creating cupboard item:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create item' }
  }
}

/**
 * Update a cupboard item (admin only)
 */
export async function updateCupboardItem(
  id: string,
  title: string,
  description: string | null,
  categoryId: string | null,
  coverImagePath: string | null = null
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('cupboard_items')
      .update({
        title,
        description,
        category_id: categoryId,
        cover_image_path: coverImagePath,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return { success: true, item: data as CupboardItem }
  } catch (error) {
    console.error('Error updating cupboard item:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update item' }
  }
}

/**
 * Delete a cupboard item (admin only)
 * This will cascade delete associated files and links
 */
export async function deleteCupboardItem(id: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // First, get files to delete from storage
    const { data: files } = await supabase
      .from('cupboard_files')
      .select('file_path, thumbnail_path')
      .eq('item_id', id)

    // Delete files from storage
    if (files) {
      const filePaths = files
        .map(f => [f.file_path, f.thumbnail_path])
        .flat()
        .filter(Boolean) as string[]
      
      if (filePaths.length > 0) {
        // Try cupboard bucket first, fallback to documents bucket for migrated files
        const supabaseStorage = await import('@supabase/supabase-js').then(m => 
          m.createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          )
        )
        
        try {
          await supabaseStorage.storage
            .from('cupboard')
            .remove(filePaths)
        } catch {
          // If cupboard bucket doesn't exist yet, try documents bucket (for migration)
          await supabaseStorage.storage
            .from('documents')
            .remove(filePaths)
        }
      }
    }

    // Delete the item (cascade will delete files and links)
    const { error } = await supabase
      .from('cupboard_items')
      .delete()
      .eq('id', id)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error deleting cupboard item:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete item' }
  }
}

/**
 * Add a file to a cupboard item (admin only)
 */
export async function addCupboardFile(
  itemId: string,
  filePath: string,
  fileName: string,
  fileSize: number,
  fileType: string | null,
  thumbnailPath: string | null,
  displayOrder: number = 0
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('cupboard_files')
      .insert({
        item_id: itemId,
        file_path: filePath,
        file_name: fileName,
        file_size: fileSize,
        file_type: fileType,
        thumbnail_path: thumbnailPath,
        display_order: displayOrder,
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, file: data as CupboardFile }
  } catch (error) {
    console.error('Error adding cupboard file:', error)
    return { error: error instanceof Error ? error.message : 'Failed to add file' }
  }
}

/**
 * Delete a cupboard file (admin only)
 */
export async function deleteCupboardFile(fileId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Get file path before deleting
    const { data: file } = await supabase
      .from('cupboard_files')
      .select('file_path, thumbnail_path')
      .eq('id', fileId)
      .single()

    // Delete from database
    const { error } = await supabase
      .from('cupboard_files')
      .delete()
      .eq('id', fileId)

    if (error) throw error

    // Delete from storage
    if (file) {
      const filePaths = [file.file_path, file.thumbnail_path].filter(Boolean) as string[]
      if (filePaths.length > 0) {
        // Try cupboard bucket first, fallback to documents bucket for migrated files
        const supabaseStorage = await import('@supabase/supabase-js').then(m => 
          m.createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          )
        )
        
        try {
          await supabaseStorage.storage
            .from('cupboard')
            .remove(filePaths)
        } catch {
          // If cupboard bucket doesn't exist yet, try documents bucket (for migration)
          await supabaseStorage.storage
            .from('documents')
            .remove(filePaths)
        }
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Error deleting cupboard file:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete file' }
  }
}

/**
 * Add a link to a cupboard item (admin only)
 */
export async function addCupboardLink(
  itemId: string,
  url: string,
  label: string | null,
  displayOrder: number = 0
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Validate URL
    try {
      new URL(url)
    } catch {
      return { error: 'Invalid URL format' }
    }

    const { data, error } = await supabase
      .from('cupboard_links')
      .insert({
        item_id: itemId,
        url,
        label,
        display_order: displayOrder,
      })
      .select()
      .single()

    if (error) throw error

    return { success: true, link: data as CupboardLink }
  } catch (error) {
    console.error('Error adding cupboard link:', error)
    return { error: error instanceof Error ? error.message : 'Failed to add link' }
  }
}

/**
 * Delete a cupboard link (admin only)
 */
export async function deleteCupboardLink(linkId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { error } = await supabase
      .from('cupboard_links')
      .delete()
      .eq('id', linkId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error deleting cupboard link:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete link' }
  }
}

/**
 * Get download URL for a cupboard file
 */
export async function getCupboardFileDownloadUrl(filePath: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Try cupboard bucket first, fallback to documents bucket for migrated files
    let data, error
    try {
      const result = await supabase
        .storage
        .from('cupboard')
        .createSignedUrl(filePath, 3600) // 1 hour expiry
      data = result.data
      error = result.error
    } catch {
      // Fallback to documents bucket if cupboard doesn't exist yet
      const result = await supabase
        .storage
        .from('documents')
        .createSignedUrl(filePath, 3600)
      data = result.data
      error = result.error
    }

    if (error) throw error
    if (!data) throw new Error('No data returned from storage')

    return { success: true, url: data.signedUrl }
  } catch (error) {
    console.error('Error generating download URL:', error)
    return { error: error instanceof Error ? error.message : 'Failed to generate download URL' }
  }
}

/**
 * Get thumbnail URL for a cupboard file
 */
export async function getCupboardThumbnailUrl(thumbnailPath: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Try cupboard bucket first, fallback to documents bucket for migrated files
    let data, error
    try {
      const result = await supabase
        .storage
        .from('cupboard')
        .createSignedUrl(thumbnailPath, 3600) // 1 hour expiry
      data = result.data
      error = result.error
    } catch {
      // Fallback to documents bucket if cupboard doesn't exist yet
      const result = await supabase
        .storage
        .from('documents')
        .createSignedUrl(thumbnailPath, 3600)
      data = result.data
      error = result.error
    }

    if (error) throw error
    if (!data) throw new Error('No data returned from storage')

    return { success: true, url: data.signedUrl }
  } catch (error) {
    console.error('Error generating thumbnail URL:', error)
    return { error: error instanceof Error ? error.message : 'Failed to generate thumbnail URL' }
  }
}

/**
 * Get cover image URL for a cupboard item
 */
export async function getCupboardCoverImageUrl(coverImagePath: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // Try cupboard bucket first, fallback to documents bucket for migrated files
    let data, error
    try {
      const result = await supabase
        .storage
        .from('cupboard')
        .createSignedUrl(coverImagePath, 3600) // 1 hour expiry
      data = result.data
      error = result.error
    } catch {
      // Fallback to documents bucket if cupboard doesn't exist yet
      const result = await supabase
        .storage
        .from('documents')
        .createSignedUrl(coverImagePath, 3600)
      data = result.data
      error = result.error
    }

    if (error) throw error
    if (!data) throw new Error('No data returned from storage')

    return { success: true, url: data.signedUrl }
  } catch (error) {
    console.error('Error generating cover image URL:', error)
    return { error: error instanceof Error ? error.message : 'Failed to generate cover image URL' }
  }
}

