import { SowDetailClient } from '../sow-detail-client'

export default async function SowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SowDetailClient sowId={id} />
}
