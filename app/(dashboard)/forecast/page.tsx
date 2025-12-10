import { requireAdmin } from '@/app/actions/auth'
import ForecastPageClient from './forecast-client'

export default async function ForecastPage() {
  await requireAdmin() // Redirect if not admin
  
  return <ForecastPageClient />
}
