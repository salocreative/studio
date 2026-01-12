import { requireAuth } from '@/app/actions/auth'
import RetainerDetailClient from './retainer-detail-client'

export default async function RetainerDetailPage({
  params,
}: {
  params: Promise<{ clientName: string }>
}) {
  await requireAuth()
  
  const { clientName: clientNameParam } = await params
  const clientName = decodeURIComponent(clientNameParam)
  
  return <RetainerDetailClient clientName={clientName} />
}

