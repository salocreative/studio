'use server'

import { randomBytes } from 'node:crypto'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { PRODUCT_CARDS_BUCKET } from '@/lib/product-cards/model'
import { revalidateProductCards } from '@/lib/product-cards/revalidate'
import {
  exampleIsPublic,
  formatCardPrice,
  isCoverImageSource,
  isCtaKind,
  isExampleKind,
  isItemSection,
  isPricingModel,
  isProductCardStatus,
  isPublicCardStatus,
  productCardPageUrl,
  productCardPublishIssues,
  productsSiteOrigin,
  slugifyProductName,
  type CoverImageSource,
  type CtaKind,
  type ExampleKind,
  type ItemSection,
  type PricingModel,
  type ProductCardItemInput,
  type ProductCardStatus,
} from '@/lib/product-cards/model'

const MIGRATION_ERROR =
  'Product cards are not in the database yet. Apply migration 085_product_cards.sql.'

const COVER_MIGRATION_ERROR =
  'Cover images are not in the database yet. Apply migration 086_product_card_cover.sql.'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ProductCardRecord {
  id: string
  slug: string
  name: string
  category: string
  status: ProductCardStatus
  decision_statement: string
  summary: string
  pricing_model: PricingModel
  price_amount: number | null
  currency: string
  price_basis: string
  payment_terms: string
  price_note: string | null
  flexi_service_id: string | null
  flexi_service_title: string | null
  credit_override: number | null
  credit_estimate: number | null
  timeline_text: string
  cta_kind: CtaKind
  cta_target: string
  owner_user_id: string | null
  indexable: boolean
  meta_title: string | null
  meta_description: string | null
  og_image_path: string | null
  cover_image_path: string | null
  cover_image_alt: string | null
  cover_image_source: CoverImageSource | null
  cover_image_signoff_by: string | null
  cover_image_signoff_at: string | null
  cover_image_signoff_name: string | null
  published_at: string | null
  sort_order: number
  updated_at: string
}

export interface ProductCardListItem {
  id: string
  slug: string
  name: string
  category: string
  status: ProductCardStatus
  pricing_model: PricingModel
  price_label: string
  cover_image_path: string | null
  cover_image_alt: string | null
  updated_at: string
  views_30d: number
}

export interface ProductCardItem extends ProductCardItemInput {
  id: string
  sort_order: number
}

export interface ProductCardExample {
  id: string
  kind: ExampleKind
  title: string
  caption: string
  storage_path: string | null
  url: string | null
  company_name: string | null
  case_study_path: string | null
  signoff_by: string | null
  signoff_at: string | null
  signoff_note: string | null
  signoff_name: string | null
  sort_order: number
  is_public: boolean
}

export interface ProductCardLink {
  id: string
  token: string
  url: string
  label: string
  contact_name: string | null
  contact_email: string | null
  created_at: string
  expires_at: string | null
  is_active: boolean
  view_count: number
  first_viewed_at: string | null
  last_viewed_at: string | null
}

export interface FlexiServiceOption {
  id: string
  category: string
  title: string
  credit_estimate: number
}

export interface TeamMemberOption {
  id: string
  full_name: string | null
  email: string
}

export interface RelatedCardOption {
  id: string
  name: string
  status: ProductCardStatus
}

export interface ProductCardSaveInput {
  id: string
  slug: string
  name: string
  category: string
  status: ProductCardStatus
  decision_statement: string
  summary: string
  pricing_model: PricingModel
  price_amount: number | null
  currency: string
  price_basis: string
  payment_terms: string
  price_note: string | null
  flexi_service_id: string | null
  credit_override: number | null
  timeline_text: string
  cta_kind: CtaKind
  cta_target: string
  owner_user_id: string | null
  indexable: boolean
  meta_title: string | null
  meta_description: string | null
  sort_order: number
  items: ProductCardItemInput[]
  related_card_ids: string[]
}

export interface ProductCardExampleInput {
  id?: string | null
  card_id: string
  kind: ExampleKind
  title: string
  caption: string
  storage_path?: string | null
  url?: string | null
  company_name?: string | null
  case_study_path?: string | null
  signoff: boolean
  signoff_note?: string | null
}

export interface ProductCardLinkInput {
  card_id: string
  label?: string | null
  contact_name?: string | null
  contact_email?: string | null
  expires_on?: string | null
}

type ActionError = { error: string; issues?: string[] }

async function requireTeam() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, supabase: null, user: null, role: null }

  const { data: profile } = await supabase
    .from('users')
    .select('role, full_name, email')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  const role = profile?.role === 'employee' ? 'manager' : profile?.role
  if (role !== 'admin' && role !== 'designer' && role !== 'manager') {
    return { error: 'Unauthorised' as const, supabase: null, user: null, role: null }
  }

  return {
    error: null,
    supabase,
    user,
    role: role as 'admin' | 'designer' | 'manager',
    name: (profile?.full_name as string | null) ?? null,
    email: (profile?.email as string | null) ?? user.email ?? '',
  }
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const message = error.message || ''
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === 'PGRST202' ||
    message.includes('schema cache') ||
    message.includes('does not exist')
  )
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function personName(member: { full_name: string | null; email: string } | undefined): string | null {
  if (!member) return null
  return member.full_name?.trim() || member.email || null
}

