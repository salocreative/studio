import { requireAuth } from '@/app/actions/auth'
import ProductCardsClient from './product-cards-client'

export default async function ProductCardsPage() {
  await requireAuth()
  return <ProductCardsClient />
}
