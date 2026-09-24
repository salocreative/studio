import { requireAuth } from '@/app/actions/auth'
import ProductCardEditorClient from './editor-client'

export default async function ProductCardEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAuth()
  const { id } = await params
  return <ProductCardEditorClient id={id} />
}