function mapCard(row: Record<string, unknown>, service?: { title?: string; credit_estimate?: unknown } | null): ProductCardRecord {
  const status = String(row.status || 'draft')
  const pricing = String(row.pricing_model || 'fixed')
  const cta = String(row.cta_kind || 'book_call')
  const creditOverride = asNumber(row.credit_override)
  const serviceCredits = asNumber(service?.credit_estimate)
  return {
    id: String(row.id),
    slug: String(row.slug || ''),
    name: String(row.name || ''),
    category: String(row.category || ''),
    status: isProductCardStatus(status) ? status : 'draft',
    decision_statement: String(row.decision_statement || ''),
    summary: String(row.summary || ''),
    pricing_model: isPricingModel(pricing) ? pricing : 'fixed',
    price_amount: asNumber(row.price_amount),
    currency: String(row.currency || 'GBP'),
    price_basis: String(row.price_basis || ''),
    payment_terms: String(row.payment_terms || ''),
    price_note: typeof row.price_note === 'string' ? row.price_note : null,
    flexi_service_id: typeof row.flexi_service_id === 'string' ? row.flexi_service_id : null,
    flexi_service_title: service?.title ?? null,
    credit_override: creditOverride,
    credit_estimate: creditOverride ?? serviceCredits,
    timeline_text: String(row.timeline_text || ''),
    cta_kind: isCtaKind(cta) ? cta : 'book_call',
    cta_target: String(row.cta_target || ''),
    owner_user_id: typeof row.owner_user_id === 'string' ? row.owner_user_id : null,
    indexable: row.indexable === true,
    meta_title: typeof row.meta_title === 'string' ? row.meta_title : null,
    meta_description: typeof row.meta_description === 'string' ? row.meta_description : null,
    og_image_path: typeof row.og_image_path === 'string' ? row.og_image_path : null,
    cover_image_path: typeof row.cover_image_path === 'string' ? row.cover_image_path : null,
    cover_image_alt: typeof row.cover_image_alt === 'string' ? row.cover_image_alt : null,
    cover_image_source: isCoverImageSource(String(row.cover_image_source || ''))
      ? (row.cover_image_source as CoverImageSource)
      : null,
    cover_image_signoff_by: typeof row.cover_image_signoff_by === 'string' ? row.cover_image_signoff_by : null,
    cover_image_signoff_at: typeof row.cover_image_signoff_at === 'string' ? row.cover_image_signoff_at : null,
    cover_image_signoff_name: null,
    published_at: typeof row.published_at === 'string' ? row.published_at : null,
    sort_order: asNumber(row.sort_order) ?? 0,
    updated_at: String(row.updated_at || ''),
  }
}

async function loadTeam(): Promise<TeamMemberOption[]> {
  const admin = await createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('users')
    .select('id, full_name, email')
    .is('deleted_at', null)
    .order('full_name', { ascending: true })
  return ((data || []) as { id: string; full_name: string | null; email: string }[]).map((member) => ({
    id: member.id,
    full_name: member.full_name,
    email: member.email,
  }))
}

async function uniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  base: string
): Promise<string> {
  const root = base || 'product'
  let slug = root
  for (let attempt = 2; attempt < 40; attempt += 1) {
    const { data } = await supabase.from('product_cards').select('id').eq('slug', slug).maybeSingle()
    if (!data) return slug
    slug = `${root}-${attempt}`
  }
  return `${root}-${Date.now()}`
}

async function revalidateCardChange(
  previous: { slug: string; status: ProductCardStatus } | null,
  next: { slug: string; status: ProductCardStatus }
): Promise<string | null> {
  const slugs: string[] = []
  if (previous && isPublicCardStatus(previous.status)) slugs.push(previous.slug)
  if (isPublicCardStatus(next.status)) slugs.push(next.slug)
  return revalidateProductCards(slugs)
}

export async function listProductCards(): Promise<
  ActionError | { success: true; cards: ProductCardListItem[]; canManage: boolean; siteOrigin: string }
> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }

  const { data, error } = await auth.supabase
    .from('product_cards')
    .select('*, flexi_service:flexi_design_services!flexi_service_id(title, credit_estimate)')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (isMissingTable(error)) return { error: MIGRATION_ERROR }
  if (error) return { error: error.message }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: counts, error: countError } = await auth.supabase.rpc('product_card_view_counts', {
    p_since: since,
  })
  if (isMissingTable(countError)) return { error: MIGRATION_ERROR }
  if (countError) return { error: countError.message }

  const views = new Map<string, number>()
  for (const row of (counts || []) as { card_id: string; views: number | string }[]) {
    views.set(row.card_id, Number(row.views) || 0)
  }

  const cards = ((data || []) as Record<string, unknown>[]).map((row) => {
    const service = row.flexi_service as { title?: string; credit_estimate?: unknown } | null
    const card = mapCard(row, service)
    return {
      id: card.id,
      slug: card.slug,
      name: card.name,
      category: card.category,
      status: card.status,
      pricing_model: card.pricing_model,
      price_label: formatCardPrice(card),
      cover_image_path: card.cover_image_path,
      cover_image_alt: card.cover_image_alt,
      updated_at: card.updated_at,
      views_30d: views.get(card.id) ?? 0,
    }
  })

  return {
    success: true,
    cards,
    canManage: true,
    siteOrigin: productsSiteOrigin(),
  }
}

