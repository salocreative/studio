/** Direct pulse URL. `view.monday.com` only opens the workspace, so the account slug is required. */
export function mondayPulseUrl(accountSlug: string, boardId: string, itemId: string): string {
  const slug = accountSlug.replace(/^https?:\/\//, '').replace(/\.monday\.com.*$/, '')
  return `https://${slug}.monday.com/boards/${boardId}/pulses/${itemId}`
}

export function studioProjectHref(
  status: 'active' | 'archived' | 'locked',
  projectId: string
): string {
  const path = status === 'locked' ? '/projects/completed' : '/projects'
  return `${path}?project=${encodeURIComponent(projectId)}`
}
