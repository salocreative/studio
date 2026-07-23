'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getSowAgencies, getSowClients } from '@/app/actions/sow'
import {
  deleteSowPartyRate,
  getSowPartyRates,
  upsertSowPartyRate,
  type SowPartyCurrency,
  type SowPartyRate,
  type SowPartyType,
} from '@/app/actions/sow-party-rates'

function formatMoney(value: number) {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function SowPartyRatesForm() {
  const [rates, setRates] = useState<SowPartyRate[]>([])
  const [agencies, setAgencies] = useState<string[]>([])
  const [clients, setClients] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [partyType, setPartyType] = useState<SowPartyType>('agency')
  const [selectedName, setSelectedName] = useState('')
  const [dayRate, setDayRate] = useState('')
  const [currency, setCurrency] = useState<SowPartyCurrency>('GBP')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [ratesResult, agenciesResult, clientsResult] = await Promise.all([
        getSowPartyRates(),
        getSowAgencies(),
        getSowClients(),
      ])
      if (ratesResult.error) {
        toast.error('Error loading party rates', { description: ratesResult.error })
      } else if (ratesResult.rates) {
        setRates(ratesResult.rates)
      }
      if (agenciesResult.success && agenciesResult.agencies) {
        setAgencies(agenciesResult.agencies)
      }
      if (clientsResult.success && clientsResult.clients) {
        setClients(clientsResult.clients)
      }
    } finally {
      setLoading(false)
    }
  }

  const nameOptions = partyType === 'agency' ? agencies : clients
  const configuredNames = new Set(
    rates.filter((r) => r.party_type === partyType).map((r) => r.name)
  )
  const availableNames = nameOptions.filter((name) => !configuredNames.has(name))

  async function handleAdd() {
    const name = selectedName.trim()
    const rate = parseFloat(dayRate)
    if (!name) {
      toast.error('Select an agency or client')
      return
    }
    if (!(rate > 0)) {
      toast.error('Enter a day rate greater than 0')
      return
    }

    setSaving(true)
    try {
      const result = await upsertSowPartyRate({
        party_type: partyType,
        name,
        day_rate_gbp: rate,
        currency,
      })
      if (result.error) {
        toast.error('Could not save rate', { description: result.error })
      } else {
        toast.success('Party rate saved')
        setSelectedName('')
        setDayRate('')
        setCurrency('GBP')
        await loadAll()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const result = await deleteSowPartyRate(id)
      if (result.error) {
        toast.error('Could not delete rate', { description: result.error })
      } else {
        toast.success('Party rate removed')
        await loadAll()
      }
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4 space-y-4">
        <div className="space-y-2">
          <Label>Party type</Label>
          <Tabs
            value={partyType}
            onValueChange={(v) => {
              setPartyType(v as SowPartyType)
              setSelectedName('')
            }}
          >
            <TabsList className="grid w-full grid-cols-2 max-w-sm">
              <TabsTrigger value="agency">Agency</TabsTrigger>
              <TabsTrigger value="client">End client</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <div className="space-y-2 sm:col-span-1">
            <Label>{partyType === 'agency' ? 'Agency' : 'End client'}</Label>
            <Select value={selectedName} onValueChange={setSelectedName}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    availableNames.length
                      ? `Select ${partyType === 'agency' ? 'agency' : 'client'}`
                      : 'No names left to add'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="party-day-rate">Day rate (£)</Label>
            <Input
              id="party-day-rate"
              type="number"
              min={0}
              step={0.01}
              placeholder="e.g. 500"
              value={dayRate}
              onChange={(e) => setDayRate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Share currency</Label>
            <Select
              value={currency}
              onValueChange={(v) => setCurrency(v as SowPartyCurrency)}
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
          <Button onClick={handleAdd} disabled={saving || !selectedName}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add rate
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Day rates are always stored in GBP. Share currency is the default for SoWs with this
          party (amounts convert via FX on the Rates tab).
        </p>
      </div>

      {rates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No party rates configured yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Day rate (GBP)</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((rate) => (
              <TableRow key={rate.id}>
                <TableCell className="capitalize text-muted-foreground">
                  {rate.party_type === 'agency' ? 'Agency' : 'End client'}
                </TableCell>
                <TableCell className="font-medium">{rate.name}</TableCell>
                <TableCell className="text-right">
                  {formatMoney(Number(rate.day_rate_gbp))}
                </TableCell>
                <TableCell>{rate.currency || 'GBP'}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(rate.id)}
                    disabled={deletingId === rate.id}
                    title="Remove"
                  >
                    {deletingId === rate.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
