import { requireAdmin } from '@/app/actions/auth'
import LeadsPageClient from './leads-client'

export default async function LeadsPage() {
  await requireAdmin() // Redirect if not admin
  
  return <LeadsPageClient />
}

