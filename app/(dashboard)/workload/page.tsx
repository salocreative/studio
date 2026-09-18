import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTeamWorkload } from '@/app/actions/workload'
import { WorkloadClient } from './workload-client'
import { WorkloadHeader } from './components/workload-header'
import { WorkloadSkeleton } from './components/workload-skeleton'

export const dynamic = 'force-dynamic'

async function WorkloadContent() {
  const result = await getTeamWorkload()

  if ('error' in result) {
    if (result.error === 'Not authenticated') {
      redirect('/auth/login')
    }

    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
        {result.error}
      </div>
    )
  }

  return <WorkloadClient members={result.members} />
}

export default function WorkloadPage() {
  return (
    <div className="flex h-full flex-col">
      <WorkloadHeader>
        <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[rgb(80,140,196)]" />
            Client
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#6405FF]" />
            Internal
          </span>
        </div>
      </WorkloadHeader>
      <div className="flex-1 overflow-y-auto p-6">
        <Suspense fallback={<WorkloadSkeleton />}>
          <WorkloadContent />
        </Suspense>
      </div>
    </div>
  )
}
