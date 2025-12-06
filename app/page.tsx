import { HomePageHandler } from '@/components/home-page-handler'

export const dynamic = 'force-dynamic'

export default async function Home() {
  // Use client component to handle invitation tokens in URL hash
  // Server-side redirects can't access hash fragments
  return <HomePageHandler />
}
