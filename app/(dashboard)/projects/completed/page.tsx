import { ProjectsClient } from '../projects-client'

export default function CompletedProjectsPage() {
  return <ProjectsClient statusFilter="locked" />
}
