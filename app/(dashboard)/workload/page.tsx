import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTeamWorkload } from '@/app/actions/workload'
import { WorkloadClient } from './workload-client'
import { WorkloadHeader } from './components/workload-header'
import { WorkloadLegend } from './components/workload-legend'
import { WorkloadSkeleton } from './components/workload-skeleton'

export const dynamic = 'force-dynamic'

async function WorkloadContent() {
  const result = await getTeamWorkload()

  if ('error' in result) {
    if (result.error === 'Not authenticated') {
      redirect('/auth/login')
    }

    return (
      <>
        <WorkloadHeader>
          <WorkloadLegend />
        </WorkloadHeader>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            {result.error}
          </div>
        </div>
      </>
    )
  }

  return <WorkloadClient members={result.members} />
}

export default function WorkloadPage() {
  return (
    <div className="flex h-full flex-col">
      <Suspense
        fallback={
          <>
            <WorkloadHeader>
              <WorkloadLegend />
            </WorkloadHeader>
            <div className="flex-1 overflow-y-auto p-6">
              <WorkloadSkeleton />
            </div>
          </>
        }
      >
        <WorkloadContent />
      </Suspense>
    </div>
  )
}
