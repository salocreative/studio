import { Badge } from '@/components/ui/badge'
import {
  INVOICE_STATUS_LABELS,
  JOB_BILLING_STATUS_LABELS,
  invoiceStatusBadgeClass,
  jobBillingStatusBadgeClass,
  type InvoiceStatus,
  type JobBillingStatus,
} from '@/lib/billing/invoices'
import { cn } from '@/lib/utils'

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant="outline" className={cn('font-medium', invoiceStatusBadgeClass(status))}>
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  )
}

export function JobBillingStatusBadge({ status }: { status: JobBillingStatus }) {
  return (
    <Badge variant="outline" className={cn('font-medium', jobBillingStatusBadgeClass(status))}>
      {JOB_BILLING_STATUS_LABELS[status]}
    </Badge>
  )
}
