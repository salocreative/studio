'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  Pencil,
  Trash2,
  Share2,
  ScrollText,
  Download,
  RefreshCw,
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
  type SowShareLink,
} from '@/app/actions/sow'
import {
  getSowLeadImportData,
  getSowLeadsForImport,
  type SowLeadOption,
} from '@/app/actions/sow-leads'
import { getQuoteRates, type QuoteRate } from '@/app/actions/quote-rates'
import { getSowPartyRates, type SowPartyRate } from '@/app/actions/sow-party-rates'
import { pushSowToMonday, updateSowOnMonday } from '@/app/actions/sow-to-monday'
import { getGbpFxRate } from '@/app/actions/sow-fx'
import {
  VAT_RATE,
  DEFAULT_PAYMENT_SCHEDULE,
  getRateMultiplier,
  scaleForQuote,
  resolvePartyRate,
  formatSowMoney,
  type SowCurrency,
} from '@/lib/sow/calculations'
import { getClientApprovalStatus } from '@/lib/sow/status'
import { cn } from '@/lib/utils'

interface LineItemForm {
  id: string
  title: string
  description: string
  quantity: number
  is_days: boolean
  timeline_start: string
  timeline_end: string
}

interface PaymentMilestoneForm {
  id: string
  label: string
  percentage: number
  due_date: string
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
  const [partyRates, setPartyRates] = useState<SowPartyRate[]>([])
  const [creatingLink, setCreatingLink] = useState(false)
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null)
  const [leads, setLeads] = useState<SowLeadOption[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState('')
  const [importingLead, setImportingLead] = useState(false)
  const [mondayProjectId, setMondayProjectId] = useState<string | null>(null)
  const [pushToMonday, setPushToMonday] = useState(false)
  const [updatingMonday, setUpdatingMonday] = useState(false)
  const [editorTab, setEditorTab] = useState<'details' | 'deliverables' | 'payment' | 'rates'>(
    'details'
  )

  const [title, setTitle] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [customAgency, setCustomAgency] = useState('')
  const [clientName, setClientName] = useState('')
  const [customClient, setCustomClient] = useState('')
  const [customerType, setCustomerType] = useState<'partner' | 'client'>('client')
  const [includeVat, setIncludeVat] = useState(true)
  const [showQuotedHours, setShowQuotedHours] = useState(false)
  const [showPaymentSchedule, setShowPaymentSchedule] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  /** Empty string = use standard rate (no override) */
  const [dayRateOverrideInput, setDayRateOverrideInput] = useState('')
  const [currency, setCurrency] = useState<SowCurrency>('GBP')
  const [fxRateInput, setFxRateInput] = useState('1')
  const [fetchingFx, setFetchingFx] = useState(false)
  const [lineItems, setLineItems] = useState<LineItemForm[]>([])
  const [paymentMilestones, setPaymentMilestones] = useState<PaymentMilestoneForm[]>(() =>
    DEFAULT_PAYMENT_SCHEDULE.map((m) => ({
      id: crypto.randomUUID(),
      label: m.label,
      percentage: m.percentage,
      due_date: '',
    }))
  )
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemDescription, setNewItemDescription] = useState('')
  const [newItemQuantity, setNewItemQuantity] = useState(0)
  const [newItemIsDays, setNewItemIsDays] = useState(false)
  const [newItemStart, setNewItemStart] = useState('')
  const [newItemEnd, setNewItemEnd] = useState('')
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  const isReadOnly = document?.status === 'approved'
  const isPartnerWork = customerType === 'partner'
  const resolvedAgencyName = agencyName === '__custom__' ? customAgency.trim() : agencyName
  const resolvedClientName = clientName === '__custom__' ? customClient.trim() : clientName
  const hasMondayLink = Boolean(
    mondayProjectId || document?.monday_project_id || document?.monday_item_id
  )
  const partySelectionKey = `${customerType}|${resolvedAgencyName}|${resolvedClientName}`
  const partySelectionKeyRef = useRef<string | null>(null)

  useEffect(() => {
    partySelectionKeyRef.current = null
    loadSupportingData()
    if (sowId) loadDocument(sowId)
  }, [sowId])

  useEffect(() => {
    loadClientsForAgency(isPartnerWork ? resolvedAgencyName || null : null)
  }, [customerType, resolvedAgencyName])

  // Auto-fill quoted day rate when agency/client changes (keep saved override on initial load)
  useEffect(() => {
    if (loading) return

    if (!isNew) {
      if (partySelectionKeyRef.current === null) {
        partySelectionKeyRef.current = partySelectionKey
        return
      }
      if (partySelectionKeyRef.current === partySelectionKey) return
      partySelectionKeyRef.current = partySelectionKey
    }

    const rate = resolvePartyRate({
      customerType,
      agencyName: isPartnerWork ? resolvedAgencyName : null,
      clientName: resolvedClientName,
      rates: partyRates,
    })
    setDayRateOverrideInput(rate != null ? String(rate.day_rate_gbp) : '')
    if (rate) {
      setCurrency(rate.currency)
      if (rate.currency === 'GBP') {
        setFxRateInput('1')
      } else {
        void fetchCurrentFxRate(rate.currency)
      }
    } else {
      setCurrency('GBP')
      setFxRateInput('1')
    }
  }, [
    loading,
    isNew,
    partySelectionKey,
    customerType,
    isPartnerWork,
    resolvedAgencyName,
    resolvedClientName,
    partyRates,
  ])

  const matchedPartyRate = useMemo(() => {
    const rate = resolvePartyRate({
      customerType,
      agencyName: isPartnerWork ? resolvedAgencyName : null,
      clientName: resolvedClientName,
      rates: partyRates,
    })
    if (!rate) return null
    if (isPartnerWork && resolvedAgencyName) {
      const agencyMatch = partyRates.find(
        (r) => r.party_type === 'agency' && r.name === resolvedAgencyName
      )
      if (agencyMatch) {
        return {
          label: `agency ${agencyMatch.name}`,
          rate: Number(agencyMatch.day_rate_gbp),
          currency: (agencyMatch.currency === 'USD' ? 'USD' : 'GBP') as SowCurrency,
        }
      }
    }
    if (resolvedClientName) {
      const clientMatch = partyRates.find(
        (r) => r.party_type === 'client' && r.name === resolvedClientName
      )
      if (clientMatch) {
        return {
          label: `client ${clientMatch.name}`,
          rate: Number(clientMatch.day_rate_gbp),
          currency: (clientMatch.currency === 'USD' ? 'USD' : 'GBP') as SowCurrency,
        }
      }
    }
    return null
  }, [
    customerType,
    isPartnerWork,
    resolvedAgencyName,
    resolvedClientName,
    partyRates,
  ])

  async function fetchCurrentFxRate(targetCurrency: SowCurrency = currency) {
    if (targetCurrency === 'GBP') {
      setFxRateInput('1')
      return
    }
    setFetchingFx(true)
    try {
      const result = await getGbpFxRate(targetCurrency)
      if (result.error || !result.rate) {
        toast.error('Could not fetch exchange rate', {
          description: result.error || 'Enter the rate manually',
        })
        return
      }
      setFxRateInput(String(result.rate))
      toast.success(
        result.asOf
          ? `FX rate updated (as of ${result.asOf})`
          : 'FX rate updated'
      )
    } finally {
      setFetchingFx(false)
    }
  }  const clientApproval = document
    ? getClientApprovalStatus(document.status, document)
    : null

  async function loadSupportingData() {
    const [agenciesResult, ratesResult, partyRatesResult, leadsResult] = await Promise.all([
      getSowAgencies(),
      getQuoteRates(),
      getSowPartyRates(),
      isNew ? getSowLeadsForImport() : Promise.resolve({ success: true as const, leads: [] }),
    ])
    if (agenciesResult.success && agenciesResult.agencies) setAgencies(agenciesResult.agencies)
    if (ratesResult.success && ratesResult.rates) setQuoteRates(ratesResult.rates)
    if (partyRatesResult.success && partyRatesResult.rates) setPartyRates(partyRatesResult.rates)
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
        setShowPaymentSchedule(doc.show_payment_schedule ?? true)
        setStartDate(doc.start_date || '')
        setEndDate(doc.end_date || '')
        setNotes(doc.notes || '')
        setDayRateOverrideInput(
          doc.day_rate_override_gbp != null ? String(doc.day_rate_override_gbp) : ''
        )
        setCurrency(doc.currency === 'USD' ? 'USD' : 'GBP')
        setFxRateInput(
          doc.currency === 'USD' && doc.fx_rate != null ? String(doc.fx_rate) : '1'
        )
        setLineItems(
          (doc.line_items || []).map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description || '',
            quantity: Number(item.quantity),
            is_days: item.is_days,
            timeline_start: item.timeline_start || '',
            timeline_end: item.timeline_end || '',
          }))
        )
        const milestones = doc.payment_milestones || []
        setPaymentMilestones(
          milestones.length > 0
            ? milestones.map((m) => ({
                id: m.id,
                label: m.label,
                percentage: Number(m.percentage),
                due_date: m.due_date || '',
              }))
            : DEFAULT_PAYMENT_SCHEDULE.map((m) => ({
                id: crypto.randomUUID(),
                label: m.label,
                percentage: m.percentage,
                due_date: '',
              }))
        )
      }
      if (result.shareLinks) setShareLinks(result.shareLinks)
      setMondayProjectId(result.document?.monday_project_id ?? null)
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

  const baseDayRate = currentRate ? Number(currentRate.day_rate_gbp) : 0
  const hoursPerDay = currentRate ? Number(currentRate.hours_per_day) : 6
  const dayRateOverride = useMemo(() => {
    const trimmed = dayRateOverrideInput.trim()
    if (!trimmed) return null
    const n = parseFloat(trimmed)
    return n > 0 ? n : null
  }, [dayRateOverrideInput])
  const fxRate = useMemo(() => {
    if (currency === 'GBP') return 1
    const n = parseFloat(fxRateInput)
    return n > 0 ? n : 1
  }, [currency, fxRateInput])
  const rateMultiplier = useMemo(
    () => getRateMultiplier(baseDayRate, dayRateOverride),
    [baseDayRate, dayRateOverride]
  )
  const quotedHours = useMemo(() => {
    if (!currentRate) return 0
    const hpd = Number(currentRate.hours_per_day)
    return lineItems.reduce((sum, item) => {
      const itemHours = item.is_days ? item.quantity * hpd : item.quantity
      return sum + scaleForQuote(itemHours, rateMultiplier)
    }, 0)
  }, [lineItems, currentRate, rateMultiplier])

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
          timeline_start: item.timeline_start || '',
          timeline_end: item.timeline_end || '',
        }))
      )

      toast.success('Lead imported from Leads board')
    } finally {
      setImportingLead(false)
    }
  }

  function clearLineItemForm() {
    setNewItemTitle('')
    setNewItemDescription('')
    setNewItemQuantity(0)
    setNewItemIsDays(false)
    setNewItemStart('')
    setNewItemEnd('')
    setEditingItemId(null)
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

    const nextItem: LineItemForm = {
      id: editingItemId || crypto.randomUUID(),
      title: newItemTitle.trim(),
      description: newItemDescription.trim(),
      quantity: newItemQuantity,
      is_days: newItemIsDays,
      timeline_start: newItemStart,
      timeline_end: newItemEnd,
    }

    if (editingItemId) {
      setLineItems((prev) => prev.map((item) => (item.id === editingItemId ? nextItem : item)))
      toast.success('Line item updated')
    } else {
      setLineItems((prev) => [...prev, nextItem])
    }
    clearLineItemForm()
  }

  function handleEditItem(item: LineItemForm) {
    setEditingItemId(item.id)
    setNewItemTitle(item.title)
    setNewItemDescription(item.description)
    setNewItemQuantity(item.quantity)
    setNewItemIsDays(item.is_days)
    setNewItemStart(item.timeline_start)
    setNewItemEnd(item.timeline_end)
  }

  function handleRemoveItem(id: string) {
    setLineItems((prev) => prev.filter((item) => item.id !== id))
    if (editingItemId === id) clearLineItemForm()
  }

  function handleResetPaymentSchedule() {
    setPaymentMilestones(
      DEFAULT_PAYMENT_SCHEDULE.map((m) => ({
        id: crypto.randomUUID(),
        label: m.label,
        percentage: m.percentage,
        due_date: m.label === 'On completion' && endDate ? endDate : '',
      }))
    )
  }

  function handleAddPaymentMilestone() {
    setPaymentMilestones((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: '',
        percentage: 0,
        due_date: '',
      },
    ])
  }

  function handleUpdatePaymentMilestone(
    id: string,
    patch: Partial<Omit<PaymentMilestoneForm, 'id'>>
  ) {
    setPaymentMilestones((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    )
  }

  function handleRemovePaymentMilestone(id: string) {
    setPaymentMilestones((prev) => prev.filter((m) => m.id !== id))
  }

  const paymentPercentageTotal = useMemo(
    () => paymentMilestones.reduce((sum, m) => sum + (Number(m.percentage) || 0), 0),
    [paymentMilestones]
  )

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
    if (dayRateOverrideInput.trim() && dayRateOverride == null) {
      toast.error('Quoted day rate must be greater than 0')
      return
    }
    if (currency === 'USD' && !(parseFloat(fxRateInput) > 0)) {
      toast.error('Enter a valid USD exchange rate (units per £1)')
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
        show_payment_schedule: showPaymentSchedule,
        start_date: startDate || null,
        end_date: endDate || null,
        day_rate_override_gbp: dayRateOverride,
        currency,
        fx_rate: fxRate,
        notes: notes.trim() || null,
        monday_project_id: mondayProjectId,
        push_to_monday: isNew && pushToMonday && !hasMondayLink,
        payment_milestones: paymentMilestones.map((m) => ({
          label: m.label,
          percentage: Number(m.percentage),
          due_date: m.due_date || null,
        })),
        line_items: lineItems.map((item) => ({
          title: item.title,
          description: item.description.trim() || null,
          quantity: item.quantity,
          is_days: item.is_days,
          timeline_start: item.timeline_start || null,
          timeline_end: item.timeline_end || null,
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
          } else if (pushToMonday && !hasMondayLink) {
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
          if (pushToMonday && !hasMondayLink) {
            const pushResult = await pushSowToMonday(sowId)
            if (pushResult.error) {
              toast.warning('SoW saved but could not push to Monday', {
                description: pushResult.error,
              })
            } else {
              toast.success('Statement of work saved and pushed to Leads board')
            }
          } else {
            toast.success('Statement of work saved')
          }
          await loadDocument(sowId)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateMonday() {
    if (!sowId || !hasMondayLink) return
    setUpdatingMonday(true)
    try {
      // Persist latest edits first so Monday gets current values
      if (!isReadOnly) {
        const payload = {
          title: title.trim(),
          client_name: resolvedClientName,
          agency_name: isPartnerWork ? resolvedAgencyName : null,
          customer_type: customerType,
          include_vat: includeVat,
          show_quoted_hours: showQuotedHours,
          show_payment_schedule: showPaymentSchedule,
          start_date: startDate || null,
          end_date: endDate || null,
          day_rate_override_gbp: dayRateOverride,
          currency,
          fx_rate: fxRate,
          notes: notes.trim() || null,
          monday_project_id: mondayProjectId,
          push_to_monday: false,
          payment_milestones: paymentMilestones.map((m) => ({
            label: m.label,
            percentage: Number(m.percentage),
            due_date: m.due_date || null,
          })),
          line_items: lineItems.map((item) => ({
            title: item.title,
            description: item.description.trim() || null,
            quantity: item.quantity,
            is_days: item.is_days,
            timeline_start: item.timeline_start || null,
            timeline_end: item.timeline_end || null,
          })),
        }
        const saveResult = await updateSowDocument(sowId, payload)
        if (saveResult.error) {
          toast.error('Save SoW before updating Monday', { description: saveResult.error })
          return
        }
      }

      const result = await updateSowOnMonday(sowId)
      if (result.error) {
        toast.error('Could not update Monday', { description: result.error })
      } else {
        toast.success(result.message || 'Monday item updated')
        await loadDocument(sowId)
      }
    } finally {
      setUpdatingMonday(false)
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
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={clientApproval.tone === 'destructive' ? 'destructive' : 'secondary'}
                  className={cn(approvalBadgeClass(clientApproval.tone))}
                >
                  {clientApproval.label}
                </Badge>
                <span className="text-sm text-muted-foreground">{clientApproval.description}</span>
              </div>
              {document.rejection_notes && (
                <p className="text-sm text-muted-foreground border rounded-md p-2 bg-muted/50 max-w-xl">
                  {document.rejection_notes}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
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
          {hasMondayLink && !isReadOnly && (
            <Button
              variant="outline"
              onClick={handleUpdateMonday}
              disabled={updatingMonday || saving}
            >
              {updatingMonday ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Update Monday
            </Button>
          )}
          {!isReadOnly && (
            <Button onClick={handleSave} disabled={saving || updatingMonday}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isNew ? 'Create SoW' : 'Save changes'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Tabs
            value={editorTab}
            onValueChange={(v) =>
              setEditorTab(v as 'details' | 'deliverables' | 'payment' | 'rates')
            }
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="details">Project</TabsTrigger>
              <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
              <TabsTrigger value="payment">Payment</TabsTrigger>
              <TabsTrigger value="rates">Rates</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-6 mt-6">
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
                    <Tabs
                      value={customerType}
                      onValueChange={(v) => handleCustomerTypeChange(v as 'partner' | 'client')}
                    >
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
                      <Select
                        value={agencyName}
                        onValueChange={handleAgencyChange}
                        disabled={isReadOnly}
                      >
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
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="sow-start">Project start</Label>
                      <Input
                        id="sow-start"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        disabled={isReadOnly}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sow-end">Project end</Label>
                      <Input
                        id="sow-end"
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        disabled={isReadOnly}
                      />
                      <p className="text-xs text-muted-foreground">
                        Pushed to Monday as the lead due date when present
                      </p>
                    </div>
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
                      <p className="text-xs text-muted-foreground">
                        Shown on totals and client share view
                      </p>
                    </div>
                    <Switch
                      id="sow-vat"
                      checked={includeVat}
                      onCheckedChange={setIncludeVat}
                      disabled={isReadOnly}
                    />
                  </div>
                  {!hasMondayLink && !isReadOnly && (
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <Label htmlFor="sow-push-monday">Push to Leads board</Label>
                        <p className="text-xs text-muted-foreground">
                          {isNew
                            ? 'Create a new item on the Leads board when this SoW is saved'
                            : 'Create a new item on the Leads board when you save changes'}
                        </p>
                      </div>
                      <Switch
                        id="sow-push-monday"
                        checked={pushToMonday}
                        onCheckedChange={setPushToMonday}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="deliverables" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Line items</CardTitle>
                  <CardDescription>Tasks with time, cost, and optional Monday timelines</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {lineItems.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Task</TableHead>
                          <TableHead className="text-right">Time</TableHead>
                          <TableHead>Timeline</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          {!isReadOnly && <TableHead className="w-20" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lineItems.map((item) => {
                          const hours = item.is_days
                            ? item.quantity * (currentRate?.hours_per_day || 6)
                            : item.quantity
                          const cost = hours * hourlyRate
                          return (
                            <TableRow
                              key={item.id}
                              className={cn(editingItemId === item.id && 'bg-muted/40')}
                            >
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
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                {item.timeline_start || item.timeline_end
                                  ? `${item.timeline_start || '—'} → ${item.timeline_end || '—'}`
                                  : '—'}
                              </TableCell>
                              <TableCell className="text-right">{formatMoney(cost)}</TableCell>
                              {!isReadOnly && (
                                <TableCell>
                                  <div className="flex items-center justify-end gap-0.5">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleEditItem(item)}
                                      title="Edit"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleRemoveItem(item.id)}
                                      title="Remove"
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </div>
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
                      <div className="flex items-center justify-between gap-2">
                        <Label>{editingItemId ? 'Edit line item' : 'Add line item'}</Label>
                        {editingItemId && (
                          <Button type="button" variant="ghost" size="sm" onClick={clearLineItemForm}>
                            Cancel edit
                          </Button>
                        )}
                      </div>
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
                          {editingItemId ? (
                            <>
                              <Check className="mr-1 h-4 w-4" />
                              Update
                            </>
                          ) : (
                            <>
                              <Plus className="mr-1 h-4 w-4" />
                              Add
                            </>
                          )}
                        </Button>
                      </div>
                      <Textarea
                        placeholder="Description (optional)"
                        value={newItemDescription}
                        onChange={(e) => setNewItemDescription(e.target.value)}
                        rows={2}
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Timeline start</Label>
                          <Input
                            type="date"
                            value={newItemStart}
                            onChange={(e) => setNewItemStart(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Timeline end</Label>
                          <Input
                            type="date"
                            value={newItemEnd}
                            onChange={(e) => setNewItemEnd(e.target.value)}
                          />
                        </div>
                      </div>
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
            </TabsContent>

            <TabsContent value="payment" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Payment schedule</CardTitle>
                  <CardDescription>
                    Default is 50% up front and 50% on completion — adjust splits and dates as needed
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <Label htmlFor="sow-show-payment">Show payment schedule on share view</Label>
                      <p className="text-xs text-muted-foreground">
                        Clients see payment milestones and amounts when enabled
                      </p>
                    </div>
                    <Switch
                      id="sow-show-payment"
                      checked={showPaymentSchedule}
                      onCheckedChange={setShowPaymentSchedule}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div className="space-y-3">
                    {paymentMilestones.map((milestone) => {
                      const amount = (preview.total * (Number(milestone.percentage) || 0)) / 100
                      return (
                        <div
                          key={milestone.id}
                          className="grid gap-3 rounded-lg border p-3 sm:grid-cols-12 sm:items-end"
                        >
                          <div className="space-y-2 sm:col-span-4">
                            <Label>Label</Label>
                            <Input
                              value={milestone.label}
                              onChange={(e) =>
                                handleUpdatePaymentMilestone(milestone.id, { label: e.target.value })
                              }
                              disabled={isReadOnly}
                              placeholder="e.g. Up front"
                            />
                          </div>
                          <div className="space-y-2 sm:col-span-2">
                            <Label>%</Label>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={milestone.percentage || ''}
                              onChange={(e) =>
                                handleUpdatePaymentMilestone(milestone.id, {
                                  percentage: parseFloat(e.target.value) || 0,
                                })
                              }
                              disabled={isReadOnly}
                            />
                          </div>
                          <div className="space-y-2 sm:col-span-3">
                            <Label>Due date</Label>
                            <Input
                              type="date"
                              value={milestone.due_date}
                              onChange={(e) =>
                                handleUpdatePaymentMilestone(milestone.id, {
                                  due_date: e.target.value,
                                })
                              }
                              disabled={isReadOnly}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2 sm:col-span-3">
                            <span className="text-sm text-muted-foreground">
                              {formatMoney(amount)}
                            </span>
                            {!isReadOnly && paymentMilestones.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemovePaymentMilestone(milestone.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p
                      className={cn(
                        'text-sm',
                        Math.abs(paymentPercentageTotal - 100) > 0.05
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      )}
                    >
                      Total {paymentPercentageTotal.toFixed(1)}%
                      {Math.abs(paymentPercentageTotal - 100) > 0.05 && ' (must equal 100%)'}
                    </p>
                    {!isReadOnly && (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleResetPaymentSchedule}
                        >
                          Reset to 50/50
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleAddPaymentMilestone}
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Add milestone
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="rates" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Rates</CardTitle>
                  <CardDescription>
                    Override the quoted day rate for this SoW. Deliverables stay as true effort;
                    the client share view scales hours when enabled. Monday always gets true hours.
                    Pricing stays in GBP; choose USD to convert share-view money via FX.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Standard day rate</Label>
                      <Input
                        value={
                          currentRate
                            ? `${formatMoney(baseDayRate)} / day (${hoursPerDay}h)`
                            : 'Loading…'
                        }
                        disabled
                      />
                      <p className="text-xs text-muted-foreground">
                        From quote rates for {isPartnerWork ? 'partner' : 'client'} work
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sow-quoted-rate">Quoted day rate (GBP)</Label>
                      <Input
                        id="sow-quoted-rate"
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder={baseDayRate ? String(baseDayRate) : 'e.g. 500'}
                        value={dayRateOverrideInput}
                        onChange={(e) => setDayRateOverrideInput(e.target.value)}
                        disabled={isReadOnly}
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave blank to use the standard rate with no hour scaling
                        {matchedPartyRate &&
                        dayRateOverride != null &&
                        Math.abs(dayRateOverride - matchedPartyRate.rate) < 0.005
                          ? ` · From ${matchedPartyRate.label} rate in Settings`
                          : matchedPartyRate
                            ? ` · Settings has ${formatMoney(matchedPartyRate.rate)}/day for ${matchedPartyRate.label}`
                            : ''}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Share currency</Label>
                      <Select
                        value={currency}
                        onValueChange={(v) => {
                          const next = v as SowCurrency
                          setCurrency(next)
                          if (next === 'GBP') setFxRateInput('1')
                          else if (!fxRateInput || fxRateInput === '1') void fetchCurrentFxRate(next)
                        }}
                        disabled={isReadOnly}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GBP">GBP (£)</SelectItem>
                          <SelectItem value="USD">USD ($)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sow-fx-rate">FX rate (per £1)</Label>
                      <div className="flex gap-2">
                        <Input
                          id="sow-fx-rate"
                          type="number"
                          min={0}
                          step={0.000001}
                          value={fxRateInput}
                          onChange={(e) => setFxRateInput(e.target.value)}
                          disabled={isReadOnly || currency === 'GBP'}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fetchCurrentFxRate()}
                          disabled={isReadOnly || currency === 'GBP' || fetchingFx}
                        >
                          {fetchingFx ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Current rate'
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {currency === 'GBP'
                          ? 'GBP SoWs always use a rate of 1'
                          : 'How many USD equal £1. Fetched from ECB via Frankfurter, or enter manually.'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border p-4 space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Multiplier</span>
                      <span className="font-medium">{rateMultiplier.toFixed(3)}×</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">True hours (deliverables / Monday)</span>
                      <span>{preview.hours.toFixed(1)}h</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Quoted hours (share view)</span>
                      <span>{quotedHours.toFixed(1)}h</span>
                    </div>
                    <div className="flex justify-between gap-4 pt-2 border-t">
                      <span className="text-muted-foreground">Total (GBP)</span>
                      <span>{formatMoney(preview.total)}</span>
                    </div>
                    {currency !== 'GBP' && (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Total ({currency})</span>
                        <span className="font-medium">
                          {formatSowMoney(preview.total, currency, fxRate)}
                        </span>
                      </div>
                    )}
                    {dayRateOverride != null && rateMultiplier !== 1 && (
                      <p className="text-xs text-muted-foreground pt-1 border-t">
                        Totals stay based on true effort × standard rate, which matches quoted hours
                        × {formatMoney(dayRateOverride)}/day.
                      </p>
                    )}
                  </div>

                  {dayRateOverrideInput.trim() && dayRateOverride == null && (
                    <p className="text-sm text-destructive">Enter a day rate greater than 0</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
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
              {currency !== 'GBP' && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Total ({currency})</span>
                  <span>{formatSowMoney(preview.total, currency, fxRate)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground pt-1">
                <span>Total hours (true)</span>
                <span>{preview.hours.toFixed(1)}h</span>
              </div>
              {rateMultiplier !== 1 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Quoted hours</span>
                  <span>{quotedHours.toFixed(1)}h</span>
                </div>
              )}
              {currentRate && (
                <p className="text-xs text-muted-foreground pt-2">
                  {dayRateOverride != null && rateMultiplier !== 1
                    ? `Rate: ${formatMoney(dayRateOverride)}/day quoted · ${formatMoney(baseDayRate)} base (${hoursPerDay}h)`
                    : `Rate: ${formatMoney(baseDayRate)}/day (${hoursPerDay}h)`}
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
