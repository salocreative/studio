import { NextRequest, NextResponse } from 'next/server'
import { enrichExpenseCapture } from '@/lib/expenses/enrich-capture'
import { cleanFileName } from '@/lib/expenses/parse-document'
import { roundGbp } from '@/lib/billing/invoices'
import { createAdminClient } from '@/lib/supabase/server'

const MODES = new Set(['attachment', 'link', 'snapshot', 'flag'])
const FILE_TYPES = new Set(['pdf', 'html'])

function authorized(request: NextRequest) {
  const secret = process.env.EXPENSES_CAPTURE_SECRET
  if (!secret) return false
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '')
  return bearer === secret
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalAmount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/,/g, '')) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return roundGbp(n)
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

  const fileName = cleanFileName(optionalString(body.file_name) || optionalString(body.filename))
  const emailSubject = optionalString(body.email_subject)
  const amount = optionalAmount(body.amount)
  const invoiceDate = optionalString(body.invoice_date)
  const row = {
    vendor_key: vendorKey,
    vendor_name: vendorName,
    gmail_message_id: gmailMessageId,
    gmail_thread_id: optionalString(body.gmail_thread_id),
    email_date: optionalString(body.email_date),
    invoice_date: invoiceDate,
    amount,
    file_url: fileUrl,
    file_type: fileType,
    source_mode: sourceMode,
    file_name: fileName,
    email_subject: emailSubject,
    status: 'new',
  }

  let inserted = await supabase.from('expense_captures').insert(row).select('id').maybeSingle()
  if (inserted.error && /file_name|email_subject|schema cache/i.test(inserted.error.message)) {
    const { file_name: _ignoredName, email_subject: _ignoredSubject, ...legacy } = row
    void _ignoredName
    void _ignoredSubject
    inserted = await supabase.from('expense_captures').insert(legacy).select('id').maybeSingle()
  }

  if (inserted.error) {
    if (inserted.error.code === '23505') return NextResponse.json({ success: true, duplicate: true })
    return NextResponse.json({ error: inserted.error.message }, { status: 500 })
  }

  const id = inserted.data && typeof inserted.data.id === 'string' ? inserted.data.id : null
  if (id && (fileName == null || amount == null)) {
    try {
      const enriched = await enrichExpenseCapture({
        fileUrl,
        fileType: fileType === 'html' ? 'html' : 'pdf',
        fileName,
        emailSubject,
        amount,
      })
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (!fileName && enriched.fileName) patch.file_name = enriched.fileName
      if (amount == null && enriched.amount != null) patch.amount = enriched.amount
      if (Object.keys(patch).length > 1) {
        await supabase.from('expense_captures').update(patch).eq('id', id)
      }
    } catch (error) {
      console.error('Error enriching expense capture:', error)
    }
  }

  return NextResponse.json({ success: true })
}
