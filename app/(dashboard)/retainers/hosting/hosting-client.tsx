'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { format, parseISO } from 'date-fns'
import { Globe, Loader2, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { deleteHostingSite, getHostingSites, saveHostingSite } from '@/app/actions/hosting'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  BILLING_CYCLE_LABELS,
  BILLING_CYCLES,
  DUE_SOON_DAYS,
  HOSTING_CURRENCIES,
  HOSTING_STATUSES,
  HOSTING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  domainHref,
  formatMoney,
  monthlyEquivalent,
  renewalUrgency,
  SUGGESTED_PLATFORMS,
  summariseHosting,
  upcomingRenewal,
  londonToday,
  type BillingCycle,
  type HostingSite,
  type HostingStatus,
  type PaymentMethod,
  type RenewalUrgency,
} from '@/lib/hosting/billing'
import { stripeStatusNeedsAttention, type StripeSubscriptionInfo } from '@/lib/hosting/stripe'

const ALL = 'all'

interface Draft {
  id: string | null
  clientName: string
  siteName: string
  domain: string
  platform: string
  startedOn: string
  billingCycle: BillingCycle
  amount: string
  currency: string
  paymentMethod: PaymentMethod
  stripeReference: string
  status: HostingStatus
  notes: string
}

function emptyDraft(): Draft {
  return {
    id: null,
    clientName: '',
    siteName: '',
    domain: '',
    platform: 'Flywheel',
    startedOn: '',
    billingCycle: 'monthly',
    amount: '',
    currency: 'GBP',
    paymentMethod: 'invoice',
    stripeReference: '',
    status: 'active',
    notes: '',
  }
}

function draftFromSite(site: HostingSite): Draft {
  return {
    id: site.id,
    clientName: site.client_name,
    siteName: site.site_name,
    domain: site.domain || '',
    platform: site.platform || '',
    startedOn: site.started_on || '',
    billingCycle: site.billing_cycle,
    amount: String(site.amount),
    currency: site.currency,
    paymentMethod: site.payment_method,
    stripeReference: site.stripe_reference || '',
    status: site.status,
    notes: site.notes || '',
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'd MMM yyyy')
  } catch {
    return value
  }
}

function StripeStatusBadge({ info }: { info: StripeSubscriptionInfo }) {
  const variant =
    info.status === 'canceled' || info.status === 'past_due' || info.status === 'unpaid'
      ? 'destructive'
      : info.status === 'active' || info.status === 'trialing'
        ? 'secondary'
        : 'outline'
  return <Badge variant={variant}>{info.label}</Badge>
}

function copyToClipboard(value: string, success: string) {
  void navigator.clipboard.writeText(value).then(
    () => toast.success(success),
    () => toast.error('Could not copy')
  )
}

