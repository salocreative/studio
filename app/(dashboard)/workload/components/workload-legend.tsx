import type { ReactNode } from 'react'

export function WorkloadLegend({ action }: { action?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="hidden items-center gap-1.5 sm:flex">
        <span className="h-2.5 w-2.5 rounded-full bg-[rgb(80,140,196)]" />
        Client
      </span>
      <span className="hidden items-center gap-1.5 sm:flex">
        <span className="h-2.5 w-2.5 rounded-full bg-[#6405FF]" />
        Internal
      </span>
      <span className="flex items-center gap-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[rgb(212,168,55)]" />
          Lead
        </span>
        {action}
      </span>
    </div>
  )
}