export async function createProductCard(
  name: string
): Promise<ActionError | { success: true; id: string }> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Add a name.' }
  const slug = await uniqueSlug(auth.supabase, slugifyProductName(trimmed))

  const { data: last } = await auth.supabase
    .from('product_cards')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await auth.supabase
    .from('product_cards')
    .insert({
      name: trimmed,
      slug,
      status: 'draft',
      pricing_model: 'fixed',
      currency: 'GBP',
      cta_kind: 'book_call',
      owner_user_id: auth.user?.id ?? null,
      sort_order: (asNumber(last?.sort_order) ?? -1) + 1,
    })
    .select('id')
    .single()

  if (isMissingTable(error)) return { error: MIGRATION_ERROR }
  if (error) return { error: error.message }
  return { success: true, id: String(data.id) }
}

export async function getProductCard(id: string): Promise<
  | ActionError
  | {
      success: true
      card: ProductCardRecord
      items: ProductCardItem[]
      examples: ProductCardExample[]
      links: ProductCardLink[]
      related_card_ids: string[]
      related_options: RelatedCardOption[]
      services: FlexiServiceOption[]
      team: TeamMemberOption[]
      views_30d: number
      views_total: number
      canManage: boolean
      siteOrigin: string
    }
> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }
  if (!UUID_RE.test(id)) return { error: 'Product card not found.' }

  const supabase = auth.supabase
  const { data: row, error } = await supabase
    .from('product_cards')
    .select('*, flexi_service:flexi_design_services!flexi_service_id(title, credit_estimate)')
    .eq('id', id)
    .maybeSingle()

  if (isMissingTable(error)) return { error: MIGRATION_ERROR }
  if (error) return { error: error.message }
  if (!row) return { error: 'Product card not found.' }

  const [itemsResult, examplesResult, linksResult, relatedResult, optionsResult, servicesResult, statsResult, totalResult, recentResult, team] =
    await Promise.all([
      supabase
        .from('product_card_items')
        .select('*')
        .eq('card_id', id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('product_card_examples')
        .select('*')
        .eq('card_id', id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('product_card_links')
        .select('*')
        .eq('card_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('product_card_related')
        .select('related_card_id, sort_order')
        .eq('card_id', id)
        .order('sort_order', { ascending: true }),
      supabase.from('product_cards').select('id, name, status').neq('id', id).order('name'),
      supabase
        .from('flexi_design_services')
        .select('id, category, title, credit_estimate')
        .eq('is_active', true)
        .order('category')
        .order('title'),
      supabase.rpc('product_card_link_stats', { p_card_id: id }),
      supabase.from('product_card_views').select('id', { count: 'exact', head: true }).eq('card_id', id),
      supabase
        .from('product_card_views')
        .select('id', { count: 'exact', head: true })
        .eq('card_id', id)
        .gte('viewed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      loadTeam(),
    ])

  const firstError = [itemsResult.error, examplesResult.error, linksResult.error, relatedResult.error, statsResult.error].find(Boolean)
  if (isMissingTable(firstError ?? null)) return { error: MIGRATION_ERROR }
  if (firstError) return { error: firstError.message }

  const service = (row as { flexi_service?: { title?: string; credit_estimate?: unknown } | null }).flexi_service
  const card = mapCard(row as Record<string, unknown>, service)
  const names = new Map(team.map((member) => [member.id, personName(member)]))
  card.cover_image_signoff_name = card.cover_image_signoff_by
    ? names.get(card.cover_image_signoff_by) ?? null
    : null

  const items = ((itemsResult.data || []) as Record<string, unknown>[])
    .map((item) => {
      const section = String(item.section || '')
      if (!isItemSection(section)) return null
      return {
        id: String(item.id),
        section,
        title: String(item.title || ''),
        body: String(item.body || ''),
        sort_order: asNumber(item.sort_order) ?? 0,
      }
    })
    .filter((item): item is ProductCardItem => item != null)

  const examples = ((examplesResult.data || []) as Record<string, unknown>[]).map((example) => {
    const kind = String(example.kind || 'image')
    const mapped = {
      id: String(example.id),
      kind: isExampleKind(kind) ? kind : 'image',
      title: String(example.title || ''),
      caption: String(example.caption || ''),
      storage_path: typeof example.storage_path === 'string' ? example.storage_path : null,
      url: typeof example.url === 'string' ? example.url : null,
      company_name: typeof example.company_name === 'string' ? example.company_name : null,
      case_study_path: typeof example.case_study_path === 'string' ? example.case_study_path : null,
      signoff_by: typeof example.signoff_by === 'string' ? example.signoff_by : null,
      signoff_at: typeof example.signoff_at === 'string' ? example.signoff_at : null,
      signoff_note: typeof example.signoff_note === 'string' ? example.signoff_note : null,
      signoff_name: typeof example.signoff_by === 'string' ? names.get(example.signoff_by) ?? null : null,
      sort_order: asNumber(example.sort_order) ?? 0,
      is_public: false,
    }
    mapped.is_public = exampleIsPublic(mapped)
    return mapped
  })

  const stats = new Map<string, { view_count: number; first_viewed_at: string | null; last_viewed_at: string | null }>()
  for (const stat of (statsResult.data || []) as {
    link_id: string
    view_count: number | string
    first_viewed_at: string | null
    last_viewed_at: string | null
  }[]) {
    stats.set(stat.link_id, {
      view_count: Number(stat.view_count) || 0,
      first_viewed_at: stat.first_viewed_at,
      last_viewed_at: stat.last_viewed_at,
    })
  }

  const links = ((linksResult.data || []) as Record<string, unknown>[]).map((link) => {
    const linkId = String(link.id)
    const stat = stats.get(linkId)
    const token = String(link.token || '')
    return {
      id: linkId,
      token,
      url: productCardPageUrl(card.slug, token),
      label: String(link.label || ''),
      contact_name: typeof link.contact_name === 'string' ? link.contact_name : null,
      contact_email: typeof link.contact_email === 'string' ? link.contact_email : null,
      created_at: String(link.created_at || ''),
      expires_at: typeof link.expires_at === 'string' ? link.expires_at : null,
      is_active: link.is_active !== false,
      view_count: stat?.view_count ?? 0,
      first_viewed_at: stat?.first_viewed_at ?? null,
      last_viewed_at: stat?.last_viewed_at ?? null,
    }
  })

  const services = ((servicesResult.data || []) as Record<string, unknown>[]).map((serviceRow) => ({
    id: String(serviceRow.id),
    category: String(serviceRow.category || ''),
    title: String(serviceRow.title || ''),
    credit_estimate: asNumber(serviceRow.credit_estimate) ?? 0,
  }))

  const relatedOptions = ((optionsResult.data || []) as Record<string, unknown>[])
    .map((option) => {
      const status = String(option.status || 'draft')
      return {
        id: String(option.id),
        name: String(option.name || ''),
        status: isProductCardStatus(status) ? status : 'draft',
      }
    })

  return {
    success: true,
    card,
    items,
    examples,
    links,
    related_card_ids: ((relatedResult.data || []) as { related_card_id: string }[]).map(
      (related) => related.related_card_id
    ),
    related_options: relatedOptions,
    services,
    team,
    views_30d: recentResult.count ?? 0,
    views_total: totalResult.count ?? 0,
    canManage: true,
    siteOrigin: productsSiteOrigin(),
  }
}

export async function saveProductCard(
  input: ProductCardSaveInput
): Promise<ActionError | { success: true; revalidateWarning: string | null }> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }
  if (!UUID_RE.test(input.id)) return { error: 'Product card not found.' }
  if (!isProductCardStatus(input.status)) return { error: 'Choose a status.' }
  if (!isPricingModel(input.pricing_model)) return { error: 'Choose a pricing model.' }
  if (!isCtaKind(input.cta_kind)) return { error: 'Choose a call to action.' }

  const name = input.name.trim()
  if (!name) return { error: 'Add a name.' }
  const slug = slugifyProductName(input.slug || name)
  if (!slug) return { error: 'Add a URL slug.' }

  const priceAmount = input.pricing_model === 'fixed' ? input.price_amount : null
  const creditOverride = input.pricing_model === 'flexi' ? input.credit_override : null
  if (priceAmount != null && (!Number.isFinite(priceAmount) || priceAmount < 0)) {
    return { error: 'Enter a price of zero or more.' }
  }
  if (creditOverride != null && (!Number.isFinite(creditOverride) || creditOverride < 0)) {
    return { error: 'Enter a credit override of zero or more.' }
  }
  if (input.pricing_model === 'fixed' && !(input.currency === 'GBP' || input.currency === 'USD')) {
    return { error: 'Currency must be GBP or USD.' }
  }

  const filledItems = input.items
    .filter((item) => isItemSection(item.section) && (item.title.trim() || item.body.trim()))
    .map((item) => ({
      id: item.id && UUID_RE.test(item.id) ? item.id : null,
      section: item.section,
      title: item.title.trim(),
      body: item.body.trim(),
    }))

  if (input.status === 'published' || input.status === 'unlisted') {
    const issues = productCardPublishIssues({
      name,
      slug,
      decision_statement: input.decision_statement,
      pricing_model: input.pricing_model,
      price_amount: priceAmount,
      currency: input.currency,
      price_basis: input.price_basis,
      payment_terms: input.payment_terms,
      flexi_service_id: input.pricing_model === 'flexi' ? input.flexi_service_id : null,
      cta_kind: input.cta_kind,
      cta_target: input.cta_target,
      items: filledItems,
    })
    if (issues.length > 0) {
      return { error: 'This card is not ready to publish.', issues }
    }
  }

  const supabase = auth.supabase
  const { data: existing, error: existingError } = await supabase
    .from('product_cards')
    .select('id, slug, status, published_at')
    .eq('id', input.id)
    .maybeSingle()
  if (isMissingTable(existingError)) return { error: MIGRATION_ERROR }
  if (existingError) return { error: existingError.message }
  if (!existing) return { error: 'Product card not found.' }

  const { data: slugOwner } = await supabase
    .from('product_cards')
    .select('id')
    .eq('slug', slug)
    .neq('id', input.id)
    .maybeSingle()
  if (slugOwner) return { error: 'Another card already uses that URL slug.' }

  const relatedIds = [...new Set(input.related_card_ids.filter((relatedId) => UUID_RE.test(relatedId) && relatedId !== input.id))]
  const sortOrder = Number.isFinite(input.sort_order) ? Math.max(0, Math.floor(input.sort_order)) : 0
  const becomingPublic = input.status === 'published' || input.status === 'unlisted'
  const publishedAt =
    becomingPublic && !existing.published_at ? new Date().toISOString() : existing.published_at

  const payload = {
    slug,
    name,
    category: input.category.trim(),
    status: input.status,
    decision_statement: input.decision_statement.trim(),
    summary: input.summary.trim(),
    pricing_model: input.pricing_model,
    price_amount: priceAmount,
    currency: input.currency === 'USD' ? 'USD' : 'GBP',
    price_basis: input.pricing_model === 'fixed' ? input.price_basis.trim() : '',
    payment_terms: input.pricing_model === 'fixed' ? input.payment_terms.trim() : '',
    price_note: input.pricing_model === 'fixed' ? blankToNull(input.price_note) : null,
    flexi_service_id: input.pricing_model === 'flexi' ? input.flexi_service_id : null,
    credit_override: creditOverride,
    timeline_text: input.timeline_text.trim(),
    cta_kind: input.cta_kind,
    cta_target: input.cta_target.trim(),
    owner_user_id: input.owner_user_id && UUID_RE.test(input.owner_user_id) ? input.owner_user_id : null,
    indexable: input.indexable === true,
    meta_title: blankToNull(input.meta_title),
    meta_description: blankToNull(input.meta_description),
    published_at: publishedAt,
    sort_order: sortOrder,
  }

  const { error: updateError } = await supabase.from('product_cards').update(payload).eq('id', input.id)
  if (updateError) {
    if (updateError.code === '23503') return { error: 'Choose a Flexi-Design service that is still in the catalogue.' }
    return { error: updateError.message }
  }

  const { data: currentItems, error: itemsError } = await supabase
    .from('product_card_items')
    .select('id')
    .eq('card_id', input.id)
  if (itemsError) return { error: itemsError.message }

  const keptIds = new Set(filledItems.map((item) => item.id).filter((itemId): itemId is string => Boolean(itemId)))
  const removedIds = ((currentItems || []) as { id: string }[])
    .map((item) => item.id)
    .filter((itemId) => !keptIds.has(itemId))
  if (removedIds.length > 0) {
    const { error: deleteError } = await supabase.from('product_card_items').delete().in('id', removedIds)
    if (deleteError) return { error: deleteError.message }
  }

  const sectionCount: Partial<Record<ItemSection, number>> = {}
  for (const item of filledItems) {
    const sort = sectionCount[item.section] ?? 0
    sectionCount[item.section] = sort + 1
    if (item.id) {
      const { error: itemError } = await supabase
        .from('product_card_items')
        .update({ section: item.section, title: item.title, body: item.body, sort_order: sort })
        .eq('id', item.id)
        .eq('card_id', input.id)
      if (itemError) return { error: itemError.message }
    } else {
      const { error: itemError } = await supabase.from('product_card_items').insert({
        card_id: input.id,
        section: item.section,
        title: item.title,
        body: item.body,
        sort_order: sort,
      })
      if (itemError) return { error: itemError.message }
    }
  }

  const { data: currentRelated, error: relatedError } = await supabase
    .from('product_card_related')
    .select('related_card_id')
    .eq('card_id', input.id)
  if (relatedError) return { error: relatedError.message }

  const currentRelatedIds = new Set(((currentRelated || []) as { related_card_id: string }[]).map((row) => row.related_card_id))
  const removedRelated = [...currentRelatedIds].filter((relatedId) => !relatedIds.includes(relatedId))
  if (removedRelated.length > 0) {
    const { error: deleteRelatedError } = await supabase
      .from('product_card_related')
      .delete()
      .eq('card_id', input.id)
      .in('related_card_id', removedRelated)
    if (deleteRelatedError) return { error: deleteRelatedError.message }
  }

  for (const [index, relatedId] of relatedIds.entries()) {
    if (currentRelatedIds.has(relatedId)) {
      const { error: orderError } = await supabase
        .from('product_card_related')
        .update({ sort_order: index })
        .eq('card_id', input.id)
        .eq('related_card_id', relatedId)
      if (orderError) return { error: orderError.message }
    } else {
      const { error: insertRelatedError } = await supabase.from('product_card_related').insert({
        card_id: input.id,
        related_card_id: relatedId,
        sort_order: index,
      })
      if (insertRelatedError) {
        if (insertRelatedError.code === '23503') return { error: 'One of the related cards no longer exists.' }
        return { error: insertRelatedError.message }
      }
    }
  }

  const previousStatus = isProductCardStatus(String(existing.status)) ? (existing.status as ProductCardStatus) : 'draft'
  const revalidateWarning = await revalidateCardChange(
    { slug: String(existing.slug), status: previousStatus },
    { slug, status: input.status }
  )

  return { success: true, revalidateWarning }
}

export async function deleteProductCard(id: string): Promise<ActionError | { success: true }> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }
  const { data: existing, error: existingError } = await auth.supabase
    .from('product_cards')
    .select('status')
    .eq('id', id)
    .maybeSingle()
  if (isMissingTable(existingError)) return { error: MIGRATION_ERROR }
  if (existingError) return { error: existingError.message }
  if (!existing) return { error: 'Product card not found.' }
  if (existing.status !== 'draft') {
    return { error: 'Retire a live card instead of deleting it, so links that have been sent still open.' }
  }

  const { error } = await auth.supabase.from('product_cards').delete().eq('id', id)
  if (error) return { error: error.message }
  return { success: true }
}

