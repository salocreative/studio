import { createClient } from '@/lib/supabase/client'
import { PRODUCT_CARDS_BUCKET } from '@/lib/product-cards/model'

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
])

export async function uploadProductCardAsset(cardId: string, file: File): Promise<string> {
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    throw new Error('Use a JPEG, PNG, WebP, GIF, SVG, MP4, or WebM file.')
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Files need to be 20 MB or smaller.')
  }

  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  const path = `${cardId}/${crypto.randomUUID()}.${extension}`
  const supabase = createClient()
  const { error } = await supabase.storage.from(PRODUCT_CARDS_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return path
}

const COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function uploadProductCardCover(cardId: string, file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
  const normalisedExtension = extension === 'jpeg' ? 'jpg' : extension
  if (!COVER_TYPES.has(file.type) || !['jpg', 'png', 'webp'].includes(normalisedExtension)) {
    throw new Error('Use a JPEG, PNG, or WebP image.')
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Cover images need to be 5 MB or smaller.')
  }

  const base = file.name
    .slice(0, file.name.lastIndexOf('.') > 0 ? file.name.lastIndexOf('.') : file.name.length)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'cover'
  const path = `covers/${cardId}/${Date.now()}-${base}.${normalisedExtension}`
  const supabase = createClient()
  const { error } = await supabase.storage.from(PRODUCT_CARDS_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return path
}
