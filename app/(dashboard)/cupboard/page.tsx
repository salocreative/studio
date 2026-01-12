import { requireAuth } from '@/app/actions/auth'
import CupboardPageClient from './cupboard-client'

export default async function CupboardPage() {
  await requireAuth()
  
  return <CupboardPageClient />
}

