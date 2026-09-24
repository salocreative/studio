'use server'

import { checkIsAdmin } from '@/app/actions/auth'
import { createClient } from '@/lib/supabase/server'
import { toGbpNumber } from '@/lib/billing/invoices'
import {
  HOSTING_CURRENCIES,
  isBillingCycle,
  isHostingStatus,
  isPaymentMethod,
  type HostingSite,
} from '@/lib/hosting/billing'
import { lookupStripeSubscriptions } from '@/lib/hosting/stripe-api'
import { normaliseStripeReference } from '@/lib/hosting/stripe'

const MIGRATION_ERROR =
  'Hosting is not in the database yet. Apply migration 082_hosting_sites.sql.'

export interface HostingSiteInput {
  id?: string | null
  client_name: string
  site_name: string
  domain?: string | null
  platform?: string | null
  started_on?: string | null
  billing_cycle: string
  amount: number | string
  currency?: string | null
  payment_method: string
  stripe_reference?: string | null
  status: string
  notes?: string | null
}

async function requireAdminClient() {
  const { isAdmin } = await checkIsAdmin()
  if (!isAdmin) return { error: 'Unauthorised: admin access required' as const, supabase: null }
  return { error: null, supabase: await createClient() }
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const message = error.message || ''
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    message.includes('schema cache') ||
    message.includes('does not exist')
  )
}

function asDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return value.slice(0, 10)
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function mapSite(row: Record<string, unknown>): HostingSite {
  const cycle = String(row.billing_cycle || 'monthly')
  const payment = String(row.payment_method || 'invoice')
  const status = String(row.status || 'active')
  return {
    id: String(row.id),
    client_name: String(row.client_name || ''),
    site_name: String(row.site_name || ''),
    domain: typeof row.domain === 'string' ? row.domain : null,
    platform: typeof row.platform === 'string' ? row.platform : null,
    started_on: asDate(row.started_on),
    billing_cycle: isBillingCycle(cycle) ? cycle : 'monthly',
    amount: toGbpNumber(row.amount),
    currency: typeof row.currency === 'string' && row.currency ? row.currency : 'GBP',
    payment_method: isPaymentMethod(payment) ? payment : 'invoice',
    stripe_reference: typeof row.stripe_reference === 'string' ? row.stripe_reference : null,
    status: isHostingStatus(status) ? status : 'active',
    notes: typeof row.notes === 'string' ? row.notes : null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  }
}

export async function getHostingSites() {
  const auth = await requireAdminClient()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Unauthorised' }

  const { data, error } = await auth.supabase
    .from('hosting_sites')
    .select('*')
    .order('client_name', { ascending: true })
    .order('site_name', { ascending: true })

  if (isMissingTable(error)) return { error: MIGRATION_ERROR }
  if (error) return { error: error.message }

  const sites = ((data || []) as Record<string, unknown>[]).map(mapSite)
  const references = sites
    .filter((site) => site.payment_method === 'stripe' && site.stripe_reference)
    .map((site) => site.stripe_reference as string)
  const stripe = await lookupStripeSubscriptions(references)

  return {
    success: true as const,
    sites,
    stripe: stripe.subscriptions,
    stripeError: stripe.error,
  }
}

export async function saveHostingSite(input: HostingSiteInput) {
  const auth = await requireAdminClient()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Unauthorised' }

  const clientName = input.client_name.trim()
  const siteName = input.site_name.trim()
  if (!clientName) return { error: 'Client name is required' }
  if (!siteName) return { error: 'Site name is required' }
  const platform = input.platform?.trim() ?? ''
  if (!platform) return { error: 'Say where the site is hosted' }
  if (!isBillingCycle(input.billing_cycle)) return { error: 'Choose a billing cycle' }
  if (!isPaymentMethod(input.payment_method)) return { error: 'Choose a payment method' }
  if (!isHostingStatus(input.status)) return { error: 'Choose a status' }

  const amount = typeof input.amount === 'number' ? input.amount : parseFloat(input.amount)
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Enter an amount of zero or more' }

  const currency = (input.currency || 'GBP').trim().toUpperCase()
  if (!(HOSTING_CURRENCIES as readonly string[]).includes(currency)) {
    return { error: 'Currency must be GBP or USD' }
  }

  const payload = {
    client_name: clientName,
    site_name: siteName,
    domain: emptyToNull(input.domain),
    platform,
    started_on: emptyToNull(input.started_on),
    billing_cycle: input.billing_cycle,
    amount,
    currency,
    payment_method: input.payment_method,
    stripe_reference:
      input.payment_method === 'stripe' ? normaliseStripeReference(input.stripe_reference) : null,
    status: input.status,
    notes: emptyToNull(input.notes),
  }

  const id = input.id?.trim()
  const query = id
    ? auth.supabase.from('hosting_sites').update(payload).eq('id', id).select('*').single()
    : auth.supabase.from('hosting_sites').insert(payload).select('*').single()

  const { data, error } = await query
  if (isMissingTable(error)) return { error: MIGRATION_ERROR }
  if (error) return { error: error.message }

  const site = mapSite(data as Record<string, unknown>)
  const stripe =
    site.payment_method === 'stripe' && site.stripe_reference
      ? (await lookupStripeSubscriptions([site.stripe_reference])).subscriptions[site.stripe_reference] ?? null
      : null

  return { success: true as const, site, stripe }
}

export async function deleteHostingSite(id: string) {
  const auth = await requireAdminClient()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Unauthorised' }

  const { error } = await auth.supabase.from('hosting_sites').delete().eq('id', id)
  if (isMissingTable(error)) return { error: MIGRATION_ERROR }
  if (error) return { error: error.message }
  return { success: true as const }
}
