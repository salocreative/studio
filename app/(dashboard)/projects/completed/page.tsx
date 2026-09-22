import { ProjectsClient } from '../projects-client'
import { checkIsAdmin } from '@/app/actions/auth'

export const maxDuration = 60

export default async function CompletedProjectsPage() {
  const { isAdmin } = await checkIsAdmin()
  return <ProjectsClient statusFilter="locked" canDelete={isAdmin} />
}
