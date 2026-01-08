import { requireAuth } from '@/app/actions/auth'
import ScorecardPageClient from './scorecard-client'

export default async function ScorecardPage() {
  await requireAuth() // Redirect if not authenticated
  
  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Scorecard</h1>
            <p className="text-sm text-muted-foreground">
              Weekly key metrics across Marketing, Sales, Operations, and Finance
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <ScorecardPageClient />
      </div>
    </div>
  )
}