export async function setProductCardOgImage(
  cardId: string,
  storagePath: string | null
): Promise<ActionError | { success: true; og_image_path: string | null; revalidateWarning: string | null }> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }
  const { data: existing, error: existingError } = await auth.supabase
    .from('product_cards')
    .select('slug, status, og_image_path')
    .eq('id', cardId)
    .maybeSingle()
  if (isMissingTable(existingError)) return { error: MIGRATION_ERROR }
  if (existingError) return { error: existingError.message }
  if (!existing) return { error: 'Product card not found.' }

  const nextPath = blankToNull(storagePath)
  const { error } = await auth.supabase.from('product_cards').update({ og_image_path: nextPath }).eq('id', cardId)
  if (error) return { error: error.message }

  const previous = typeof existing.og_image_path === 'string' ? existing.og_image_path : null
  if (previous && previous !== nextPath) {
    await auth.supabase.storage.from(PRODUCT_CARDS_BUCKET).remove([previous])
  }

  const status = isProductCardStatus(String(existing.status)) ? (existing.status as ProductCardStatus) : 'draft'
  const revalidateWarning = await revalidateCardChange(
    { slug: String(existing.slug), status },
    { slug: String(existing.slug), status }
  )
  return { success: true, og_image_path: nextPath, revalidateWarning }
}

