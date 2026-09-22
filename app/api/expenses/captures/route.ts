import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const MODES = new Set(['attachment', 'link', 'snapshot', 'flag'])
const FILE_TYPES = new Set(['pdf', 'html'])

function authorized(request: NextRequest) {
  const secret = process.env.EXPENSES_CAPTURE_SECRET
  if (!secret) return false
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '')
  return bearer === secret
}

export async function POST(request: NextRequest) {
  if (!process.env.EXPENSES_CAPTURE_SECRET) {
    return NextResponse.json({ error: 'Expense capture is not configured.' }, { status: 503 })
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = await createAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Service role is not configured.' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const vendorKey = typeof body.vendor_key === 'string' ? body.vendor_key.trim() : ''
  const vendorName = typeof body.vendor_name === 'string' ? body.vendor_name.trim() : ''
  const gmailMessageId = typeof body.gmail_message_id === 'string' ? body.gmail_message_id.trim() : ''
  const fileUrl = typeof body.file_url === 'string' ? body.file_url.trim() : ''
  const fileType = typeof body.file_type === 'string' ? body.file_type : ''
  const sourceMode = typeof body.source_mode === 'string' ? body.source_mode : ''
  if (!vendorKey || !vendorName || !gmailMessageId || !fileUrl) {
    return NextResponse.json({ error: 'Missing capture fields.' }, { status: 400 })
  }
  if (!FILE_TYPES.has(fileType) || !MODES.has(sourceMode)) {
    return NextResponse.json({ error: 'Invalid file type or source mode.' }, { status: 400 })
  }

  const { error } = await supabase.from('expense_captures').insert({
    vendor_key: vendorKey,
    vendor_name: vendorName,
    gmail_message_id: gmailMessageId,
    gmail_thread_id: typeof body.gmail_thread_id === 'string' ? body.gmail_thread_id : null,
    email_date: typeof body.email_date === 'string' ? body.email_date : null,
    file_url: fileUrl,
    file_type: fileType,
    source_mode: sourceMode,
    status: 'new',
  })

  if (error) {
    if (error.code === '23505') return NextResponse.json({ success: true, duplicate: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
