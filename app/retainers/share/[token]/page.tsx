import RetainerShareClient from './retainer-share-client'

export default async function RetainerSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <RetainerShareClient shareToken={token} />
}

