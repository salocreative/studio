import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/cupboard/download?path=...&name=...
 * Proxies a cupboard file so the browser downloads it with the correct filename.
 * Same-origin request avoids CORS and popup blockers.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const path = request.nextUrl.searchParams.get('path')
  const name = request.nextUrl.searchParams.get('name') || 'download'
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  try {
    let signedUrl: string | null = null
    const cupboardResult = await supabase.storage.from('cupboard').createSignedUrl(path, 60)
    if (cupboardResult.data?.signedUrl) {
      signedUrl = cupboardResult.data.signedUrl
    }
    if (!signedUrl) {
      const documentsResult = await supabase.storage.from('documents').createSignedUrl(path, 60)
      signedUrl = documentsResult.data?.signedUrl ?? null
    }
    if (!signedUrl) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const fileRes = await fetch(signedUrl)
    if (!fileRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch file' }, { status: 502 })
    }

    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream'
    const blob = await fileRes.blob()
    const safeName = decodeURIComponent(name).replace(/[\r\n"]/g, '_') || 'download'

    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeName}"`,
      },
    })
  } catch (error) {
    console.error('Cupboard download error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Download failed' },
      { status: 500 }
    )
  }
}
