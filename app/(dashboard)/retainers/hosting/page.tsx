import { requireAdmin } from '@/app/actions/auth'
import HostingPageClient from './hosting-client'

export default async function HostingPage() {
  await requireAdmin()
  return <HostingPageClient />
}
