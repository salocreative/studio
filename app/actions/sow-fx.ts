'use server'

import type { SowCurrency } from '@/lib/sow/calculations'

/**
 * Fetch units of `currency` per £1 (e.g. USD per GBP).
 * Uses Frankfurter (ECB) — no API key required.
 */
export async function getGbpFxRate(currency: SowCurrency) {
  if (currency === 'GBP') {
    return { success: true as const, rate: 1, asOf: null as string | null }
  }

  try {
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=GBP&to=${encodeURIComponent(currency)}`,
      { next: { revalidate: 3600 } }
    )
    if (!response.ok) {
      return { error: `Could not fetch exchange rate (${response.status})` }
    }
    const data = (await response.json()) as {
      date?: string
      rates?: Record<string, number>
    }
    const rate = data.rates?.[currency]
    if (!(typeof rate === 'number' && rate > 0)) {
      return { error: `No exchange rate returned for ${currency}` }
    }
    return {
      success: true as const,
      rate: Math.round(rate * 1_000_000) / 1_000_000,
      asOf: data.date || null,
    }
  } catch (error) {
    console.error('Error fetching FX rate:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to fetch exchange rate',
    }
  }
}
