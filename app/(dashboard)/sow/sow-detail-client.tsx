'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Share2,
  ScrollText,
  Download,
  Link2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  archiveSowDocument,
  createSowDocument,
  createSowShareLink,
  deactivateSowShareLink,
  deleteSowDocument,
  getSowAgencies,
  getSowClients,
  getSowDocument,
  updateSowDocument,
  type SowDocument,
  type SowLinkedLead,
  type SowShareLink,
} from '@/app/actions/sow'
import {
  getSowLeadImportData,
  getSowLeadsForImport,
  type SowLeadOption,
} from '@/app/actions/sow-leads'
import { getQuoteRates, type QuoteRate } from '@/app/actions/quote-rates'
import { VAT_RATE } from '@/lib/sow/calculations'
import { getClientApprovalStatus } from '@/lib/sow/status'
import { cn } from '@/lib/utils'

interface LineItemForm {
  id: string
  title: string
  description: string
  quantity: number
  is_days: boolean
}

interface SowDetailClientProps {
  sowId?: string
}

function formatMoney(value: number) {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function approvalBadgeClass(tone: ReturnType<typeof getClientApprovalStatus>['tone']) {
  switch (tone) {
    case 'success':
      return 'bg-green-600'
    case 'warning':
      return 'bg-amber-500 text-white'
    case 'destructive':
      return ''
    default:
      return ''
  }
}

export function SowDetailClient({ sowId }: SowDetailClientProps) {
  const router = useRouter()
  const isNew = !sowId

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [document, setDocument] = useState<SowDocument | null>(null)
  const [shareLinks, setShareLinks] = useState<SowShareLink[]>([])
  const [agencies, setAgencies] = useState<string[]>([])
  const [clients, setClients] = useState<string[]>([])
  const [quoteRates, setQuoteRates] = useState<QuoteRate[]>([])
  const [creatingLink, setCreatingLink] = useState(false)
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null)
  const [leads, setLeads] = useState<SowLeadOption[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState('')
  const [importingLead, setImportingLead] = useState(false)
  const [mondayProjectId, setMondayProjectId] = useState<string | null>(null)
  const [pushToMonday, setPushToMonday] = useState(false)
  const [linkedLead, setLinkedLead] = useState<SowLinkedLead | null>(null)

  const [title, setTitle] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [customAgency, setCustomAgency] = useState('')
  const [clientName, setClientName] = useState('')
  const [customClient, setCustomClient] = useState('')
  const [customerType, setCustomerType] = useState<'partner' | 'client'>('client')
  const [includeVat, setIncludeVat] = useState(true)
  const [showQuotedHours, setShowQuotedHours] = useState(false)
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItemForm[]>([])
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemDescription, setNewItemDescription] = useState('')
  const [newItemQuantity, setNewItemQuantity] = useState(0)
  const [newItemIsDays, setNewItemIsDays] = useState(false)

  const isReadOnly = document?.status === 'approved'
  const isPartnerWork = customerType === 'partner'
  const resolvedAgencyName = agencyName === '__custom__' ? customAgency.trim() : agencyName
  const resolvedClientName = clientName === '__custom__' ? customClient.trim() : clientName

  useEffect(() => {
    loadSupportingData()
    if (sowId) loadDocument(sowId)
  }, [sowId])

  useEffect(() => {
    loadClientsForAgency(isPartnerWork ? resolvedAgencyName || null : null)
  }, [customerType, resolvedAgencyName])

  const clientApproval = document
    ? getClientApprovalStatus(document.status, document)
    : null

  async function loadSupportingData() {
    const [agenciesResult, ratesResult, leadsResult] = await Promise.all([
      getSowAgencies(),
      getQuoteRates(),
      isNew ? getSowLeadsForImport() : Promise.resolve({ success: true as const, leads: [] }),
    ])
    if (agenciesResult.success && agenciesResult.agencies) setAgencies(agenciesResult.agencies)
    if (ratesResult.success && ratesResult.rates) setQuoteRates(ratesResult.rates)
    if (leadsResult.success && leadsResult.leads) setLeads(leadsResult.leads)
  }

  async function loadClientsForAgency(agency?: string | null) {
    const result = await getSowClients(agency)
    if (result.success && result.clients) setClients(result.clients)
  }

  async function loadDocument(id: string) {
    setLoading(true)
    try {
      const [agenciesResult, result] = await Promise.all([getSowAgencies(), getSowDocument(id)])
      if (agenciesResult.success && agenciesResult.agencies) {
        setAgencies(agenciesResult.agencies)
      }
      const agencyList = agenciesResult.success && agenciesResult.agencies ? agenciesResult.agencies : []

      if (result.error) {
        toast.error('Error loading SoW', { description: result.error })
        router.push('/sow')
        return
      }
      if (result.document) {
        const doc = result.document
        setDocument(doc)
        setTitle(doc.title)
        setCustomerType(doc.customer_type)
        if (doc.agency_name) {
          setAgencyName(agencyList.includes(doc.agency_name) ? doc.agency_name : '__custom__')
          if (!agencyList.includes(doc.agency_name)) setCustomAgency(doc.agency_name)
        } else {
          setAgencyName('')
          setCustomAgency('')
        }

        const clientsResult = await getSowClients(
          doc.customer_type === 'partner' ? doc.agency_name : null
        )
        const clientList = clientsResult.success && clientsResult.clients ? clientsResult.clients : []
        if (clientsResult.success && clientsResult.clients) setClients(clientList)

        if (doc.client_name) {
          setClientName(clientList.includes(doc.client_name) ? doc.client_name : '__custom__')
          if (!clientList.includes(doc.client_name)) setCustomClient(doc.client_name)
        } else {
          setClientName('')
          setCustomClient('')
        }

        setIncludeVat(doc.include_vat)
        setShowQuotedHours(doc.show_quoted_hours ?? true)
        setNotes(doc.notes || '')
        setLineItems(
          (doc.line_items || []).map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description || '',
            quantity: Number(item.quantity),
            is_days: item.is_days,
          }))
        )
      }
      if (result.shareLinks) setShareLinks(result.shareLinks)
      if (result.linkedLead) setLinkedLead(result.linkedLead)
      if (result.document?.monday_project_id) {
        setMondayProjectId(result.document.monday_project_id)
      }
    } finally {
      setLoading(false)
    }
  }

  const currentRate = useMemo(
    () => quoteRates.find((r) => r.customer_type === customerType),
    [quoteRates, customerType]
  )

  const hourlyRate = useMemo(() => {
    if (!currentRate || !currentRate.hours_per_day) return 0
    return Number(currentRate.day_rate_gbp) / Number(currentRate.hours_per_day)
  }, [currentRate])

  const preview = useMemo(() => {
    if (!currentRate) return { subtotal: 0, vat: 0, total: 0, hours: 0 }
    const hoursPerDay = Number(currentRate.hours_per_day)
    let subtotal = 0
    let hours = 0
    for (const item of lineItems) {
      const itemHours = item.is_days ? item.quantity * hoursPerDay : item.quantity
      subtotal += itemHours * hourlyRate
      hours += itemHours
    }
    const vat = includeVat ? subtotal * VAT_RATE : 0
    return { subtotal, vat, total: subtotal + vat, hours }
  }, [lineItems, currentRate, hourlyRate, includeVat])

  function handleCustomerTypeChange(value: 'partner' | 'client') {
    setCustomerType(value)
    if (value === 'client') {
      setAgencyName('')
      setCustomAgency('')
    }
  }

  function handleAgencyChange(value: string) {
    setAgencyName(value)
    setClientName('')
    setCustomClient('')
  }

  async function handleImportLead() {
    if (!selectedLeadId) {
      toast.error('Select a lead to import')
      return
    }

    setImportingLead(true)
    try {
      const result = await getSowLeadImportData(selectedLeadId)
      if (result.error || !result.data) {
        toast.error('Error importing lead', { description: result.error })
        return
      }

      const data = result.data
      setMondayProjectId(data.monday_project_id)
      setPushToMonday(false)
      setTitle(data.title)
      setCustomerType(data.customer_type)

      if (data.agency_name) {
        setAgencyName(agencies.includes(data.agency_name) ? data.agency_name : '__custom__')
        if (!agencies.includes(data.agency_name)) setCustomAgency(data.agency_name)
      } else {
        setAgencyName('')
        setCustomAgency('')
      }

      const clientsResult = await getSowClients(
        data.customer_type === 'partner' ? data.agency_name : null
      )
      const clientList = clientsResult.success && clientsResult.clients ? clientsResult.clients : []
      if (clientsResult.success && clientsResult.clients) setClients(clientList)

      if (data.client_name) {
        setClientName(clientList.includes(data.client_name) ? data.client_name : '__custom__')
        if (!clientList.includes(data.client_name)) setCustomClient(data.client_name)
      }

      setLineItems(
        data.line_items.map((item) => ({
          id: crypto.randomUUID(),
          title: item.title,
          description: item.description || '',
          quantity: item.quantity,
          is_days: item.is_days,
        }))
      )

      toast.success('Lead imported from Leads board')
    } finally {
      setImportingLead(false)
    }
  }

  function handleAddItem() {
    if (!newItemTitle.trim()) {
      toast.error('Enter a task title')
      return
    }
    if (newItemQuantity <= 0) {
      toast.error(newItemIsDays ? 'Days must be greater than 0' : 'Hours must be greater than 0')
      return
    }
    setLineItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: newItemTitle.trim(),
        description: newItemDescription.trim(),
        quantity: newItemQuantity,
        is_days: newItemIsDays,
      },
    ])
    setNewItemTitle('')
    setNewItemDescription('')
    setNewItemQuantity(0)
    setNewItemIsDays(false)
  }

  function handleRemoveItem(id: string) {
    setLineItems((prev) => prev.filter((item) => item.id !== id))
  }

  async function handleSave() {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }
    if (!resolvedClientName) {
      toast.error('End client is required')
      return
    }
    if (isPartnerWork && !resolvedAgencyName) {
      toast.error('Agency partner is required')
      return
    }
    if (lineItems.length === 0) {
      toast.error('Add at least one line item')
      return
    }

    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        client_name: resolvedClientName,
        agency_name: isPartnerWork ? resolvedAgencyName : null,
        customer_type: customerType,
        include_vat: includeVat,
        show_quoted_hours: showQuotedHours,
        notes: notes.trim() || null,
        monday_project_id: mondayProjectId,
        push_to_monday: isNew && pushToMonday && !mondayProjectId,
        line_items: lineItems.map((item) => ({
          title: item.title,
          description: item.description.trim() || null,
          quantity: item.quantity,
          is_days: item.is_days,
        })),
      }

      if (isNew) {
        const result = await createSowDocument(payload)
        if (result.error) {
          toast.error('Error creating SoW', { description: result.error })
        } else if (result.document) {
          if (result.pushWarning) {
            toast.warning('SoW created but could not push to Monday', {
              description: result.pushWarning,
            })
          } else if (pushToMonday && !mondayProjectId) {
            toast.success('Statement of work created and pushed to Leads board')
          } else {
            toast.success('Statement of work created')
          }
          router.push(`/sow/${result.document.id}`)
        }
      } else if (sowId) {
        const result = await updateSowDocument(sowId, payload)
        if (result.error) {
          toast.error('Error saving SoW', { description: result.error })
        } else {
          toast.success('Statement of work saved')
          await loadDocument(sowId)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateShareLink() {
    if (!sowId) return
    setCreatingLink(true)
    try {
      const result = await createSowShareLink(sowId)
      if (result.error) {
        toast.error('Error creating share link', { description: result.error })
      } else {
        toast.success('Share link created')
        await loadDocument(sowId)
      }
    } finally {
      setCreatingLink(false)
    }
  }

  async function handleCopyLink(token: string, linkId: string) {
    const url = `${window.location.origin}/sow/share/${token}`
    await navigator.clipboard.writeText(url)
    setCopiedLinkId(linkId)
    toast.success('Link copied')
    setTimeout(() => setCopiedLinkId(null), 2000)
  }

  async function handleDeactivateLink(linkId: string) {
    if (!sowId) return
    const result = await deactivateSowShareLink(linkId)
    if (result.error) {
      toast.error('Error deactivating link', { description: result.error })
    } else {
      toast.success('Share link deactivated')
      await loadDocument(sowId)
    }
  }

  async function handleArchive() {
    if (!sowId || !confirm('Archive this statement of work?')) return
    const result = await archiveSowDocument(sowId)
    if (result.error) {
      toast.error('Error archiving', { description: result.error })
    } else {
      toast.success('Archived')
      router.push('/sow')
    }
  }

  async function handleDelete() {
    if (!sowId) return

    const message =
      document?.status === 'approved'
        ? 'Permanently delete this approved statement of work? This cannot be undone.'
        : 'Permanently delete this statement of work? This cannot be undone.'

    if (!confirm(message)) return

    const result = await deleteSowDocument(sowId)
    if (result.error) {
      toast.error('Error deleting', { description: result.error })
    } else {
      toast.success('Statement of work deleted')
      router.push('/sow')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/sow">
              <ArrowLeft className="mr-1 h-4 w-4" />
              All SoWs
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ScrollText className="h-7 w-7" />
            {isNew ? 'New statement of work' : title || 'Statement of work'}
          </h1>
          {document && clientApproval && (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant={clientApproval.tone === 'destructive' ? 'destructive' : 'secondary'}
                className={cn(approvalBadgeClass(clientApproval.tone))}
              >
                {clientApproval.label}
              </Badge>
              <span className="text-sm text-muted-foreground">{clientApproval.description}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {!isNew && (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              Delete
            </Button>
          )}
          {!isNew && !isReadOnly && (
            <Button variant="outline" onClick={handleArchive}>
              Archive
            </Button>
          )}
          {!isReadOnly && (
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isNew ? 'Create SoW' : 'Save changes'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {isNew && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Import from Leads board
                </CardTitle>
                <CardDescription>
                  Pull an existing lead into this SoW — title, client, and line items from Monday
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row gap-3">
                <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
                  <SelectTrigger className="sm:flex-1">
                    <SelectValue placeholder="Select a lead" />
                  </SelectTrigger>
                  <SelectContent>
                    {leads.map((lead) => (
                      <SelectItem key={lead.id} value={lead.id}>
                        {lead.name}
                        {lead.client_name ? ` — ${lead.client_name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={handleImportLead}
                  disabled={importingLead || !selectedLeadId}
                >
                  {importingLead ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Import lead
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Document details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sow-title">Title</Label>
                <Input
                  id="sow-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Website redesign — Phase 1"
                  disabled={isReadOnly}
                />
              </div>
              <div className="space-y-2">
                <Label>Rate type</Label>
                <Tabs value={customerType} onValueChange={(v) => handleCustomerTypeChange(v as 'partner' | 'client')}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="client" disabled={isReadOnly}>
                      Direct client
                    </TabsTrigger>
                    <TabsTrigger value="partner" disabled={isReadOnly}>
                      Via agency
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                  {isPartnerWork
                    ? 'Partner rates apply when billing an agency for work on an end client.'
                    : 'Client rates apply for direct client relationships.'}
                </p>
              </div>

              {isPartnerWork && (
                <div className="space-y-2">
                  <Label>Agency partner</Label>
                  <Select value={agencyName} onValueChange={handleAgencyChange} disabled={isReadOnly}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select agency" />
                    </SelectTrigger>
                    <SelectContent>
                      {agencies.map((agency) => (
                        <SelectItem key={agency} value={agency}>
                          {agency}
                        </SelectItem>
                      ))}
                      <SelectItem value="__custom__">Other (type below)</SelectItem>
                    </SelectContent>
                  </Select>
                  {agencyName === '__custom__' && (
                    <Input
                      value={customAgency}
                      onChange={(e) => setCustomAgency(e.target.value)}
                      placeholder="Agency name"
                      disabled={isReadOnly}
                      className="mt-2"
                    />
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>End client</Label>
                <Select
                  value={clientName}
                  onValueChange={setClientName}
                  disabled={isReadOnly || (isPartnerWork && !resolvedAgencyName)}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isPartnerWork && !resolvedAgencyName
                          ? 'Select agency first'
                          : 'Select end client'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client} value={client}>
                        {client}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">Other (type below)</SelectItem>
                  </SelectContent>
                </Select>
                {clientName === '__custom__' && (
                  <Input
                    value={customClient}
                    onChange={(e) => setCustomClient(e.target.value)}
                    placeholder="End client name"
                    disabled={isReadOnly}
                    className="mt-2"
                  />
                )}
                {isPartnerWork && resolvedAgencyName && clients.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No Monday projects found for this agency — use Other to enter the end client.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="sow-notes">Notes (optional)</Label>
                <Textarea
                  id="sow-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  disabled={isReadOnly}
                  placeholder="Scope assumptions, deliverables summary, etc."
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="sow-show-hours">Show quoted hours on share view</Label>
                  <p className="text-xs text-muted-foreground">
                    Clients see time per line item and total hours when enabled
                  </p>
                </div>
                <Switch
                  id="sow-show-hours"
                  checked={showQuotedHours}
                  onCheckedChange={setShowQuotedHours}
                  disabled={isReadOnly}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="sow-vat">Include VAT (20%)</Label>
                  <p className="text-xs text-muted-foreground">Shown on totals and client share view</p>
                </div>
                <Switch
                  id="sow-vat"
                  checked={includeVat}
                  onCheckedChange={setIncludeVat}
                  disabled={isReadOnly}
                />
              </div>
              {isNew && !mondayProjectId && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="sow-push-monday">Push to Leads board</Label>
                    <p className="text-xs text-muted-foreground">
                      Create a new item on the Leads board when this SoW is saved
                    </p>
                  </div>
                  <Switch
                    id="sow-push-monday"
                    checked={pushToMonday}
                    onCheckedChange={setPushToMonday}
                  />
                </div>
              )}
              {isNew && mondayProjectId && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Linked to an existing Leads board item — push is not needed
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
              <CardDescription>Tasks with time and cost</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {lineItems.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead className="text-right">Time</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      {!isReadOnly && <TableHead className="w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItems.map((item) => {
                      const hours = item.is_days
                        ? item.quantity * (currentRate?.hours_per_day || 6)
                        : item.quantity
                      const cost = hours * hourlyRate
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <p className="font-medium">{item.title}</p>
                            {item.description && (
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">
                                {item.description}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {item.is_days
                              ? `${item.quantity} day${item.quantity !== 1 ? 's' : ''} (${hours.toFixed(1)}h)`
                              : `${item.quantity}h`}
                          </TableCell>
                          <TableCell className="text-right">{formatMoney(cost)}</TableCell>
                          {!isReadOnly && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveItem(item.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}

              {!isReadOnly && (
                <div className="rounded-lg border p-4 space-y-3">
                  <Label>Add line item</Label>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Input
                      className="sm:col-span-2"
                      placeholder="Task title"
                      value={newItemTitle}
                      onChange={(e) => setNewItemTitle(e.target.value)}
                    />
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder={newItemIsDays ? 'Days' : 'Hours'}
                      value={newItemQuantity || ''}
                      onChange={(e) => setNewItemQuantity(parseFloat(e.target.value) || 0)}
                    />
                    <Button onClick={handleAddItem}>
                      <Plus className="mr-1 h-4 w-4" />
                      Add
                    </Button>
                  </div>
                  <Textarea
                    placeholder="Description (optional)"
                    value={newItemDescription}
                    onChange={(e) => setNewItemDescription(e.target.value)}
                    rows={2}
                  />
                  <div className="flex items-center gap-2">
                    <Switch
                      id="new-item-days"
                      checked={newItemIsDays}
                      onCheckedChange={setNewItemIsDays}
                    />
                    <Label htmlFor="new-item-days">Enter as days</Label>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {!isNew && clientApproval && (
            <Card>
              <CardHeader>
                <CardTitle>Client approval</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge
                  variant={clientApproval.tone === 'destructive' ? 'destructive' : 'secondary'}
                  className={cn(approvalBadgeClass(clientApproval.tone))}
                >
                  {clientApproval.label}
                </Badge>
                <p className="text-sm text-muted-foreground">{clientApproval.description}</p>
                {document?.rejection_notes && (
                  <p className="text-sm border rounded-md p-3 bg-muted/50">
                    {document.rejection_notes}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {!isNew && linkedLead && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Leads board
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Lead</span>
                  <span className="font-medium text-right">{linkedLead.name}</span>
                </div>
                {linkedLead.monday_status && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Pipeline status</span>
                    <span>{linkedLead.monday_status}</span>
                  </div>
                )}
                {linkedLead.likelihood != null && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Likelihood</span>
                    <span>{linkedLead.likelihood}%</span>
                  </div>
                )}
                {document?.pushed_to_monday_at && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Pushed to Monday on {new Date(document.pushed_to_monday_at).toLocaleDateString()}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatMoney(preview.subtotal)}</span>
              </div>
              {includeVat && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT (20%)</span>
                  <span>{formatMoney(preview.vat)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-base pt-2 border-t">
                <span>Total</span>
                <span>{formatMoney(preview.total)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground pt-1">
                <span>Total hours</span>
                <span>{preview.hours.toFixed(1)}h</span>
              </div>
              {currentRate && (
                <p className="text-xs text-muted-foreground pt-2">
                  Rate: {formatMoney(Number(currentRate.day_rate_gbp))}/day ({currentRate.hours_per_day}h)
                </p>
              )}
            </CardContent>
          </Card>

          {!isNew && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Share2 className="h-4 w-4" />
                  Client share
                </CardTitle>
                <CardDescription>
                  Send a link for the client to review and approve this SoW
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleCreateShareLink}
                  disabled={creatingLink || isReadOnly}
                >
                  {creatingLink ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-2 h-4 w-4" />
                  )}
                  Create share link
                </Button>
                {shareLinks.map((link) => (
                  <div
                    key={link.id}
                    className={cn(
                      'rounded-lg border p-3 space-y-2',
                      !link.is_active && 'opacity-60'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={link.is_active ? 'default' : 'secondary'}>
                        {link.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(link.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {link.is_active && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="flex-1"
                          onClick={() => handleCopyLink(link.share_token, link.id)}
                        >
                          {copiedLinkId === link.id ? (
                            <Check className="mr-1 h-4 w-4" />
                          ) : (
                            <Copy className="mr-1 h-4 w-4" />
                          )}
                          Copy link
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeactivateLink(link.id)}
                        >
                          Deactivate
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
