import { Badge } from '@/components/ui/badge'
import {
  INVOICE_STATUS_LABELS,
  invoiceStatusBadgeClass,
  type InvoiceStatus,
} from '@/lib/billing/invoices'
import { cn } from '@/lib/utils'

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant="outline" className={cn('font-medium', invoiceStatusBadgeClass(status))}>
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  )
}
