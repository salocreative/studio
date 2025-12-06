import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function Home() {
  // Always redirect to time-tracking
  // The dashboard layout will handle authentication
  // Invitation codes are handled in middleware to redirect to callback route
  redirect('/time-tracking')
}