export interface ProductCardCoverResult {
  cover_image_path: string | null
  cover_image_alt: string | null
  cover_image_source: CoverImageSource | null
  cover_image_signoff_by: string | null
  cover_image_signoff_at: string | null
  cover_image_signoff_name: string | null
  revalidateWarning: string | null
}

function isMissingCoverColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const message = error.message || ''
  return error.code === '42703' || message.includes('cover_image')
}

export async function setProductCardCover(input: {
  cardId: string
  cover_image_path: string | null
  cover_image_alt: string | null
  cover_image_source: CoverImageSource | null
}): Promise<ActionError | ({ success: true } & ProductCardCoverResult)> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }
  const path = blankToNull(input.cover_image_path)
  const alt = blankToNull(input.cover_image_alt)
  const source = input.cover_image_source
  if (path && !alt) return { error: 'Add alt text for the cover image.' }
  if (path && !isCoverImageSource(source || '')) return { error: 'Choose whether the cover is client work or a sample.' }
  if (!path && (alt || source)) return { error: 'Add a cover image before saving its text.' }

  const { data: existing, error: existingError } = await auth.supabase
    .from('product_cards')
    .select('slug, status, cover_image_path, cover_image_source, cover_image_signoff_by, cover_image_signoff_at')
    .eq('id', input.cardId)
    .maybeSingle()
  if (isMissingTable(existingError)) return { error: MIGRATION_ERROR }
  if (isMissingCoverColumn(existingError)) return { error: COVER_MIGRATION_ERROR }
  if (existingError) return { error: existingError.message }
  if (!existing) return { error: 'Product card not found.' }

  const previousPath = typeof existing.cover_image_path === 'string' ? existing.cover_image_path : null
  const previousSource = isCoverImageSource(String(existing.cover_image_source || ''))
    ? existing.cover_image_source
    : null
  const keepSignoff = Boolean(path) && path === previousPath && source === previousSource
  const signoffBy = keepSignoff && typeof existing.cover_image_signoff_by === 'string' ? existing.cover_image_signoff_by : null
  const signoffAt = keepSignoff && typeof existing.cover_image_signoff_at === 'string' ? existing.cover_image_signoff_at : null

  const { error } = await auth.supabase
    .from('product_cards')
    .update({
      cover_image_path: path,
      cover_image_alt: path ? alt : null,
      cover_image_source: path ? source : null,
      cover_image_signoff_by: path ? signoffBy : null,
      cover_image_signoff_at: path ? signoffAt : null,
    })
    .eq('id', input.cardId)
  if (isMissingCoverColumn(error)) return { error: COVER_MIGRATION_ERROR }
  if (error) return { error: error.message }

  const status = isProductCardStatus(String(existing.status)) ? (existing.status as ProductCardStatus) : 'draft'
  const revalidateWarning = await revalidateCardChange(
    { slug: String(existing.slug), status },
    { slug: String(existing.slug), status }
  )
  const signoffName =
    signoffBy && signoffBy === auth.user?.id ? auth.name?.trim() || auth.email || null : null

  return {
    success: true,
    cover_image_path: path,
    cover_image_alt: path ? alt : null,
    cover_image_source: path && isCoverImageSource(source || '') ? source : null,
    cover_image_signoff_by: path ? signoffBy : null,
    cover_image_signoff_at: path ? signoffAt : null,
    cover_image_signoff_name: path ? signoffName : null,
    revalidateWarning,
  }
}

