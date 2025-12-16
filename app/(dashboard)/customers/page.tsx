import { requireAuth } from '@/app/actions/auth'
import CustomersPageClient from './customers-client'

export default async function CustomersPage() {
  await requireAuth() // Redirect if not authenticated
  
  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Customers</h1>
            <p className="text-sm text-muted-foreground">
              Customer analysis and relationship management
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <CustomersPageClient />
      </div>
    </div>
  )
}