function StripeRowActions({ info }: { info: StripeSubscriptionInfo }) {
  if (!info.dashboardUrl && !info.paymentLinkUrl) return null
  return (
    <>
      <DropdownMenuSeparator />
      {info.paymentLinkUrl && (
        <DropdownMenuItem onSelect={() => copyToClipboard(info.paymentLinkUrl as string, 'Payment link copied')}>
          Copy payment link
        </DropdownMenuItem>
      )}
      {info.dashboardUrl && (
        <>
          <DropdownMenuItem
            onSelect={() => window.open(info.dashboardUrl as string, '_blank', 'noopener,noreferrer')}
          >
            Open in Stripe
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyToClipboard(info.dashboardUrl as string, 'Dashboard link copied')}>
            Copy dashboard link
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}

function UrgencyBadge({ urgency }: { urgency: RenewalUrgency }) {
  if (urgency === 'due_soon') return <Badge variant="outline">Due soon</Badge>
  return null
}

function nextRenewal(site: HostingSite, today: string): string | null {
  if (!site.started_on) return null
  return upcomingRenewal(site.started_on, site.billing_cycle, today)
}

export default function HostingPageClient() {
  const [sites, setSites] = useState<HostingSite[]>([])
  const [stripeByReference, setStripeByReference] = useState<Record<string, StripeSubscriptionInfo>>({})
  const [stripeError, setStripeError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [cycleFilter, setCycleFilter] = useState<string>(ALL)
  const [paymentFilter, setPaymentFilter] = useState<string>(ALL)
  const [platformFilter, setPlatformFilter] = useState<string>(ALL)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<HostingSite | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const result = await getHostingSites()
      if (result.error || !result.sites) {
        setLoadError(result.error || 'Could not load hosting')
        setSites([])
        setStripeByReference({})
        setStripeError(null)
      } else {
        setLoadError(null)
        setSites(result.sites)
        setStripeByReference(result.stripe || {})
        setStripeError(result.stripeError || null)
      }
    } catch (error) {
      console.error('Error loading hosting sites:', error)
      setLoadError('Could not load hosting')
    } finally {
      setLoading(false)
    }
  }

  const today = londonToday()
  const summary = useMemo(() => summariseHosting(sites, today), [sites, today])
  const stripeAttention = useMemo(
    () =>
      sites.filter((site) => {
        if (site.status !== 'active' || !site.stripe_reference) return false
        const info = stripeByReference[site.stripe_reference]
        return Boolean(info && stripeStatusNeedsAttention(info.status))
      }),
    [sites, stripeByReference]
  )

  const platformOptions = useMemo(() => {
    const names = new Set<string>(SUGGESTED_PLATFORMS)
    for (const site of sites) {
      if (site.platform) names.add(site.platform)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [sites])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return sites
      .filter((site) => {
        if (statusFilter !== ALL && site.status !== statusFilter) return false
        if (cycleFilter !== ALL && site.billing_cycle !== cycleFilter) return false
        if (paymentFilter !== ALL && site.payment_method !== paymentFilter) return false
        if (platformFilter !== ALL && site.platform !== platformFilter) return false
        if (!query) return true
        return [site.client_name, site.site_name, site.domain, site.platform, site.stripe_reference, site.notes]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      })
      .sort((a, b) => {
        const aMissing = a.status === 'active' && !a.started_on
        const bMissing = b.status === 'active' && !b.started_on
        if (aMissing !== bMissing) return aMissing ? -1 : 1
        const aNext = nextRenewal(a, today)
        const bNext = nextRenewal(b, today)
        if (aNext && bNext && aNext !== bNext) return aNext < bNext ? -1 : 1
        if (aNext && !bNext) return -1
        if (!aNext && bNext) return 1
        return a.site_name.localeCompare(b.site_name)
      })
  }, [sites, search, statusFilter, cycleFilter, paymentFilter, platformFilter, today])

  const draftAmount = parseFloat(draft.amount)
  const draftMonthly =
    Number.isFinite(draftAmount) && draftAmount >= 0
      ? monthlyEquivalent(draftAmount, draft.billingCycle)
      : null
  const draftRenewal = draft.startedOn
    ? upcomingRenewal(draft.startedOn, draft.billingCycle, today)
    : null

  function openCreate() {
    setDraft(emptyDraft())
    setEditorOpen(true)
  }

  function openEdit(site: HostingSite) {
    setDraft(draftFromSite(site))
    setEditorOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const result = await saveHostingSite({
        id: draft.id,
        client_name: draft.clientName,
        site_name: draft.siteName,
        domain: draft.domain,
        platform: draft.platform,
        started_on: draft.startedOn,
        billing_cycle: draft.billingCycle,
        amount: draft.amount,
        currency: draft.currency,
        payment_method: draft.paymentMethod,
        stripe_reference: draft.stripeReference,
        status: draft.status,
        notes: draft.notes,
      })
      if (result.error || !result.site) {
        toast.error('Could not save site', { description: result.error })
        return
      }
      setSites((current) => {
        const without = current.filter((site) => site.id !== result.site.id)
        return [...without, result.site]
      })
      if (result.site.stripe_reference && result.stripe) {
        const reference = result.site.stripe_reference
        const info = result.stripe
        setStripeByReference((current) => ({
          ...current,
          [reference]: info,
        }))
      }
      setEditorOpen(false)
      toast.success(draft.id ? 'Site updated' : 'Site added')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const result = await deleteHostingSite(pendingDelete.id)
      if (result.error) {
        toast.error('Could not remove site', { description: result.error })
        return
      }
      setSites((current) => current.filter((site) => site.id !== pendingDelete.id))
      setPendingDelete(null)
      toast.success('Site removed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center justify-between gap-4 px-6">
          <div>
            <h1 className="text-2xl font-semibold">Hosting</h1>
            <p className="text-sm text-muted-foreground">
              Websites we host, with renewal dates, rates, and billing cycles
            </p>
          </div>
          <Button onClick={openCreate} disabled={Boolean(loadError)}>
            <Plus className="h-4 w-4" />
            Add site
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {loadError}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                  label="Active sites"
                  value={String(summary.activeCount)}
                  detail={summary.pausedCount > 0 ? `${summary.pausedCount} paused` : 'Currently hosted'}
                />
                <SummaryCard
                  label="Monthly income"
                  value={
                    summary.income.length
                      ? summary.income.map((row) => formatMoney(row.monthly, row.currency)).join(' · ')
                      : formatMoney(0, 'GBP')
                  }
                  detail="Active sites, normalised to a month"
                />
                <SummaryCard
                  label="Yearly income"
                  value={
                    summary.income.length
                      ? summary.income.map((row) => formatMoney(row.annual, row.currency)).join(' · ')
                      : formatMoney(0, 'GBP')
                  }
                  detail="The same sites across a full year"
                />
                <SummaryCard
                  label="Due soon"
                  value={String(summary.dueSoonCount)}
                  detail={
                    summary.missingStartCount > 0
                      ? `${summary.missingStartCount} active ${summary.missingStartCount === 1 ? 'site needs' : 'sites need'} a start date`
                      : `Renewing in the next ${DUE_SOON_DAYS} days`
                  }
                  emphasise={summary.dueSoonCount > 0}
                />
              </div>

              {stripeError && <p className="text-sm text-destructive">{stripeError}</p>}
              {stripeAttention.length > 0 && (
                <p className="text-sm text-destructive">
                  {stripeAttention.length === 1
                    ? `${stripeAttention[0].site_name} has a Stripe subscription that needs attention.`
                    : `${stripeAttention.length} Stripe subscriptions need attention.`}
                </p>
              )}

              {summary.income.some(
                (row) => BILLING_CYCLES.filter((cycle) => row.byCycle[cycle] > 0).length > 1
              ) && (
                <p className="text-sm text-muted-foreground">
                  {summary.income
                    .map((row) => {
                      const parts = BILLING_CYCLES.filter((cycle) => row.byCycle[cycle] > 0).map(
                        (cycle) =>
                          `${formatMoney(row.byCycle[cycle], row.currency)} a month from ${BILLING_CYCLE_LABELS[cycle].toLowerCase()} sites`
                      )
                      return parts.join(' · ')
                    })
                    .join(' · ')}
                </p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search client, site, or domain"
                  className="sm:max-w-xs"
                />
                <FilterSelect
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'paused', label: 'Paused' },
                    { value: 'ended', label: 'Ended' },
                    { value: ALL, label: 'All statuses' },
                  ]}
                />
                <FilterSelect
                  value={cycleFilter}
                  onChange={setCycleFilter}
                  options={[
                    { value: ALL, label: 'All cycles' },
                    ...BILLING_CYCLES.map((cycle) => ({
                      value: cycle,
                      label: BILLING_CYCLE_LABELS[cycle],
                    })),
                  ]}
                />
                <FilterSelect
                  value={paymentFilter}
                  onChange={setPaymentFilter}
                  options={[
                    { value: ALL, label: 'All payments' },
                    ...PAYMENT_METHODS.map((method) => ({
                      value: method,
                      label: PAYMENT_METHOD_LABELS[method],
                    })),
                  ]}
                />
                <FilterSelect
                  value={platformFilter}
                  onChange={setPlatformFilter}
                  options={[
                    { value: ALL, label: 'All platforms' },
                    ...platformOptions.map((platform) => ({ value: platform, label: platform })),
                  ]}
                />
              </div>

              {sites.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Globe className="mb-4 h-12 w-12 text-muted-foreground" />
                    <p className="mb-2 text-lg font-medium">No hosted sites yet</p>
                    <p className="mb-4 text-center text-sm text-muted-foreground">
                      Add each website with its start date, cost, and billing cycle. Renewals are calculated from those.
                    </p>
                    <Button onClick={openCreate}>
                      <Plus className="h-4 w-4" />
                      Add site
                    </Button>
                  </CardContent>
                </Card>
              ) : filtered.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-muted-foreground">
                    No sites match these filters.
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Site</TableHead>
                        <TableHead>Hosted on</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Renewal</TableHead>
                        <TableHead>Cycle</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-12">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((site) => {
                        const renewal = nextRenewal(site, today)
                        const urgency = renewalUrgency(renewal, site.status, today)
                        const perMonth = monthlyEquivalent(site.amount, site.billing_cycle)
                        return (
                          <TableRow key={site.id}>
                            <TableCell>
                              <div className="font-medium">{site.site_name}</div>
                              {site.domain && (
                                <a
                                  href={domainHref(site.domain)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                                >
                                  {site.domain.replace(/^https?:\/\//i, '')}
                                </a>
                              )}
                            </TableCell>
                            <TableCell>{site.platform || '—'}</TableCell>
                            <TableCell>{formatDate(site.started_on)}</TableCell>
                            <TableCell>
                              {renewal ? (
                                <div className="flex items-center gap-2">
                                  <span>{formatDate(renewal)}</span>
                                  <UrgencyBadge urgency={urgency} />
                                </div>
                              ) : (
                                <span className="text-muted-foreground">Add a start date</span>
                              )}
                            </TableCell>
                            <TableCell>{BILLING_CYCLE_LABELS[site.billing_cycle]}</TableCell>
                            <TableCell>
                              <div className="tabular-nums">{formatMoney(site.amount, site.currency)}</div>
                              {site.billing_cycle !== 'monthly' && (
                                <div className="text-xs text-muted-foreground tabular-nums">
                                  {formatMoney(perMonth, site.currency)} / month
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div>{PAYMENT_METHOD_LABELS[site.payment_method]}</div>
                              {site.payment_method === 'stripe' && site.stripe_reference && stripeByReference[site.stripe_reference] && (
                                <div className="mt-1">
                                  <StripeStatusBadge info={stripeByReference[site.stripe_reference]} />
                                </div>
                              )}
                              {site.payment_method === 'stripe' && !site.stripe_reference && (
                                <div className="text-xs text-muted-foreground">Add a sub_ ID</div>
                              )}
                            </TableCell>
                            <TableCell>{HOSTING_STATUS_LABELS[site.status]}</TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Actions for ${site.site_name}`}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => openEdit(site)}>
                                    Edit
                                  </DropdownMenuItem>
                                  {site.stripe_reference && stripeByReference[site.stripe_reference] && (
                                    <StripeRowActions info={stripeByReference[site.stripe_reference]} />
                                  )}
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => setPendingDelete(site)}
                                  >
                                    Remove
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id ? 'Edit hosted site' : 'Add hosted site'}</DialogTitle>
            <DialogDescription>
              The next renewal is calculated from the start date and billing cycle. Monthly income converts quarterly and yearly amounts.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client">
                <Input
                  value={draft.clientName}
                  onChange={(event) => setDraft({ ...draft, clientName: event.target.value })}
                  placeholder="Client name"
                />
              </Field>
              <Field label="Site name">
                <Input
                  value={draft.siteName}
                  onChange={(event) => setDraft({ ...draft, siteName: event.target.value })}
                  placeholder="Marketing site"
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Domain">
                <Input
                  value={draft.domain}
                  onChange={(event) => setDraft({ ...draft, domain: event.target.value })}
                  placeholder="example.com"
                />
              </Field>
              <Field label="Hosted on">
                <Input
                  list="hosting-platforms"
                  value={draft.platform}
                  onChange={(event) => setDraft({ ...draft, platform: event.target.value })}
                  placeholder="Flywheel"
                />
                <datalist id="hosting-platforms">
                  {platformOptions.map((platform) => (
                    <option key={platform} value={platform} />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  Pick a platform, or type a new one.
                </p>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Started">
                <Input
                  type="date"
                  value={draft.startedOn}
                  onChange={(event) => setDraft({ ...draft, startedOn: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Billing repeats from this date.
                </p>
              </Field>
              <div className="grid gap-2">
                <Label>Next renewal</Label>
                <p className="flex h-9 items-center text-sm">
                  {draftRenewal ? formatDate(draftRenewal) : 'Set a start date'}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Billing cycle">
                <Select
                  value={draft.billingCycle}
                  onValueChange={(value) =>
                    setDraft({ ...draft, billingCycle: value as BillingCycle })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_CYCLES.map((cycle) => (
                      <SelectItem key={cycle} value={cycle}>
                        {BILLING_CYCLE_LABELS[cycle]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select
                  value={draft.status}
                  onValueChange={(value) => setDraft({ ...draft, status: value as HostingStatus })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOSTING_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {HOSTING_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount per cycle">
                <Input
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Currency">
                <Select
                  value={draft.currency}
                  onValueChange={(value) => setDraft({ ...draft, currency: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOSTING_CURRENCIES.map((currency) => (
                      <SelectItem key={currency} value={currency}>
                        {currency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {draftMonthly != null && (
              <p className="text-sm text-muted-foreground">
                {formatMoney(draftMonthly, draft.currency)} per month
                {draft.billingCycle !== 'monthly' ? ', from this cycle amount' : ''}.
              </p>
            )}
            <Field label="Payment">
              <Select
                value={draft.paymentMethod}
                onValueChange={(value) =>
                  setDraft({ ...draft, paymentMethod: value as PaymentMethod })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {draft.paymentMethod === 'stripe' && (
              <Field label="Stripe subscription ID">
                <Input
                  value={draft.stripeReference}
                  onChange={(event) => setDraft({ ...draft, stripeReference: event.target.value })}
                  placeholder="sub_…"
                />
                <p className="text-xs text-muted-foreground">
                  The subscription ID from Stripe. Studio reads its status, and can copy the payment link they used to subscribe.
                </p>
              </Field>
            )}
            <Field label="Notes">
              <Textarea
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                placeholder="Plan, inclusions, or anything to remember at renewal"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Add site'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove hosted site?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `${pendingDelete.site_name} for ${pendingDelete.client_name} will be removed from hosting.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  detail,
  emphasise = false,
}: {
  label: string
  value: string
  detail: string
  emphasise?: boolean
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${emphasise ? 'text-destructive' : ''}`}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
