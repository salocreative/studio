/**
 * Asks the products site to rebuild a card. No-op until PRODUCTS_REVALIDATE_URL is set.
 * A failed refresh does not undo the Studio save; the caller surfaces the warning.
 */
export async function revalidateProductCard(slug: string): Promise<string | null> {
  const url = process.env.PRODUCTS_REVALIDATE_URL
  if (!url) return null

  const secret = process.env.PRODUCTS_REVALIDATE_SECRET
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ slug }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      return `Saved in Studio, but the products site did not refresh (${response.status}).`
    }
    return null
  } catch {
    return 'Saved in Studio, but the products site could not be reached to refresh.'
  }
}

export async function revalidateProductCards(slugs: string[]): Promise<string | null> {
  const unique = [...new Set(slugs.filter(Boolean))]
  for (const slug of unique) {
    const warning = await revalidateProductCard(slug)
    if (warning) return warning
  }
  return null
}
