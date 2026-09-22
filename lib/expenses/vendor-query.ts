export interface VendorQueryFields {
  raw_query_override: string | null
  sender_domains: string[] | null
  subject_keywords: string[] | null
}

/** Gmail search used by the filer. An override wins; otherwise domains and keywords are combined. */
export function gmailQueryForVendor(rule: VendorQueryFields): string | null {
  const override = rule.raw_query_override?.trim()
  if (override) return override

  const domains = (rule.sender_domains || []).map((domain) => domain.trim()).filter(Boolean)
  const keywords = (rule.subject_keywords || []).map((keyword) => keyword.trim()).filter(Boolean)
  const from = domains.length > 0 ? `from:(${domains.join(' OR ')})` : ''
  const subject = keywords.length > 0 ? `(${keywords.join(' OR ')})` : ''
  const query = [from, subject].filter(Boolean).join(' ')
  return query || null
}

export function vendorKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}
