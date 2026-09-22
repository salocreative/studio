import { requireAdmin } from '@/app/actions/auth'
import { BillingReconcileClient } from './reconcile-client'

export default async function BillingReconcilePage() {
  await requireAdmin()
  return <BillingReconcileClient />
}
