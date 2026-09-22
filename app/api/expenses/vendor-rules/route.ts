import { NextRequest, NextResponse } from 'next/server'
import { gmailQueryForVendor } from '@/lib/expenses/vendor-query'
import { createAdminClient } from '@/lib/supabase/server'

function authorized(request: NextRequest) {
  const secret = process.env.EXPENSES_CAPTURE_SECRET
  if (!secret) return false
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '')
  return bearer === secret
}

export async function GET(request: NextRequest) {
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

  const { data, error } = await supabase
    .from('vendor_rules')
    .select(
      'vendor_key, vendor_name, sender_domains, subject_keywords, raw_query_override, mode, link_domain_hint, link_fallback, folder_name, is_capture_active'
    )
    .eq('is_capture_active', true)
    .order('vendor_name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const vendors = ((data || []) as Array<Record<string, unknown>>)
    .map((row) => {
      const query = gmailQueryForVendor({
        raw_query_override: typeof row.raw_query_override === 'string' ? row.raw_query_override : null,
        sender_domains: Array.isArray(row.sender_domains) ? (row.sender_domains as string[]) : [],
        subject_keywords: Array.isArray(row.subject_keywords) ? (row.subject_keywords as string[]) : [],
      })
      if (!query) return null
      return {
        vendorKey: String(row.vendor_key),
        name: String(row.vendor_name),
        query,
        mode: String(row.mode || 'attachment'),
        linkDomainHint: typeof row.link_domain_hint === 'string' ? row.link_domain_hint : null,
        linkFallback: row.link_fallback === true,
        folder: typeof row.folder_name === 'string' && row.folder_name ? row.folder_name : String(row.vendor_name),
      }
    })
    .filter((vendor) => vendor !== null)

  return NextResponse.json({ vendors })
}
