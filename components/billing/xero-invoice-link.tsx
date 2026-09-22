import { ExternalLink } from 'lucide-react'
import { xeroInvoiceUrl } from '@/lib/xero/urls'
import { cn } from '@/lib/utils'

export function XeroInvoiceLink({
  xeroInvoiceId,
  className,
}: {
  xeroInvoiceId: string
  className?: string
}) {
  return (
    <a
      href={xeroInvoiceUrl(xeroInvoiceId)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground',
        className
      )}
    >
      Xero
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}
