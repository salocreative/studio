import { requireAdmin } from '@/app/actions/auth'
import SettingsPageClient from './settings-client'

export default async function SettingsPage() {
  await requireAdmin()
  return <SettingsPageClient />
}
