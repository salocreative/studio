import { requireAdmin } from '@/app/actions/auth'
import { ProjectInvoicesClient } from './project-invoices-client'

export default async function ProjectInvoicesPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  await requireAdmin()
  const { projectId } = await params
  return <ProjectInvoicesClient projectId={projectId} />
}
