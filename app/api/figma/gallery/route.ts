import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  authErrorResponse,
  figmaOptionsResponse,
  jsonWithCors,
  requireFigmaApiAuth,
} from '@/lib/api/figma-auth'

export const runtime = 'nodejs'

const FLEXI_BUCKET = 'flexi-design'
const MAX_BYTES = 50 * 1024 * 1024

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export async function OPTIONS() {
  return figmaOptionsResponse()
}

/** Plugin contract: POST /api/figma/gallery */
export async function POST(request: NextRequest) {
  const auth = await requireFigmaApiAuth(request)
  if ('error' in auth && auth.error) {
    return authErrorResponse(auth)
  }

  const admin = await createAdminClient()
  if (!admin) {
    return jsonWithCors(
      { error: 'service_unavailable', message: 'Service unavailable' },
      { status: 503 }
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonWithCors(
      { error: 'file_missing', message: 'Expected multipart/form-data' },
      { status: 400 }
    )
  }

  const clientId = String(form.get('client_id') || '').trim()
  const titleRaw = form.get('title')
  const captionRaw = form.get('caption')
  const sortOrderRaw = form.get('sort_order')
  const file = form.get('file')

  if (!clientId) {
    return jsonWithCors(
      { error: 'client_id_missing', message: 'client_id is required' },
      { status: 400 }
    )
  }

  if (!(file instanceof File)) {
    return jsonWithCors(
      { error: 'file_missing', message: 'file is required' },
      { status: 400 }
    )
  }

  const mimeType = (file.type || 'image/png').toLowerCase()
  const ext = MIME_TO_EXT[mimeType]
  if (!ext) {
    return jsonWithCors(
      {
        error: 'unsupported_type',
        message: 'Only image uploads are allowed (PNG, JPEG, WebP, GIF)',
      },
      { status: 415 }
    )
  }

  if (file.size > MAX_BYTES) {
    return jsonWithCors(
      { error: 'file_too_large', message: 'File exceeds 50MB limit' },
      { status: 413 }
    )
  }

  const { data: client, error: clientError } = await admin
    .from('flexi_design_clients')
    .select('id, client_name')
    .eq('id', clientId)
    .maybeSingle()

  if (clientError || !client) {
    return jsonWithCors(
      {
        error: 'client_not_found',
        message: 'No Flexi-Design client with that id',
      },
      { status: 400 }
    )
  }

  const title =
    typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : null
  const caption =
    typeof captionRaw === 'string' && captionRaw.trim() ? captionRaw.trim() : null
  const sortOrder = Number(sortOrderRaw) || 0

  const itemId = randomUUID()
  const storagePath = `${clientId}/gallery/${itemId}.${ext}`
  const bytes = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await admin.storage.from(FLEXI_BUCKET).upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: false,
  })

  if (uploadError) {
    console.error('Figma gallery storage upload error:', uploadError)
    return jsonWithCors(
      { error: uploadError.message || 'Failed to upload image' },
      { status: 500 }
    )
  }

  const { data: item, error: insertError } = await admin
    .from('flexi_design_gallery_items')
    .insert({
      id: itemId,
      client_id: clientId,
      title,
      caption,
      storage_path: storagePath,
      mime_type: mimeType,
      file_size: bytes.byteLength,
      sort_order: sortOrder,
      created_by: auth.user.id,
    })
    .select('id, storage_path, title')
    .single()

  if (insertError || !item) {
    await admin.storage.from(FLEXI_BUCKET).remove([storagePath])
    console.error('Figma gallery insert error:', insertError)
    return jsonWithCors(
      { error: insertError?.message || 'Failed to save gallery item' },
      { status: 500 }
    )
  }

  return jsonWithCors({
    ok: true,
    item: {
      id: item.id,
      storage_path: item.storage_path,
      title: item.title,
    },
  })
}