export async function signOffProductCardCover(
  cardId: string
): Promise<ActionError | ({ success: true } & ProductCardCoverResult)> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase || !auth.user) return { error: auth.error || 'Not authenticated' }
  const { data: existing, error: existingError } = await auth.supabase
    .from('product_cards')
    .select('slug, status, cover_image_path, cover_image_alt, cover_image_source')
    .eq('id', cardId)
    .maybeSingle()
  if (isMissingTable(existingError)) return { error: MIGRATION_ERROR }
  if (isMissingCoverColumn(existingError)) return { error: COVER_MIGRATION_ERROR }
  if (existingError) return { error: existingError.message }
  if (!existing) return { error: 'Product card not found.' }
  if (typeof existing.cover_image_path !== 'string' || !existing.cover_image_path) {
    return { error: 'Add a cover image before signing it off.' }
  }
  if (typeof existing.cover_image_alt !== 'string' || !existing.cover_image_alt.trim()) {
    return { error: 'Add alt text for the cover image.' }
  }
  if (existing.cover_image_source !== 'client') {
    return { error: 'Only client work needs a sign-off. Sample images are shown without one.' }
  }

  const signoffAt = new Date().toISOString()
  const { error } = await auth.supabase
    .from('product_cards')
    .update({
      cover_image_signoff_by: auth.user.id,
      cover_image_signoff_at: signoffAt,
    })
    .eq('id', cardId)
  if (isMissingCoverColumn(error)) return { error: COVER_MIGRATION_ERROR }
  if (error) return { error: error.message }

  const status = isProductCardStatus(String(existing.status)) ? (existing.status as ProductCardStatus) : 'draft'
  const revalidateWarning = await revalidateCardChange(
    { slug: String(existing.slug), status },
    { slug: String(existing.slug), status }
  )

  return {
    success: true,
    cover_image_path: existing.cover_image_path,
    cover_image_alt: existing.cover_image_alt,
    cover_image_source: 'client',
    cover_image_signoff_by: auth.user.id,
    cover_image_signoff_at: signoffAt,
    cover_image_signoff_name: auth.name?.trim() || auth.email || null,
    revalidateWarning,
  }
}

