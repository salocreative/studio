import { requireAdmin } from '@/app/actions/auth'
import { InvoicesPageClient } from './invoices-client'

export default async function BillingInvoicesPage() {
  await requireAdmin()
  return <InvoicesPageClient />
}
