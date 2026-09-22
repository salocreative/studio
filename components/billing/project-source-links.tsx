import Link from 'next/link'
import { ExternalLink, FolderKanban } from 'lucide-react'
import { studioProjectHref } from '@/lib/monday/urls'
import { cn } from '@/lib/utils'

export function ProjectSourceLinks({
  projectId,
  status,
  mondayUrl,
  className,
}: {
  projectId: string
  status: 'active' | 'archived' | 'locked'
  mondayUrl: string | null
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-x-4 gap-y-1', className)}>
      <Link
        href={studioProjectHref(status, projectId)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <FolderKanban className="h-3.5 w-3.5" />
        Studio project
      </Link>
      {mondayUrl ? (
        <a
          href={mondayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Monday.com
        </a>
      ) : null}
    </div>
  )
}
