export const PRODUCT_CARDS_BUCKET = 'product-cards'

export const PRODUCT_CARD_STATUSES = ['draft', 'unlisted', 'published', 'retired'] as const
export type ProductCardStatus = (typeof PRODUCT_CARD_STATUSES)[number]

export const PRICING_MODELS = ['fixed', 'flexi'] as const
export type PricingModel = (typeof PRICING_MODELS)[number]

export const CTA_KINDS = ['book_call', 'reply_email', 'flexi_brief'] as const
export type CtaKind = (typeof CTA_KINDS)[number]

export const ITEM_SECTIONS = ['choose_when', 'approach', 'outcome', 'terms', 'faq'] as const
export type ItemSection = (typeof ITEM_SECTIONS)[number]

export const MAIN_ITEM_SECTIONS = ['choose_when', 'approach', 'outcome'] as const

export const EXAMPLE_KINDS = ['image', 'video', 'logo', 'case_study', 'quote'] as const
export type ExampleKind = (typeof EXAMPLE_KINDS)[number]

export const COVER_SOURCES = ['client', 'sample'] as const
export type CoverImageSource = (typeof COVER_SOURCES)[number]

export const COVER_MISSING_WARNING =
  'No cover image yet. The card can still be published, and the products site will have none until one is added.'

export const PRODUCT_CURRENCIES = ['GBP', 'USD'] as const

export const STATUS_LABELS: Record<ProductCardStatus, string> = {
  draft: 'Draft',
  unlisted: 'Unlisted',
  published: 'Published',
  retired: 'Retired',
}

export const PRICING_LABELS: Record<PricingModel, string> = {
  fixed: 'Fixed price',
  flexi: 'Flexi-Design',
}

export const CTA_LABELS: Record<CtaKind, string> = {
  book_call: 'Book a call',
  reply_email: 'Reply by email',
  flexi_brief: 'Open a Flexi-Design brief',
}

export const SECTION_LABELS: Record<ItemSection, string> = {
  choose_when: 'Choose this when',
  approach: 'How we do it',
  outcome: 'What you receive',
  terms: 'Terms',
  faq: 'Questions',
}

export const SECTION_HINTS: Record<ItemSection, string> = {
  choose_when: 'The situations where this is the right piece of work.',
  approach: 'The way the work actually happens.',
  outcome: 'The deliverables that back up the decision.',
  terms: 'What is included, and what is not.',
  faq: 'The title is the question. The body is the answer.',
}

export const EXAMPLE_KIND_LABELS: Record<ExampleKind, string> = {
  image: 'Image',
  video: 'Video',
  logo: 'Logo',
  case_study: 'Case study',
  quote: 'Quote',
}

export interface ProductCardItemInput {
  id?: string | null
  section: ItemSection
  title: string
  body: string
}

export interface PublishCheckInput {
  name: string
  slug: string
  decision_statement: string
  pricing_model: PricingModel
  price_amount: number | null
  currency: string
  price_basis: string
  payment_terms: string
  flexi_service_id: string | null
  cta_kind: CtaKind | ''
  cta_target: string
  items: ProductCardItemInput[]
}

export function isProductCardStatus(value: string): value is ProductCardStatus {
  return (PRODUCT_CARD_STATUSES as readonly string[]).includes(value)
}

export function isPricingModel(value: string): value is PricingModel {
  return (PRICING_MODELS as readonly string[]).includes(value)
}

export function isCtaKind(value: string): value is CtaKind {
  return (CTA_KINDS as readonly string[]).includes(value)
}

export function isItemSection(value: string): value is ItemSection {
  return (ITEM_SECTIONS as readonly string[]).includes(value)
}

export function isExampleKind(value: string): value is ExampleKind {
  return (EXAMPLE_KINDS as readonly string[]).includes(value)
}

export function isCoverImageSource(value: string): value is CoverImageSource {
  return (COVER_SOURCES as readonly string[]).includes(value)
}

export function coverIsPublic(cover: {
  path: string | null
  source: CoverImageSource | null
  signoffBy: string | null
  signoffAt: string | null
}): boolean {
  if (!cover.path || !cover.source) return false
  if (cover.source === 'sample') return true
  return Boolean(cover.signoffBy && cover.signoffAt)
}

export function slugifyProductName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function productCardPublishIssues(input: PublishCheckInput): string[] {
  const issues: string[] = []
  if (!input.name.trim()) issues.push('Add a name.')
  if (!slugifyProductName(input.slug || input.name)) issues.push('Add a URL slug.')
  if (!input.decision_statement.trim()) {
    issues.push('Add what the client will be able to decide or change afterwards.')
  }

  const filled = input.items.filter((item) => item.title.trim() || item.body.trim())
  for (const section of MAIN_ITEM_SECTIONS) {
    if (!filled.some((item) => item.section === section)) {
      issues.push(`Add at least one “${SECTION_LABELS[section]}” point.`)
    }
  }
  if (filled.some((item) => item.section === 'faq' && (!item.title.trim() || !item.body.trim()))) {
    issues.push('Give each question both a question and an answer.')
  }

  if (input.pricing_model === 'fixed') {
    if (input.price_amount == null || input.price_amount < 0) issues.push('Add the fixed price.')
    if (!(PRODUCT_CURRENCIES as readonly string[]).includes(input.currency)) {
      issues.push('Choose GBP or USD.')
    }
    if (!input.price_basis.trim()) issues.push('Add the price basis, such as ex VAT.')
    if (!input.payment_terms.trim()) issues.push('Add the payment terms.')
  } else if (!input.flexi_service_id) {
    issues.push('Choose the Flexi-Design service, so the credit estimate comes from the catalogue.')
  }

  if (!isCtaKind(input.cta_kind)) issues.push('Choose a call to action.')
  if (!input.cta_target.trim()) issues.push('Add where the call to action should send people.')

  return issues
}

export function formatProductPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'GBP',
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function formatCredits(value: number): string {
  const text = Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 })
  return `${text} ${Number(value) === 1 ? 'credit' : 'credits'}`
}

export function formatCardPrice(card: {
  pricing_model: PricingModel
  price_amount: number | null
  currency: string
  price_basis: string
  credit_estimate: number | null
}): string {
  if (card.pricing_model === 'flexi') {
    return card.credit_estimate == null ? 'Credits not set' : formatCredits(card.credit_estimate)
  }
  if (card.price_amount == null) return 'Price not set'
  const money = formatProductPrice(card.price_amount, card.currency)
  return card.price_basis.trim() ? `${money} ${card.price_basis.trim()}` : money
}

export function exampleIsPublic(example: {
  kind: ExampleKind
  company_name: string | null
  signoff_at: string | null
  signoff_by: string | null
}): boolean {
  if (!example.signoff_at || !example.signoff_by) return false
  if (example.kind === 'logo' || example.kind === 'quote') {
    return Boolean(example.company_name?.trim())
  }
  return true
}

export function productCardAssetUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null
  if (/^https?:\/\//i.test(storagePath)) return storagePath
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  const path = storagePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${PRODUCT_CARDS_BUCKET}/${path}`
}

export function productsSiteOrigin(): string {
  return (process.env.PRODUCTS_SITE_URL || 'https://products.salo.uk').replace(/\/$/, '')
}

export function productCardPageUrl(slug: string, token?: string | null): string {
  const url = `${productsSiteOrigin()}/${slug}`
  if (!token) return url
  return `${url}?t=${encodeURIComponent(token)}`
}

export function isPublicCardStatus(status: ProductCardStatus): boolean {
  return status === 'published' || status === 'unlisted' || status === 'retired'
}
