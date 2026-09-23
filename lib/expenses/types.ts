import type { ExpenseDocumentKind } from '@/lib/expenses/parse-document'

export const EXPENSE_CAPTURE_STATUSES = [
  'new',
  'flagged_manual',
  'approved',
  'pushed',
  'rejected',
  'push_failed',
] as const

export type { ExpenseDocumentKind }

export type ExpenseCaptureStatus = (typeof EXPENSE_CAPTURE_STATUSES)[number]

export const VENDOR_MODES = ['attachment', 'link', 'snapshot', 'flag'] as const
export type VendorMode = (typeof VENDOR_MODES)[number]

export interface ExpenseCapture {
  id: string
  vendor_key: string
  vendor_name: string
  email_date: string | null
  invoice_date: string | null
  amount: number | null
  currency: string
  file_url: string
  file_name: string | null
  file_type: 'pdf' | 'html'
  source_mode: VendorMode
  status: ExpenseCaptureStatus
  document_kind: ExpenseDocumentKind
  email_subject: string | null
  gmail_message_id: string | null
  same_email_count: number
  suggested_account_code: string | null
  account_code: string | null
  suggested_tracking_option_id: string | null
  tracking_option_id: string | null
  xero_contact_id: string | null
  xero_bill_id: string | null
  notes: string | null
  push_error: string | null
  last_approved_amount: number | null
}

export interface VendorRule {
  id: string
  vendor_key: string
  vendor_name: string
  sender_domains: string[]
  subject_keywords: string[]
  raw_query_override: string | null
  mode: VendorMode
  link_domain_hint: string | null
  link_fallback: boolean
  folder_name: string | null
  is_capture_active: boolean
  xero_contact_id: string | null
  default_account_code: string | null
  default_tracking_category_id: string | null
  default_tracking_option_id: string | null
}

export interface VendorRuleInput {
  vendor_name: string
  sender_domains: string[]
  subject_keywords: string[]
  raw_query_override: string | null
  mode: VendorMode
  link_domain_hint: string | null
  link_fallback: boolean
  folder_name: string | null
  is_capture_active: boolean
  xero_contact_id: string | null
  default_account_code: string | null
  default_tracking_category_id: string | null
  default_tracking_option_id: string | null
}
