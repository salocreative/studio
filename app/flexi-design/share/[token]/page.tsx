import FlexiDesignShareClient from './flexi-design-share-client'

export default async function FlexiDesignSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <FlexiDesignShareClient shareToken={token} />
}
