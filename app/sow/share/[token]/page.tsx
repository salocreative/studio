import SowShareClient from './sow-share-client'

export default async function SowSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <SowShareClient shareToken={token} />
}
