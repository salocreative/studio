import { Card } from '@/components/ui/card'

function ListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="space-y-3 p-5">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          {Array.from({ length: 4 }).map((__, row) => (
            <div key={row} className="space-y-2 border-b py-2 last:border-b-0">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </Card>
      ))}
    </div>
  )
}

export function WorkloadSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="Loading workload">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card
            key={index}
            className="h-[320px] overflow-hidden border-slate-800 bg-slate-950 py-0"
          >
            <div className="space-y-2 p-6">
              <div className="h-4 w-40 animate-pulse rounded bg-slate-800" />
              <div className="h-3 w-28 animate-pulse rounded bg-slate-800/80" />
            </div>
          </Card>
        ))}
      </div>
      <div className="space-y-4">
        <div className="h-5 w-36 animate-pulse rounded bg-muted" />
        <ListSkeleton />
      </div>
      <div className="space-y-4">
        <div className="h-5 w-44 animate-pulse rounded bg-muted" />
        <ListSkeleton />
      </div>
    </div>
  )
}
