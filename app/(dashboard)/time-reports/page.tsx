import { requireAuth } from '@/app/actions/auth'
import TimeReportsClient from './time-reports-client'

export default async function TimeReportsPage() {
  await requireAuth()

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Time Reports</h1>
            <p className="text-sm text-muted-foreground">
              View and share time logs by client across active and completed projects (main board and Flexi-Design)
            </p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <TimeReportsClient />
      </div>
    </div>
  )
}
