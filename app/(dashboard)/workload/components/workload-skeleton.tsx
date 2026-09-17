import { Card } from '@/components/ui/card'

export function WorkloadSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 xl:grid-cols-2"
      aria-busy="true"
      aria-label="Loading workload"
    >
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
  )
}
