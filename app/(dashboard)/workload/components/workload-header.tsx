import type { ReactNode } from 'react'

export function WorkloadHeader({ children }: { children?: ReactNode }) {
  return (
    <div className="border-b bg-background">
      <div className="flex h-16 items-center justify-between gap-4 px-6">
        <div>
          <h1 className="text-2xl font-semibold">Workload</h1>
          <p className="text-sm text-muted-foreground">
            Live projects on each person&apos;s plate. Size is remaining hours on their
            assigned subitems; opacity is progress. Ranked priorities sit below.
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}
