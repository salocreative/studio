import { requireAuth } from '@/app/actions/auth'
import RetainersPageClient from './retainers-client'

export default async function RetainersPage() {
  await requireAuth()
  
  return <RetainersPageClient />
}

