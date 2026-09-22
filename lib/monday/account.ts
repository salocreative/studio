import { mondayRequest } from '@/lib/monday/api'
import { mondayPulseUrl } from '@/lib/monday/urls'

let cachedSlug: string | null | undefined

/**
 * Monday account slug (`salocreative` in salocreative.monday.com). Cached per process.
 */
export async function getMondayAccountSlug(): Promise<string | null> {
  if (cachedSlug !== undefined) return cachedSlug

  const fromEnv = process.env.MONDAY_ACCOUNT_SLUG?.trim()
  if (fromEnv) {
    cachedSlug = fromEnv
    return cachedSlug
  }

  const token = process.env.MONDAY_API_TOKEN
  if (!token) {
    cachedSlug = null
    return null
  }

  try {
    const data = await mondayRequest<{ me?: { account?: { slug?: string | null } | null } | null }>(
      token,
      'query { me { account { slug } } }'
    )
    const slug = data.me?.account?.slug?.trim() || null
    cachedSlug = slug
    return slug
  } catch (error) {
    console.error('Error fetching Monday account slug:', error)
    cachedSlug = null
    return null
  }
}

export async function mondayItemUrl(
  boardId: string | null | undefined,
  itemId: string | null | undefined
): Promise<string | null> {
  if (!boardId || !itemId) return null
  const slug = await getMondayAccountSlug()
  if (!slug) return null
  return mondayPulseUrl(slug, boardId, itemId)
}
