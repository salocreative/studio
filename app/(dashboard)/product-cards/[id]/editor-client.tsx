'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  createProductCardLink,
  deleteProductCard,
  getProductCard,
  saveProductCard,
  setProductCardLinkActive,
  setProductCardOgImage,
  setProductCardCover,
  signOffProductCardCover,
  type FlexiServiceOption,
  type ProductCardExample,
  type ProductCardLink,
  type RelatedCardOption,
  type TeamMemberOption,
} from '@/app/actions/product-cards'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  CTA_KINDS,
  CTA_LABELS,
  EXAMPLE_KIND_LABELS,
  ITEM_SECTIONS,
  PRICING_LABELS,
  PRODUCT_CARD_STATUSES,
  SECTION_HINTS,
  SECTION_LABELS,
  STATUS_LABELS,
  formatCardPrice,
  formatCredits,
  COVER_MISSING_WARNING,
  coverIsPublic,
  productCardAssetUrl,
  productCardPublishIssues,
  type CoverImageSource,
  type CtaKind,
  type ItemSection,
  type PricingModel,
  type ProductCardStatus,
} from '@/lib/product-cards/model'
import { uploadProductCardAsset, uploadProductCardCover } from '@/lib/product-cards/upload'
import { cn } from '@/lib/utils'
import { ExampleDialog } from './example-dialog'
import { ProductCardPreview } from './preview'

interface DraftItem {
  key: string
  id: string | null
  section: ItemSection
  title: string
  body: string
}

interface FormState {
  name: string
  slug: string
  category: string
  status: ProductCardStatus
  decision_statement: string
  summary: string
  pricing_model: PricingModel
  price_amount: string
  currency: string
  price_basis: string
  payment_terms: string
  price_note: string
  flexi_service_id: string
  credit_override: string
  timeline_text: string
  cta_kind: CtaKind
  cta_target: string
  owner_user_id: string
  indexable: boolean
  meta_title: string
  meta_description: string
  og_image_path: string | null
  cover_image_path: string | null
  cover_image_alt: string
  cover_image_source: CoverImageSource
  cover_image_signoff_by: string | null
  cover_image_signoff_at: string | null
  cover_image_signoff_name: string | null
  sort_order: string
}

const EMPTY_FORM: FormState = {
  name: '',
  slug: '',
  category: '',
  status: 'draft',
  decision_statement: '',
  summary: '',
  pricing_model: 'fixed',
  price_amount: '',
  currency: 'GBP',
  price_basis: 'ex VAT',
  payment_terms: '',
  price_note: '',
  flexi_service_id: '',
  credit_override: '',
  timeline_text: '',
  cta_kind: 'book_call',
  cta_target: '',
  owner_user_id: '',
  indexable: false,
  meta_title: '',
  meta_description: '',
  og_image_path: null,
  cover_image_path: null,
  cover_image_alt: '',
  cover_image_source: 'sample',
  cover_image_signoff_by: null,
  cover_image_signoff_at: null,
  cover_image_signoff_name: null,
  sort_order: '0',
}

function parseOptionalNumber(value: string): number | null | 'invalid' {
  const trimmed = value.trim()
  if (!trimmed) return null
  const number = Number(trimmed)
  return Number.isFinite(number) ? number : 'invalid'
}

