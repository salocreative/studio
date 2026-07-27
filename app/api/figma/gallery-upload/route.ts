import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buildFlexiDesignStoragePath } from '@/lib/flexi-design/storage'
import {
  figmaOptionsResponse,
  jsonWithCors,
  requireFigmaApiAuth,
} from '@/lib/api/figma-auth'

const FLEXI_BUCKET = 'flexi-design'
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

export async function OPTIONS(request: NextRequest) {
  return figmaOptionsResponse(request)
}

export async function POST(request: NextRequest) {
  const auth = await requireFigmaApiAuth(request)
  if ('error' in auth) {
    return jsonWithCors(request, { error: auth.error }, { status: 401 })
  }

  const admin = await createAdminClient()
  if (!admin) {
    return jsonWithCors(request, { error: 'Service unavailable' }, { status: 503 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonWithCors(request, { error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const clientId = String(form.get('client_id') || '').trim()
  const titleRaw = form.get('title')
  const captionRaw = form.get('caption')
  const sortOrderRaw = form.get('sort_order')
  const file = form.get('file')

  if (!clientId) {
    return jsonWithCors(request, { error: 'client_id is required' }, { status: 400 })
  }

  if (!(file instanceof File)) {
    return jsonWithCors(request, { error: 'file is required' }, { status: 400 })
  }

  const mimeType = (file.type || 'image/png').toLowerCase()
  if (!ALLOWED_MIME.has(mimeType) && !mimeType.startsWith('image/')) {
    return jsonWithCors(
      request,
      { error: 'Only image uploads are allowed (PNG, JPEG, WebP, GIF)' },
      { status: 400 }
    )
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    return jsonWithCors(
      request,
      { error: 'Only image uploads are allowed (PNG, JPEG, WebP, GIF)' },
      { status: 400 }
    )
  }

  const { data: client, error: clientError } = await admin
    .from('flexi_design_clients')
    .select('id, client_name')
    .eq('id', clientId)
    .maybeSingle()

  if (clientError || !client) {
    return jsonWithCors(request, { error: 'Flexi-Design client not found' }, { status: 404 })
  }

  const title =
    typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : file.name.replace(/\.[^.]+$/, '')
  const caption =
    typeof captionRaw === 'string' && captionRaw.trim() ? captionRaw.trim() : null
  const sortOrder =
    typeof sortOrderRaw === 'string' && sortOrderRaw.trim()
      ? Number.parseInt(sortOrderRaw, 10) || 0
      : 0

  const storagePath = buildFlexiDesignStoragePath(clientId, 'gallery', file.name || 'export.png')
  const bytes = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await admin.storage.from(FLEXI_BUCKET).upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: false,
  })

  if (uploadError) {
    console.error('Figma gallery storage upload error:', uploadError)
    return jsonWithCors(
      request,
      { error: uploadError.message || 'Failed to upload image' },
      { status: 500 }
    )
  }

  const { data: item, error: insertError } = await admin
    .from('flexi_design_gallery_items')
    .insert({
      client_id: clientId,
      title,
      caption,
      storage_path: storagePath,
      mime_type: mimeType,
      file_size: bytes.byteLength,
      sort_order: sortOrder,
      created_by: auth.user.id,
    })
    .select(
      'id, client_id, title, caption, storage_path, mime_type, file_size, sort_order, created_at'
    )
    .single()

  if (insertError || !item) {
    await admin.storage.from(FLEXI_BUCKET).remove([storagePath])
    console.error('Figma gallery insert error:', insertError)
    return jsonWithCors(
      request,
      { error: insertError?.message || 'Failed to save gallery item' },
      { status: 500 }
    )
  }

  return jsonWithCors(request, {
    success: true,
    client: { id: client.id, client_name: client.client_name },
    item,
  })
}
