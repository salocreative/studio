import { NextRequest, NextResponse } from 'next/server'
import { checkIsAdmin } from '@/app/actions/auth'
import { createClient } from '@/lib/supabase/server'
import { downloadCaptureFile } from '@/lib/xero/bills'

function safeFileName(value: string, fallback: string) {
  const cleaned = value.replace(/[/\\?%*:|"<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (cleaned || fallback).slice(0, 180)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { isAdmin } = await checkIsAdmin()
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'Missing capture id.' }, { status: 400 })

  const supabase = await createClient()
  const full = await supabase
    .from('expense_captures')
    .select('file_url, file_type, file_name, vendor_name')
    .eq('id', id)
    .maybeSingle()
  const query =
    full.error && /file_name|schema cache/i.test(full.error.message)
      ? await supabase
          .from('expense_captures')
          .select('file_url, file_type, vendor_name')
          .eq('id', id)
          .maybeSingle()
      : full

  if (query.error) return NextResponse.json({ error: query.error.message }, { status: 500 })
  if (!query.data) return NextResponse.json({ error: 'That capture could not be found.' }, { status: 404 })

  const file = await downloadCaptureFile(String(query.data.file_url))
  if ('error' in file) {
    return new NextResponse(
      `<!doctype html><html><body style="font:14px system-ui;padding:24px;color:#444"><p>${escapeHtml(file.error)}</p><p><a href="${escapeHtml(String(query.data.file_url))}">Open the document</a></p></body></html>`,
      {
        status: 502,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    )
  }

  const fileType = query.data.file_type === 'html' ? 'html' : 'pdf'
  const contentType =
    fileType === 'html'
      ? 'text/html; charset=utf-8'
      : file.contentType.includes('pdf')
        ? file.contentType
        : 'application/pdf'
  const fallbackName = `${query.data.vendor_name || 'invoice'}.${fileType}`
  const fileName = safeFileName(
    ('file_name' in query.data && typeof query.data.file_name === 'string' && query.data.file_name) ||
      file.fileName ||
      fallbackName,
    fallbackName
  )

  return new NextResponse(Buffer.from(file.bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${fileName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=120',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
