import { requireAdmin } from '@/app/actions/auth'
import { ExpensesPageClient } from './expenses-client'

export default async function ExpensesPage() {
  await requireAdmin()
  return <ExpensesPageClient />
}
