import { requireAdmin } from '@/app/actions/auth'

export default async function ScorecardPage() {
  await requireAdmin() // Redirect if not admin
  
  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Scorecard</h1>
            <p className="text-sm text-muted-foreground">
              Performance metrics and KPIs
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Coming soon</p>
        </div>
      </div>
    </div>
  )
}

