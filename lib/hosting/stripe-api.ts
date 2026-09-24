import {
  describeSubscription,
  parseStripeReference,
  stripeDashboardUrl,
  type StripeSubscriptionInfo,
} from '@/lib/hosting/stripe'

interface StripeSubscriptionShape {
  id?: string
  status?: string
  livemode?: boolean
  cancel_at_period_end?: boolean
  cancel_at?: number | null
  current_period_end?: number | null
  items?: { data?: Array<{ current_period_end?: number | null }> }
}

async function stripeGet(path: string): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; code: string | null; message: string }
> {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return { ok: false, status: 0, code: null, message: 'Stripe key is not set' }

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string }
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: body.error?.code || null,
      message: body.error?.message || `Stripe returned ${response.status}`,
    }
  }
  return { ok: true, body: body as Record<string, unknown> }
}

function missingInfo(id: string, livemode: boolean): StripeSubscriptionInfo {
  return {
    status: 'missing',
    label: 'Not found in Stripe',
    dashboardUrl: stripeDashboardUrl(id, livemode),
    paymentLinkUrl: null,
    subscriptionId: id.startsWith('sub_') ? id : null,
    error: null,
  }
}

async function findPaymentLinkUrl(subscriptionId: string): Promise<string | null> {
  const sessions = await stripeGet(
    `/checkout/sessions?subscription=${encodeURIComponent(subscriptionId)}&limit=10`
  )
  if (!sessions.ok || !Array.isArray(sessions.body.data)) return null

  for (const session of sessions.body.data as Array<{ payment_link?: unknown }>) {
    const link = session.payment_link
    const linkId =
      typeof link === 'string' ? link : link && typeof link === 'object' && 'id' in link ? String(link.id) : null
    if (!linkId) continue
    const paymentLink = await stripeGet(`/payment_links/${encodeURIComponent(linkId)}`)
    if (paymentLink.ok && typeof paymentLink.body.url === 'string' && paymentLink.body.url) {
      return paymentLink.body.url
    }
  }
  return null
}

async function attachPaymentLink(info: StripeSubscriptionInfo): Promise<StripeSubscriptionInfo> {
  if (!info.subscriptionId) return info
  try {
    const paymentLinkUrl = await findPaymentLinkUrl(info.subscriptionId)
    return { ...info, paymentLinkUrl }
  } catch {
    return info
  }
}

async function lookupSubscription(id: string): Promise<StripeSubscriptionInfo> {
  const result = await stripeGet(`/subscriptions/${encodeURIComponent(id)}`)
  if (!result.ok) {
    if (result.status === 404 || result.code === 'resource_missing') return missingInfo(id, true)
    return {
      status: 'invalid',
      label: 'Stripe unavailable',
      dashboardUrl: stripeDashboardUrl(id, true),
      paymentLinkUrl: null,
      subscriptionId: id,
      error: result.message,
    }
  }
  return attachPaymentLink(describeSubscription(result.body as StripeSubscriptionShape))
}

async function lookupCustomer(id: string): Promise<StripeSubscriptionInfo> {
  const result = await stripeGet(
    `/subscriptions?customer=${encodeURIComponent(id)}&status=all&limit=10`
  )
  const customerUrl = stripeDashboardUrl(id, true)
  if (!result.ok) {
    if (result.status === 404 || result.code === 'resource_missing') return missingInfo(id, true)
    return {
      status: 'invalid',
      label: 'Stripe unavailable',
      dashboardUrl: customerUrl,
      paymentLinkUrl: null,
      subscriptionId: null,
      error: result.message,
    }
  }

  const subscriptions = Array.isArray(result.body.data)
    ? (result.body.data as StripeSubscriptionShape[])
    : []
  if (subscriptions.length === 0) {
    return {
      status: 'missing',
      label: 'No subscription',
      dashboardUrl: customerUrl,
      paymentLinkUrl: null,
      subscriptionId: null,
      error: null,
    }
  }

  const open = subscriptions.filter((subscription) => subscription.status !== 'canceled')
  if (subscriptions.length > 1 && open.length !== 1) {
    return {
      status: 'several',
      label: `${subscriptions.length} subscriptions`,
      dashboardUrl: customerUrl,
      paymentLinkUrl: null,
      subscriptionId: null,
      error: null,
    }
  }

  const chosen = open[0] ?? subscriptions[0]
  const described = describeSubscription(chosen)
  if (!described.dashboardUrl) described.dashboardUrl = customerUrl
  return attachPaymentLink(described)
}

export async function lookupStripeSubscriptions(
  references: string[]
): Promise<{ subscriptions: Record<string, StripeSubscriptionInfo>; error: string | null }> {
  const unique = Array.from(new Set(references.map((reference) => reference.trim()).filter(Boolean)))
  if (unique.length === 0) return { subscriptions: {}, error: null }
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    return { subscriptions: {}, error: 'Stripe key is not set' }
  }

  const entries = await Promise.all(
    unique.map(async (reference) => {
      const parsed = parseStripeReference(reference)
      if (!parsed || parsed.kind === 'unknown') {
        const info: StripeSubscriptionInfo = {
          status: 'invalid',
          label: 'Needs a sub_ ID',
          dashboardUrl: null,
          paymentLinkUrl: null,
          subscriptionId: null,
          error: null,
        }
        return [reference, info] as const
      }
      try {
        const info =
          parsed.kind === 'subscription'
            ? await lookupSubscription(parsed.id)
            : await lookupCustomer(parsed.id)
        return [reference, info] as const
      } catch (error) {
        const info: StripeSubscriptionInfo = {
          status: 'invalid',
          label: 'Stripe unavailable',
          dashboardUrl: stripeDashboardUrl(parsed.id, true),
          paymentLinkUrl: null,
          subscriptionId: parsed.kind === 'subscription' ? parsed.id : null,
          error: error instanceof Error ? error.message : 'Stripe request failed',
        }
        return [reference, info] as const
      }
    })
  )

  return { subscriptions: Object.fromEntries(entries), error: null }
}