export async function saveProductCardExample(
  input: ProductCardExampleInput
): Promise<ActionError | { success: true; revalidateWarning: string | null }> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }
  if (!isExampleKind(input.kind)) return { error: 'Choose what kind of proof this is.' }

  const title = input.title.trim()
  if (!title) return { error: 'Add a title.' }
  const companyName = blankToNull(input.company_name)
  if (input.signoff && (input.kind === 'logo' || input.kind === 'quote') && !companyName) {
    return { error: 'Logos and quotes need the client’s name before they can be signed off.' }
  }

  const supabase = auth.supabase
  const { data: card, error: cardError } = await supabase
    .from('product_cards')
    .select('slug, status')
    .eq('id', input.card_id)
    .maybeSingle()
  if (isMissingTable(cardError)) return { error: MIGRATION_ERROR }
  if (cardError) return { error: cardError.message }
  if (!card) return { error: 'Product card not found.' }

  let previousPath: string | null = null
  let previousSignoffBy: string | null = null
  let previousSignoffAt: string | null = null
  if (input.id) {
    const { data: existing, error: existingError } = await supabase
      .from('product_card_examples')
      .select('storage_path, signoff_by, signoff_at')
      .eq('id', input.id)
      .eq('card_id', input.card_id)
      .maybeSingle()
    if (existingError) return { error: existingError.message }
    if (!existing) return { error: 'Example not found.' }
    previousPath = typeof existing.storage_path === 'string' ? existing.storage_path : null
    previousSignoffBy = typeof existing.signoff_by === 'string' ? existing.signoff_by : null
    previousSignoffAt = typeof existing.signoff_at === 'string' ? existing.signoff_at : null
  }

  const nextPath = blankToNull(input.storage_path)
  const payload = {
    kind: input.kind,
    title,
    caption: input.caption.trim(),
    storage_path: nextPath,
    url: blankToNull(input.url),
    company_name: companyName,
    case_study_path: blankToNull(input.case_study_path),
    signoff_note: blankToNull(input.signoff_note),
    signoff_by: input.signoff ? previousSignoffBy || auth.user?.id || null : null,
    signoff_at: input.signoff ? previousSignoffAt || new Date().toISOString() : null,
  }

  if (input.id) {
    const { error } = await supabase
      .from('product_card_examples')
      .update(payload)
      .eq('id', input.id)
      .eq('card_id', input.card_id)
    if (error) return { error: error.message }
  } else {
    const { data: last } = await supabase
      .from('product_card_examples')
      .select('sort_order')
      .eq('card_id', input.card_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { error } = await supabase.from('product_card_examples').insert({
      ...payload,
      card_id: input.card_id,
      sort_order: (asNumber(last?.sort_order) ?? -1) + 1,
    })
    if (error) return { error: error.message }
  }

  if (previousPath && previousPath !== nextPath) {
    await supabase.storage.from(PRODUCT_CARDS_BUCKET).remove([previousPath])
  }

  const status = isProductCardStatus(String(card.status)) ? (card.status as ProductCardStatus) : 'draft'
  const revalidateWarning = await revalidateCardChange(
    { slug: String(card.slug), status },
    { slug: String(card.slug), status }
  )
  return { success: true, revalidateWarning }
}

