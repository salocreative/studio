import TimeReportShareClient from './time-report-share-client'

export default async function TimeReportSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <TimeReportShareClient shareToken={token} />
}