function formatWhen(value: string | null) {
  if (!value) return 'Not yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not yet'
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function linkState(link: ProductCardLink) {
  if (!link.is_active) return 'Inactive'
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return 'Expired'
  return link.view_count > 0 ? 'Opened' : 'Not opened yet'
}

export default function ProductCardEditorClient({ id }: { id: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [siteOrigin, setSiteOrigin] = useState('https://products.salo.uk')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [items, setItems] = useState<DraftItem[]>([])
  const [examples, setExamples] = useState<ProductCardExample[]>([])
  const [links, setLinks] = useState<ProductCardLink[]>([])
  const [relatedIds, setRelatedIds] = useState<string[]>([])
  const [relatedOptions, setRelatedOptions] = useState<RelatedCardOption[]>([])
  const [services, setServices] = useState<FlexiServiceOption[]>([])
  const [team, setTeam] = useState<TeamMemberOption[]>([])
  const [views30d, setViews30d] = useState(0)
  const [viewsTotal, setViewsTotal] = useState(0)
  const [saving, setSaving] = useState(false)
  const [exampleOpen, setExampleOpen] = useState(false)
  const [editingExample, setEditingExample] = useState<ProductCardExample | null>(null)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkContact, setLinkContact] = useState('')
  const [linkEmail, setLinkEmail] = useState('')
  const [linkExpires, setLinkExpires] = useState('')
  const [creatingLink, setCreatingLink] = useState(false)
  const [uploadingOg, setUploadingOg] = useState(false)
  const [savingCover, setSavingCover] = useState(false)
  const [savedCover, setSavedCover] = useState<{
    path: string | null
    alt: string
    source: CoverImageSource
  }>({ path: null, alt: '', source: 'sample' })

  useEffect(() => {
    void load()
    // The card id is fixed for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function load() {
    setLoading(true)
    try {
      const result = await getProductCard(id)
      if ('error' in result && result.error) {
        setLoadError(result.error)
        return
      }
      if (!('card' in result)) return
      const card = result.card
      setLoadError(null)
      setCanManage(result.canManage)
      setSiteOrigin(result.siteOrigin)
      setForm({
        name: card.name,
        slug: card.slug,
        category: card.category,
        status: card.status,
        decision_statement: card.decision_statement,
        summary: card.summary,
        pricing_model: card.pricing_model,
        price_amount: card.price_amount == null ? '' : String(card.price_amount),
        currency: card.currency,
        price_basis: card.price_basis || 'ex VAT',
        payment_terms: card.payment_terms,
        price_note: card.price_note ?? '',
        flexi_service_id: card.flexi_service_id ?? '',
        credit_override: card.credit_override == null ? '' : String(card.credit_override),
        timeline_text: card.timeline_text,
        cta_kind: card.cta_kind,
        cta_target: card.cta_target,
        owner_user_id: card.owner_user_id ?? '',
        indexable: card.indexable,
        meta_title: card.meta_title ?? '',
        meta_description: card.meta_description ?? '',
        og_image_path: card.og_image_path,
        cover_image_path: card.cover_image_path,
        cover_image_alt: card.cover_image_alt ?? '',
        cover_image_source: card.cover_image_source ?? 'sample',
        cover_image_signoff_by: card.cover_image_signoff_by,
        cover_image_signoff_at: card.cover_image_signoff_at,
        cover_image_signoff_name: card.cover_image_signoff_name,
        sort_order: String(card.sort_order),
      })
      setSavedCover({
        path: card.cover_image_path,
        alt: card.cover_image_alt ?? '',
        source: card.cover_image_source ?? 'sample',
      })
      setItems(
        result.items.map((item) => ({
          key: item.id,
          id: item.id,
          section: item.section,
          title: item.title,
          body: item.body,
        }))
      )
      setExamples(result.examples)
      setLinks(result.links)
      setRelatedIds(result.related_card_ids)
      setRelatedOptions(result.related_options)
      setServices(result.services)
      setTeam(result.team)
      setViews30d(result.views_30d)
      setViewsTotal(result.views_total)
    } catch (error) {
      console.error('Error loading product card:', error)
      setLoadError('Could not load this product card.')
    } finally {
      setLoading(false)
    }
  }

  function patch(partial: Partial<FormState>) {
    setForm((current) => ({ ...current, ...partial }))
  }

  const priceAmount = parseOptionalNumber(form.price_amount)
  const creditOverride = parseOptionalNumber(form.credit_override)
  const issues = useMemo(
    () =>
      productCardPublishIssues({
        name: form.name,
        slug: form.slug,
        decision_statement: form.decision_statement,
        pricing_model: form.pricing_model,
        price_amount: priceAmount === 'invalid' ? null : priceAmount,
        currency: form.currency,
        price_basis: form.price_basis,
        payment_terms: form.payment_terms,
        flexi_service_id: form.flexi_service_id || null,
        cta_kind: form.cta_kind,
        cta_target: form.cta_target,
        items,
      }),
    [form, items, priceAmount]
  )

  const selectedService = services.find((service) => service.id === form.flexi_service_id)
  const resolvedCredits =
    form.pricing_model === 'flexi'
      ? creditOverride === 'invalid'
        ? null
        : creditOverride ?? selectedService?.credit_estimate ?? null
      : null
  const priceLabel = formatCardPrice({
    pricing_model: form.pricing_model,
    price_amount: priceAmount === 'invalid' ? null : priceAmount,
    currency: form.currency,
    price_basis: form.price_basis,
    credit_estimate: resolvedCredits,
  })

  function itemsIn(section: ItemSection) {
    return items.filter((item) => item.section === section)
  }

  function addItem(section: ItemSection) {
    setItems((current) => [
      ...current,
      { key: crypto.randomUUID(), id: null, section, title: '', body: '' },
    ])
  }

  function updateItem(key: string, partial: Partial<DraftItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...partial } : item)))
  }

  function moveItem(key: string, direction: -1 | 1) {
    setItems((current) => {
      const item = current.find((entry) => entry.key === key)
      if (!item) return current
      const sectionItems = current.filter((entry) => entry.section === item.section)
      const index = sectionItems.findIndex((entry) => entry.key === key)
      const target = index + direction
      if (target < 0 || target >= sectionItems.length) return current
      const reordered = [...sectionItems]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(target, 0, moved)
      const others = current.filter((entry) => entry.section !== item.section)
      return [...others, ...reordered]
    })
  }

  function removeItem(key: string) {
    setItems((current) => current.filter((item) => item.key !== key))
  }

  async function save() {
    if (priceAmount === 'invalid') {
      toast.error('Enter the price as a number.')
      return
    }
    if (creditOverride === 'invalid') {
      toast.error('Enter the credit override as a number.')
      return
    }
    const sortOrder = Number(form.sort_order)
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      toast.error('List order needs to be zero or more.')
      return
    }

    setSaving(true)
    try {
      const result = await saveProductCard({
        id,
        name: form.name,
        slug: form.slug,
        category: form.category,
        status: form.status,
        decision_statement: form.decision_statement,
        summary: form.summary,
        pricing_model: form.pricing_model,
        price_amount: priceAmount,
        currency: form.currency,
        price_basis: form.price_basis,
        payment_terms: form.payment_terms,
        price_note: form.price_note,
        flexi_service_id: form.flexi_service_id || null,
        credit_override: creditOverride,
        timeline_text: form.timeline_text,
        cta_kind: form.cta_kind,
        cta_target: form.cta_target,
        owner_user_id: form.owner_user_id || null,
        indexable: form.indexable,
        meta_title: form.meta_title,
        meta_description: form.meta_description,
        sort_order: sortOrder,
        items: items.map((item) => ({
          id: item.id,
          section: item.section,
          title: item.title,
          body: item.body,
        })),
        related_card_ids: relatedIds,
      })
      if ('error' in result && result.error) {
        toast.error(result.error, {
          description: result.issues?.join(' '),
        })
        return
      }
      if (!('success' in result)) return
      toast.success('Card saved', { description: result.revalidateWarning ?? undefined })
      await load()
    } catch (error) {
      console.error('Error saving product card:', error)
      toast.error('Could not save the card')
    } finally {
      setSaving(false)
    }
  }

  async function removeDraft() {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return
    const result = await deleteProductCard(id)
    if ('error' in result && result.error) {
      toast.error('Could not delete the card', { description: result.error })
      return
    }
    router.push('/product-cards')
  }

  async function onOgFile(file: File | null) {
    if (!file) return
    setUploadingOg(true)
    try {
      const path = await uploadProductCardAsset(id, file)
      const result = await setProductCardOgImage(id, path)
      if ('error' in result && result.error) {
        toast.error('Could not save the share image', { description: result.error })
        return
      }
      if (!('og_image_path' in result)) return
      patch({ og_image_path: result.og_image_path })
      toast.success('Share image saved', { description: result.revalidateWarning ?? undefined })
    } catch (error) {
      toast.error('Could not upload the share image', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setUploadingOg(false)
    }
  }

  async function clearOg() {
    const result = await setProductCardOgImage(id, null)
    if ('error' in result && result.error) {
      toast.error('Could not remove the share image', { description: result.error })
      return
    }
    if (!('og_image_path' in result)) return
    patch({ og_image_path: null })
  }

  function coverSignoffStands() {
    return Boolean(
      form.cover_image_signoff_at &&
        form.cover_image_path &&
        form.cover_image_path === savedCover.path &&
        form.cover_image_source === savedCover.source &&
        form.cover_image_source === 'client'
    )
  }

  function coverHasUnsavedChanges() {
    if ((form.cover_image_path || null) !== savedCover.path) return true
    if (form.cover_image_alt !== savedCover.alt) return true
    if (form.cover_image_path && form.cover_image_source !== savedCover.source) return true
    return false
  }

  function applyCover(result: {
    cover_image_path: string | null
    cover_image_alt: string | null
    cover_image_source: CoverImageSource | null
    cover_image_signoff_by: string | null
    cover_image_signoff_at: string | null
    cover_image_signoff_name: string | null
    revalidateWarning: string | null
  }) {
    const source = result.cover_image_source ?? 'sample'
    const alt = result.cover_image_alt ?? ''
    patch({
      cover_image_path: result.cover_image_path,
      cover_image_alt: alt,
      cover_image_source: source,
      cover_image_signoff_by: result.cover_image_signoff_by,
      cover_image_signoff_at: result.cover_image_signoff_at,
      cover_image_signoff_name:
        result.cover_image_signoff_name
        ?? (result.cover_image_signoff_by ? form.cover_image_signoff_name : null),
    })
    setSavedCover({ path: result.cover_image_path, alt, source })
    if (result.revalidateWarning) {
      toast.message('Saved, with a warning', { description: result.revalidateWarning })
    }
  }

  async function onCoverFile(file: File | null) {
    if (!file) return
    setSavingCover(true)
    try {
      const path = await uploadProductCardCover(id, file)
      patch({
        cover_image_path: path,
        cover_image_signoff_by: null,
        cover_image_signoff_at: null,
        cover_image_signoff_name: null,
      })
    } catch (error) {
      toast.error('Could not upload the cover image', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSavingCover(false)
    }
  }

  async function saveCover() {
    if (form.cover_image_path && !form.cover_image_alt.trim()) {
      toast.error('Add alt text for the cover image.')
      return
    }
    setSavingCover(true)
    try {
      const result = await setProductCardCover({
        cardId: id,
        cover_image_path: form.cover_image_path,
        cover_image_alt: form.cover_image_alt,
        cover_image_source: form.cover_image_path ? form.cover_image_source : null,
      })
      if ('error' in result && result.error) {
        toast.error('Could not save the cover', { description: result.error })
        return
      }
      if (!('success' in result)) return
      applyCover(result)
      toast.success(form.cover_image_path ? 'Cover saved' : 'Cover removed')
    } finally {
      setSavingCover(false)
    }
  }

  async function removeCover() {
    setSavingCover(true)
    try {
      if (!savedCover.path) {
        patch({
          cover_image_path: null,
          cover_image_alt: '',
          cover_image_source: 'sample',
          cover_image_signoff_by: null,
          cover_image_signoff_at: null,
          cover_image_signoff_name: null,
        })
        return
      }
      const result = await setProductCardCover({
        cardId: id,
        cover_image_path: null,
        cover_image_alt: null,
        cover_image_source: null,
      })
      if ('error' in result && result.error) {
        toast.error('Could not remove the cover', { description: result.error })
        return
      }
      if (!('success' in result)) return
      applyCover(result)
      toast.success('Cover removed')
    } finally {
      setSavingCover(false)
    }
  }

  async function signOffCover() {
    if (coverHasUnsavedChanges()) {
      toast.error('Save the cover before signing it off.')
      return
    }
    setSavingCover(true)
    try {
      const result = await signOffProductCardCover(id)
      if ('error' in result && result.error) {
        toast.error('Could not sign off the cover', { description: result.error })
        return
      }
      if (!('success' in result)) return
      applyCover(result)
      toast.success('Cover signed off')
    } finally {
      setSavingCover(false)
    }
  }

  async function refreshExamples() {
    const result = await getProductCard(id)
    if ('examples' in result) setExamples(result.examples)
  }

  async function createLink() {
    setCreatingLink(true)
    try {
      const result = await createProductCardLink({
        card_id: id,
        label: linkLabel,
        contact_name: linkContact,
        contact_email: linkEmail,
        expires_on: linkExpires || null,
      })
      if ('error' in result && result.error) {
        toast.error('Could not create the link', { description: result.error })
        return
      }
      if (!('link' in result)) return
      setLinks((current) => [result.link, ...current])
      setLinkLabel('')
      setLinkContact('')
      setLinkEmail('')
      setLinkExpires('')
      try {
        await navigator.clipboard.writeText(result.link.url)
        toast.success('Link created and copied')
      } catch {
        toast.success('Link created. Copy it from the list.')
      }
    } catch (error) {
      console.error('Error creating product card link:', error)
      toast.error('Could not create the link')
    } finally {
      setCreatingLink(false)
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy the link')
    }
  }

  async function toggleLink(link: ProductCardLink, isActive: boolean) {
    const result = await setProductCardLinkActive(link.id, isActive)
    if ('error' in result && result.error) {
      toast.error('Could not update the link', { description: result.error })
      return
    }
    setLinks((current) => current.map((item) => (item.id === link.id ? { ...item, is_active: isActive } : item)))
  }

  function toggleRelated(relatedId: string) {
    setRelatedIds((current) =>
      current.includes(relatedId) ? current.filter((item) => item !== relatedId) : [...current, relatedId]
    )
  }

  if (loading && !form.name && !loadError) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading card
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm">{loadError}</p>
        <Button variant="outline" asChild>
          <Link href="/product-cards">Back to product cards</Link>
        </Button>
      </div>
    )
  }

  const locked = !canManage || saving
  const blocking = form.status === 'published' || form.status === 'unlisted'
  const trackedViews = links.reduce((sum, link) => sum + link.view_count, 0)
  const directViews = Math.max(0, viewsTotal - trackedViews)
  const relatedNames = relatedIds
    .map((relatedId) => relatedOptions.find((option) => option.id === relatedId)?.name)
    .filter((name): name is string => Boolean(name))

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <Link href="/product-cards" className="text-sm text-muted-foreground hover:text-foreground">
              Product cards
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold">{form.name || 'Untitled card'}</h1>
              <Badge variant="outline">{STATUS_LABELS[form.status]}</Badge>
            </div>
          </div>
          {canManage && (
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Tabs defaultValue="write">
            <TabsList>
              <TabsTrigger value="write">Write</TabsTrigger>
              <TabsTrigger value="proof">Proof</TabsTrigger>
              <TabsTrigger value="share">Share</TabsTrigger>
            </TabsList>

            <TabsContent value="write" className="space-y-4">
              {!canManage && (
                <p className="text-sm text-muted-foreground">
                  You can create links from the Share tab. An admin edits the card.
                </p>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Cover image</CardTitle>
                  <CardDescription>
                    Shown on the product page. Optional, so it does not block publishing. Client work stays off the public page until it is signed off.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {form.cover_image_path && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={productCardAssetUrl(form.cover_image_path) || ''}
                      alt={form.cover_image_alt || ''}
                      className="max-h-56 w-full rounded-md border object-cover"
                    />
                  )}
                  {canManage && (
                    <div className="space-y-2">
                      <Label htmlFor="cover-image">{form.cover_image_path ? 'Replace image' : 'Upload image'}</Label>
                      <Input
                        id="cover-image"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={locked || savingCover}
                        onChange={(event) => void onCoverFile(event.target.files?.[0] ?? null)}
                      />
                      <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP. 5 MB maximum.</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="cover-alt">Alt text</Label>
                    <Input
                      id="cover-alt"
                      value={form.cover_image_alt}
                      disabled={locked || !form.cover_image_path}
                      onChange={(event) => patch({ cover_image_alt: event.target.value })}
                      placeholder="What the image shows"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Source</Label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={form.cover_image_source === 'client' ? 'default' : 'outline'}
                        disabled={locked || !form.cover_image_path}
                        onClick={() => patch({ cover_image_source: 'client' })}
                      >
                        Client work
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={form.cover_image_source === 'sample' ? 'default' : 'outline'}
                        disabled={locked || !form.cover_image_path}
                        onClick={() => patch({ cover_image_source: 'sample' })}
                      >
                        Sample
                      </Button>
                    </div>
                  </div>
                  {form.cover_image_path && form.cover_image_source === 'client' && !coverSignoffStands() && (
                    <p className="text-sm text-amber-800">Not shown publicly until signed off.</p>
                  )}
                  {form.cover_image_path && form.cover_image_source === 'client' && coverSignoffStands() && (
                    <p className="text-sm text-muted-foreground">
                      Signed off{form.cover_image_signoff_name ? ` by ${form.cover_image_signoff_name}` : ''}{' '}
                      {formatWhen(form.cover_image_signoff_at)}.
                    </p>
                  )}
                  {coverHasUnsavedChanges() && (
                    <p className="text-sm text-muted-foreground">Cover changes are not saved yet.</p>
                  )}
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => void saveCover()} disabled={locked || savingCover || !coverHasUnsavedChanges()}>
                        {savingCover && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save cover
                      </Button>
                      {form.cover_image_path && (
                        <Button type="button" variant="ghost" onClick={() => void removeCover()} disabled={savingCover}>
                          Remove
                        </Button>
                      )}
                      {form.cover_image_source === 'client' && form.cover_image_path && !coverSignoffStands() && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void signOffCover()}
                          disabled={savingCover || coverHasUnsavedChanges()}
                        >
                          Mark as signed off
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Ready to publish</CardTitle>
                  <CardDescription>
                    Publishing and unlisting stay blocked until the decision, the three main sections, the price and the call to action are filled in. A draft can be saved incomplete.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {issues.length === 0 ? (
                    <p className="text-sm text-emerald-700">Ready to publish or unlist.</p>
                  ) : (
                    <ul className={cn('list-disc space-y-1 pl-5 text-sm', blocking ? 'text-destructive' : 'text-muted-foreground')}>
                      {issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  {!form.cover_image_path && (
                    <p className="text-sm text-amber-800">{COVER_MISSING_WARNING}</p>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={form.status}
                        onValueChange={(value) => patch({ status: value as ProductCardStatus })}
                        disabled={locked}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRODUCT_CARD_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {STATUS_LABELS[status]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sort-order">List order</Label>
                      <Input
                        id="sort-order"
                        type="number"
                        min={0}
                        value={form.sort_order}
                        disabled={locked}
                        onChange={(event) => patch({ sort_order: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor="indexable">Allow search engines</Label>
                      <p className="text-xs text-muted-foreground">Off by default. The products site should noindex until this is on.</p>
                    </div>
                    <Switch
                      id="indexable"
                      checked={form.indexable}
                      disabled={locked}
                      onCheckedChange={(checked) => patch({ indexable: checked })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Owner</Label>
                    <Select
                      value={form.owner_user_id || 'none'}
                      onValueChange={(value) => patch({ owner_user_id: value === 'none' ? '' : value })}
                      disabled={locked}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose an owner" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No owner</SelectItem>
                        {form.owner_user_id && !team.some((member) => member.id === form.owner_user_id) && (
                          <SelectItem value={form.owner_user_id}>Former teammate</SelectItem>
                        )}
                        {team.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.full_name?.trim() || member.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {canManage && form.status === 'draft' && (
                    <Button variant="ghost" onClick={() => void removeDraft()}>
                      Delete draft
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>The card</CardTitle>
                  <CardDescription>
                    Lead with the decision the client can make. The approach and the deliverables come after that.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="card-name">Name</Label>
                      <Input
                        id="card-name"
                        value={form.name}
                        disabled={locked}
                        onChange={(event) => patch({ name: event.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="card-category">Category</Label>
                      <Input
                        id="card-category"
                        value={form.category}
                        disabled={locked}
                        onChange={(event) => patch({ category: event.target.value })}
                        placeholder="Audit"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="card-slug">URL slug</Label>
                    <Input
                      id="card-slug"
                      value={form.slug}
                      disabled={locked}
                      onChange={(event) => patch({ slug: event.target.value })}
                      onBlur={() => patch({ slug: form.slug.trim().toLowerCase() })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {siteOrigin}/{form.slug || 'slug'}. Changing this breaks links that have already been sent.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="decision">What you’ll be able to decide</Label>
                    <Textarea
                      id="decision"
                      value={form.decision_statement}
                      disabled={locked}
                      onChange={(event) => patch({ decision_statement: event.target.value })}
                      placeholder="After this, the client can decide…"
                      className="min-h-24"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="summary">Summary</Label>
                    <Input
                      id="summary"
                      value={form.summary}
                      disabled={locked}
                      onChange={(event) => patch({ summary: event.target.value })}
                      placeholder="One line for listings and link previews"
                    />
                  </div>
                </CardContent>
              </Card>

              {ITEM_SECTIONS.map((section) => (
                <Card key={section}>
                  <CardHeader>
                    <CardTitle>{SECTION_LABELS[section]}</CardTitle>
                    <CardDescription>{SECTION_HINTS[section]}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {itemsIn(section).map((item, index, sectionItems) => (
                      <div key={item.key} className="space-y-2 rounded-md border p-3">
                        <Input
                          value={item.title}
                          disabled={locked}
                          placeholder={section === 'faq' ? 'Question' : 'Heading (optional)'}
                          onChange={(event) => updateItem(item.key, { title: event.target.value })}
                        />
                        <Textarea
                          value={item.body}
                          disabled={locked}
                          placeholder={section === 'faq' ? 'Answer' : 'Text'}
                          onChange={(event) => updateItem(item.key, { body: event.target.value })}
                        />
                        {canManage && (
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={index === 0}
                              onClick={() => moveItem(item.key, -1)}
                              aria-label="Move up"
                            >
                              <ArrowUp />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={index === sectionItems.length - 1}
                              onClick={() => moveItem(item.key, 1)}
                              aria-label="Move down"
                            >
                              <ArrowDown />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeItem(item.key)}
                              aria-label="Remove"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                    {canManage && (
                      <Button type="button" variant="outline" size="sm" onClick={() => addItem(section)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}

              <Card>
                <CardHeader>
                  <CardTitle>Pricing</CardTitle>
                  <CardDescription>
                    A card is a fixed price or a Flexi-Design task. Saving keeps only the fields for the model you have selected.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Select
                    value={form.pricing_model}
                    onValueChange={(value) => patch({ pricing_model: value as PricingModel })}
                    disabled={locked}
                  >
                    <SelectTrigger className="sm:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">{PRICING_LABELS.fixed}</SelectItem>
                      <SelectItem value="flexi">{PRICING_LABELS.flexi}</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.pricing_model === 'fixed' ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="price">Price</Label>
                        <Input
                          id="price"
                          inputMode="decimal"
                          value={form.price_amount}
                          disabled={locked}
                          onChange={(event) => patch({ price_amount: event.target.value })}
                          placeholder="500"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Currency</Label>
                        <Select
                          value={form.currency}
                          onValueChange={(value) => patch({ currency: value })}
                          disabled={locked}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="GBP">GBP</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="basis">Price basis</Label>
                        <Input
                          id="basis"
                          value={form.price_basis}
                          disabled={locked}
                          onChange={(event) => patch({ price_basis: event.target.value })}
                          placeholder="ex VAT"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="terms">Payment terms</Label>
                        <Input
                          id="terms"
                          value={form.payment_terms}
                          disabled={locked}
                          onChange={(event) => patch({ payment_terms: event.target.value })}
                          placeholder="50% to start, 50% on delivery"
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="price-note">Price note (optional)</Label>
                        <Input
                          id="price-note"
                          value={form.price_note}
                          disabled={locked}
                          onChange={(event) => patch({ price_note: event.target.value })}
                          placeholder="Additional pages £80 each"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Flexi-Design service</Label>
                        <Select
                          value={form.flexi_service_id || 'none'}
                          onValueChange={(value) => patch({ flexi_service_id: value === 'none' ? '' : value })}
                          disabled={locked}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a service" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Choose a service</SelectItem>
                            {form.flexi_service_id && !selectedService && (
                              <SelectItem value={form.flexi_service_id}>Current service</SelectItem>
                            )}
                            {services.map((service) => (
                              <SelectItem key={service.id} value={service.id}>
                                {service.category} · {service.title} · {formatCredits(service.credit_estimate)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="credit-override">Credit override (optional)</Label>
                        <Input
                          id="credit-override"
                          inputMode="decimal"
                          value={form.credit_override}
                          disabled={locked}
                          onChange={(event) => patch({ credit_override: event.target.value })}
                          placeholder={selectedService ? String(selectedService.credit_estimate) : ''}
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave this empty to use the catalogue estimate. No pound price is stored on a Flexi card.
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Timeline and next step</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="timeline">Timeline</Label>
                    <Input
                      id="timeline"
                      value={form.timeline_text}
                      disabled={locked}
                      onChange={(event) => patch({ timeline_text: event.target.value })}
                      placeholder="About two weeks"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Call to action</Label>
                      <Select
                        value={form.cta_kind}
                        onValueChange={(value) => patch({ cta_kind: value as CtaKind })}
                        disabled={locked}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CTA_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {CTA_LABELS[kind]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cta-target">Where it goes</Label>
                      <Input
                        id="cta-target"
                        value={form.cta_target}
                        disabled={locked}
                        onChange={(event) => patch({ cta_target: event.target.value })}
                        placeholder="A booking link, email address, or brief URL"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Link preview</CardTitle>
                  <CardDescription>Used when the page is shared. The summary is the fallback description.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="meta-title">Title</Label>
                    <Input
                      id="meta-title"
                      value={form.meta_title}
                      disabled={locked}
                      onChange={(event) => patch({ meta_title: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="meta-description">Description</Label>
                    <Textarea
                      id="meta-description"
                      value={form.meta_description}
                      disabled={locked}
                      onChange={(event) => patch({ meta_description: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="og-image">Share image</Label>
                    {form.og_image_path && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={productCardAssetUrl(form.og_image_path) || ''}
                        alt=""
                        className="max-h-40 rounded-md border object-cover"
                      />
                    )}
                    {canManage && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id="og-image"
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          disabled={uploadingOg}
                          onChange={(event) => void onOgFile(event.target.files?.[0] ?? null)}
                        />
                        {form.og_image_path && (
                          <Button type="button" variant="ghost" onClick={() => void clearOg()}>
                            Remove
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="proof" className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle>Examples</CardTitle>
                    <CardDescription>
                      Proof stays off the public page until someone signs it off. Logos and quotes also need a client name.
                    </CardDescription>
                  </div>
                  {canManage && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingExample(null)
                        setExampleOpen(true)
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  {examples.length === 0 && (
                    <p className="text-sm text-muted-foreground">No examples yet.</p>
                  )}
                  {examples.map((example) => (
                    <button
                      key={example.id}
                      type="button"
                      className="flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left hover:bg-accent"
                      onClick={() => {
                        if (!canManage) return
                        setEditingExample(example)
                        setExampleOpen(true)
                      }}
                    >
                      <div>
                        <p className="text-sm font-medium">{example.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {EXAMPLE_KIND_LABELS[example.kind]}
                          {example.company_name ? ` · ${example.company_name}` : ''}
                        </p>
                      </div>
                      <Badge variant={example.is_public ? 'secondary' : 'outline'}>
                        {example.is_public ? 'Public' : 'Not public'}
                      </Badge>
                    </button>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Related products</CardTitle>
                  <CardDescription>
                    Only published cards appear as related on the public page. Save the card to keep this list.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {relatedOptions.length === 0 && (
                    <p className="text-sm text-muted-foreground">Add another card before relating them.</p>
                  )}
                  {relatedOptions.map((option) => (
                    <label key={option.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={relatedIds.includes(option.id)}
                        disabled={locked}
                        onChange={() => toggleRelated(option.id)}
                      />
                      <span>{option.name}</span>
                      <span className="text-xs text-muted-foreground">{STATUS_LABELS[option.status]}</span>
                    </label>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="share" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Send a tracked link</CardTitle>
                  <CardDescription>
                    {viewsTotal} {viewsTotal === 1 ? 'view' : 'views'} in total, {views30d} in the last 30 days
                    {directViews > 0 ? `, including ${directViews} without a tracked link` : ''}.
                    {form.status === 'draft'
                      ? ' This card is still a draft, so a link will not open until it is unlisted or published.'
                      : form.status === 'retired'
                        ? ' Retired cards still open, and the page says the product is no longer offered.'
                        : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="link-label">Label</Label>
                      <Input
                        id="link-label"
                        value={linkLabel}
                        onChange={(event) => setLinkLabel(event.target.value)}
                        placeholder="LinkedIn post, or a note"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="link-contact">Contact name</Label>
                      <Input
                        id="link-contact"
                        value={linkContact}
                        onChange={(event) => setLinkContact(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="link-email">Contact email</Label>
                      <Input
                        id="link-email"
                        type="email"
                        value={linkEmail}
                        onChange={(event) => setLinkEmail(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="link-expires">Expires (optional)</Label>
                      <Input
                        id="link-expires"
                        type="date"
                        value={linkExpires}
                        onChange={(event) => setLinkExpires(event.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The name and email are stored on the link. Studio does not have a contacts list to search yet, so a view shows here and is not written onto a contact record.
                  </p>
                  <Button onClick={() => void createLink()} disabled={creatingLink}>
                    {creatingLink && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create link
                  </Button>
                  <div className="space-y-3">
                    {links.length === 0 && (
                      <p className="text-sm text-muted-foreground">No links yet.</p>
                    )}
                    {links.map((link) => (
                      <div key={link.id} className="space-y-2 rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{link.label || link.contact_name || 'Link'}</p>
                            <p className="text-xs text-muted-foreground">
                              {[link.contact_name, link.contact_email].filter(Boolean).join(' · ') || 'Generic link'}
                              {' · '}
                              {linkState(link)}
                              {' · '}
                              {link.view_count} {link.view_count === 1 ? 'view' : 'views'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label htmlFor={`active-${link.id}`} className="text-xs font-normal">
                              Active
                            </Label>
                            <Switch
                              id={`active-${link.id}`}
                              checked={link.is_active}
                              onCheckedChange={(checked) => void toggleLink(link, checked)}
                            />
                            <Button type="button" variant="outline" size="sm" onClick={() => void copyLink(link.url)}>
                              <Copy className="mr-2 h-4 w-4" />
                              Copy
                            </Button>
                          </div>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{link.url}</p>
                        <p className="text-xs text-muted-foreground">
                          First view {formatWhen(link.first_viewed_at)} · Last view {formatWhen(link.last_viewed_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="xl:sticky xl:top-6">
            <ProductCardPreview
              name={form.name}
              category={form.category}
              status={form.status}
              decision={form.decision_statement}
              summary={form.summary}
              priceLabel={priceLabel}
              priceNote={form.pricing_model === 'fixed' ? form.price_note : ''}
              timeline={form.timeline_text}
              ctaKind={form.cta_kind}
              coverImageUrl={form.cover_image_path ? productCardAssetUrl(form.cover_image_path) : null}
              coverImageAlt={form.cover_image_alt}
              coverIsPublic={coverIsPublic({
                path: form.cover_image_path,
                source: form.cover_image_path ? form.cover_image_source : null,
                signoffBy: form.cover_image_signoff_by,
                signoffAt: form.cover_image_signoff_at,
              })}
              items={items}
              examples={examples.map((example) => ({
                id: example.id,
                title: example.title,
                caption: example.caption,
                kindLabel: EXAMPLE_KIND_LABELS[example.kind],
                isPublic: example.is_public,
                imageUrl:
                  example.kind === 'image' || example.kind === 'logo'
                    ? productCardAssetUrl(example.storage_path) || example.url
                    : null,
              }))}
              relatedNames={relatedNames}
            />
          </div>
        </div>
      </div>

      <ExampleDialog
        cardId={id}
        example={editingExample}
        open={exampleOpen}
        onOpenChange={setExampleOpen}
        onSaved={(warning) => {
          if (warning) toast.message('Saved, with a warning', { description: warning })
          void refreshExamples()
        }}
      />
    </div>
  )
}
