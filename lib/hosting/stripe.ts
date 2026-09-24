export type StripeLiveStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'paused'
  | 'canceled'
  | 'canceling'
  | 'incomplete'
  | 'several'
  | 'missing'
  | 'invalid'

export interface StripeSubscriptionInfo {
  status: StripeLiveStatus
  label: string
  dashboardUrl: string | null
  paymentLinkUrl: string | null
  subscriptionId: string | null
  error: string | null
}

export interface ParsedStripeReference {
  kind: 'subscription' | 'customer' | 'unknown'
  id: string
}

const SUBSCRIPTION_ID = /sub_[A-Za-z0-9]+/
const CUSTOMER_ID = /cus_[A-Za-z0-9]+/

export function parseStripeReference(value: string | null | undefined): ParsedStripeReference | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  const subscription = trimmed.match(SUBSCRIPTION_ID)
  if (subscription) return { kind: 'subscription', id: subscription[0] }
  const customer = trimmed.match(CUSTOMER_ID)
  if (customer) return { kind: 'customer', id: customer[0] }
  return { kind: 'unknown', id: trimmed }
}

/** Store the subscription or customer id when one is present in the pasted value. */
export function normaliseStripeReference(value: string | null | undefined): string | null {
  const parsed = parseStripeReference(value)
  if (!parsed) return null
  if (parsed.kind === 'unknown') return parsed.id
  return parsed.id
}

export function stripeDashboardUrl(id: string, livemode: boolean): string {
  const mode = livemode ? '' : '/test'
  if (id.startsWith('sub_')) return `https://dashboard.stripe.com${mode}/subscriptions/${id}`
  if (id.startsWith('cus_')) return `https://dashboard.stripe.com${mode}/customers/${id}`
  return `https://dashboard.stripe.com${mode}/search?query=${encodeURIComponent(id)}`
}

export function formatStripeDate(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return null
  return new Date(unixSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
}

interface StripeSubscriptionShape {
  id?: string
  status?: string
  livemode?: boolean
  cancel_at_period_end?: boolean
  cancel_at?: number | null
  current_period_end?: number | null
  items?: { data?: Array<{ current_period_end?: number | null }> }
}

export function periodEndUnix(subscription: StripeSubscriptionShape): number | null {
  if (typeof subscription.cancel_at === 'number') return subscription.cancel_at
  if (typeof subscription.current_period_end === 'number') return subscription.current_period_end
  const itemEnd = subscription.items?.data?.[0]?.current_period_end
  return typeof itemEnd === 'number' ? itemEnd : null
}

export function describeSubscription(subscription: StripeSubscriptionShape): StripeSubscriptionInfo {
  const id = typeof subscription.id === 'string' ? subscription.id : null
  const livemode = subscription.livemode !== false
  const dashboardUrl = id ? stripeDashboardUrl(id, livemode) : null
  const rawStatus = subscription.status || ''
  const ending = subscription.cancel_at_period_end === true && rawStatus !== 'canceled'
  const endDate = formatStripeDate(periodEndUnix(subscription))

  if (ending) {
    return {
      status: 'canceling',
      label: endDate ? `Cancels ${formatDisplayDate(endDate)}` : 'Cancels at period end',
      dashboardUrl,
      paymentLinkUrl: null,
      subscriptionId: id,
      error: null,
    }
  }

  const known: Record<string, { status: StripeLiveStatus; label: string }> = {
    active: { status: 'active', label: 'Active' },
    trialing: { status: 'trialing', label: 'Trial' },
    past_due: { status: 'past_due', label: 'Past due' },
    unpaid: { status: 'unpaid', label: 'Unpaid' },
    paused: { status: 'paused', label: 'Paused' },
    canceled: { status: 'canceled', label: 'Cancelled' },
    incomplete: { status: 'incomplete', label: 'Incomplete' },
    incomplete_expired: { status: 'incomplete', label: 'Incomplete' },
  }
  const match = known[rawStatus] ?? { status: 'invalid' as const, label: rawStatus || 'Unknown' }
  return {
    status: match.status,
    label: match.label,
    dashboardUrl,
    paymentLinkUrl: null,
    subscriptionId: id,
    error: null,
  }
}

export function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function stripeStatusNeedsAttention(status: StripeLiveStatus): boolean {
  return status === 'canceled' || status === 'canceling' || status === 'past_due' || status === 'unpaid'
}