export async function deleteProductCardExample(
  id: string
): Promise<ActionError | { success: true; revalidateWarning: string | null }> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }
  const { data: existing, error: existingError } = await auth.supabase
    .from('product_card_examples')
    .select('card_id, storage_path')
    .eq('id', id)
    .maybeSingle()
  if (isMissingTable(existingError)) return { error: MIGRATION_ERROR }
  if (existingError) return { error: existingError.message }
  if (!existing) return { error: 'Example not found.' }

  const { data: card } = await auth.supabase
    .from('product_cards')
    .select('slug, status')
    .eq('id', existing.card_id)
    .maybeSingle()

  const { error } = await auth.supabase.from('product_card_examples').delete().eq('id', id)
  if (error) return { error: error.message }

  if (typeof existing.storage_path === 'string' && existing.storage_path) {
    await auth.supabase.storage.from(PRODUCT_CARDS_BUCKET).remove([existing.storage_path])
  }

  const status = card && isProductCardStatus(String(card.status)) ? (card.status as ProductCardStatus) : 'draft'
  const revalidateWarning = card
    ? await revalidateCardChange(
        { slug: String(card.slug), status },
        { slug: String(card.slug), status }
      )
    : null
  return { success: true, revalidateWarning }
}

export async function createProductCardLink(
  input: ProductCardLinkInput
): Promise<ActionError | { success: true; link: ProductCardLink }> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }

  const { data: card, error: cardError } = await auth.supabase
    .from('product_cards')
    .select('slug')
    .eq('id', input.card_id)
    .maybeSingle()
  if (isMissingTable(cardError)) return { error: MIGRATION_ERROR }
  if (cardError) return { error: cardError.message }
  if (!card) return { error: 'Product card not found.' }

  const label = input.label?.trim() ?? ''
  const contactName = blankToNull(input.contact_name)
  if (!label && !contactName) return { error: 'Add a label or a contact name so this link can be told apart.' }

  const email = blankToNull(input.contact_email)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' }

  let expiresAt: string | null = null
  if (input.expires_on?.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expires_on.trim())) return { error: 'Enter an expiry date.' }
    expiresAt = `${input.expires_on.trim()}T23:59:59.999Z`
  }

  let created: Record<string, unknown> | null = null
  let lastError: string | null = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(9).toString('base64url')
    const { data, error } = await auth.supabase
      .from('product_card_links')
      .insert({
        card_id: input.card_id,
        token,
        label: label || contactName,
        contact_name: contactName,
        contact_email: email,
        created_by: auth.user?.id ?? null,
        expires_at: expiresAt,
        is_active: true,
      })
      .select('*')
      .single()
    if (!error && data) {
      created = data as Record<string, unknown>
      break
    }
    if (error?.code === '23505') continue
    lastError = error?.message || 'Could not create the link.'
    break
  }
  if (!created) return { error: lastError || 'Could not create a unique link. Try again.' }

  const token = String(created.token)
  return {
    success: true,
    link: {
      id: String(created.id),
      token,
      url: productCardPageUrl(String(card.slug), token),
      label: String(created.label || ''),
      contact_name: typeof created.contact_name === 'string' ? created.contact_name : null,
      contact_email: typeof created.contact_email === 'string' ? created.contact_email : null,
      created_at: String(created.created_at || ''),
      expires_at: typeof created.expires_at === 'string' ? created.expires_at : null,
      is_active: true,
      view_count: 0,
      first_viewed_at: null,
      last_viewed_at: null,
    },
  }
}

export async function setProductCardLinkActive(
  id: string,
  isActive: boolean
): Promise<ActionError | { success: true }> {
  const auth = await requireTeam()
  if (auth.error || !auth.supabase) return { error: auth.error || 'Not authenticated' }

  const { error } = await auth.supabase.from('product_card_links').update({ is_active: isActive }).eq('id', id)
  if (isMissingTable(error)) return { error: MIGRATION_ERROR }
  if (error) return { error: error.message }
  return { success: true }
}
