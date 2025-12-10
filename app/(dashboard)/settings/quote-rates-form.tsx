'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { getQuoteRates, updateQuoteRate, type QuoteRate } from '@/app/actions/quote-rates'

export function QuoteRatesForm() {
  const [rates, setRates] = useState<QuoteRate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form state for each rate
  const [partnerDayRate, setPartnerDayRate] = useState<number>(670)
  const [partnerHoursPerDay, setPartnerHoursPerDay] = useState<number>(6)
  const [clientDayRate, setClientDayRate] = useState<number>(720)
  const [clientHoursPerDay, setClientHoursPerDay] = useState<number>(6)

  useEffect(() => {
    loadRates()
  }, [])

  async function loadRates() {
    setLoading(true)
    try {
      const result = await getQuoteRates()
      if (result.error) {
        setError(result.error)
        if (result.error.includes('table not found') || result.error.includes('migration')) {
          toast.error('Database Setup Required', { 
            description: 'Please run migration 016_add_quote_rates.sql in Supabase Dashboard → SQL Editor.',
            duration: 10000
          })
        } else {
          toast.error('Error loading quote rates', { description: result.error })
        }
      } else {
        setError(null)
        if (result.rates) {
          setRates(result.rates)
          
          // Update form state with loaded rates
          const partnerRate = result.rates.find(r => r.customer_type === 'partner')
          const clientRate = result.rates.find(r => r.customer_type === 'client')
          
          if (partnerRate) {
            setPartnerDayRate(partnerRate.day_rate_gbp)
            setPartnerHoursPerDay(partnerRate.hours_per_day)
          }
          if (clientRate) {
            setClientDayRate(clientRate.day_rate_gbp)
            setClientHoursPerDay(clientRate.hours_per_day)
          }
        }
      }
    } catch (error) {
      toast.error('Error loading quote rates', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(customerType: 'partner' | 'client') {
    setSaving(customerType)
    try {
      const dayRate = customerType === 'partner' ? partnerDayRate : clientDayRate
      const hoursPerDay = customerType === 'partner' ? partnerHoursPerDay : clientHoursPerDay

      const result = await updateQuoteRate(customerType, dayRate, hoursPerDay)
      if (result.error) {
        toast.error('Error updating quote rate', { description: result.error })
      } else {
        toast.success(`${customerType === 'partner' ? 'Partner' : 'Client'} rate updated successfully`)
        await loadRates()
      }
    } catch (error) {
      toast.error('Error updating quote rate', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && error.includes('table not found')) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Database Setup Required</CardTitle>
          <CardDescription>
            The quote rates table has not been created yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <p className="text-sm font-medium mb-2">To enable quote rates, please run the migration:</p>
              <ol className="text-sm list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Go to Supabase Dashboard</li>
                <li>Go to SQL Editor</li>
                <li>Open the migration file: <code className="bg-muted px-1 rounded">supabase/migrations/016_add_quote_rates.sql</code></li>
                <li>Copy and paste the SQL into the SQL Editor</li>
                <li>Click &quot;Run&quot; to execute the migration</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const partnerHourlyRate = partnerHoursPerDay > 0 ? partnerDayRate / partnerHoursPerDay : 0
  const clientHourlyRate = clientHoursPerDay > 0 ? clientDayRate / clientHoursPerDay : 0

  return (
    <div className="space-y-6">
      {/* Partner Rate */}
      <Card>
        <CardHeader>
          <CardTitle>Partner Rate</CardTitle>
          <CardDescription>
            Day rate and hours per day for partner customers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="partner-day-rate">Day Rate (£)</Label>
              <Input
                id="partner-day-rate"
                type="number"
                step="0.01"
                min="0"
                value={partnerDayRate}
                onChange={(e) => setPartnerDayRate(parseFloat(e.target.value) || 0)}
                disabled={saving === 'partner'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner-hours-per-day">Hours Per Day</Label>
              <Input
                id="partner-hours-per-day"
                type="number"
                step="0.5"
                min="0"
                value={partnerHoursPerDay}
                onChange={(e) => setPartnerHoursPerDay(parseFloat(e.target.value) || 0)}
                disabled={saving === 'partner'}
              />
            </div>
          </div>
          
          <div className="p-4 bg-muted/50 rounded-lg">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Calculated Hourly Rate</span>
              <span className="font-semibold">£{partnerHourlyRate.toFixed(2)}/hour</span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button 
              onClick={() => handleSave('partner')} 
              disabled={saving === 'partner' || partnerDayRate <= 0 || partnerHoursPerDay <= 0}
            >
              {saving === 'partner' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Partner Rate
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Client Rate */}
      <Card>
        <CardHeader>
          <CardTitle>Client Rate</CardTitle>
          <CardDescription>
            Day rate and hours per day for client customers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="client-day-rate">Day Rate (£)</Label>
              <Input
                id="client-day-rate"
                type="number"
                step="0.01"
                min="0"
                value={clientDayRate}
                onChange={(e) => setClientDayRate(parseFloat(e.target.value) || 0)}
                disabled={saving === 'client'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-hours-per-day">Hours Per Day</Label>
              <Input
                id="client-hours-per-day"
                type="number"
                step="0.5"
                min="0"
                value={clientHoursPerDay}
                onChange={(e) => setClientHoursPerDay(parseFloat(e.target.value) || 0)}
                disabled={saving === 'client'}
              />
            </div>
          </div>
          
          <div className="p-4 bg-muted/50 rounded-lg">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Calculated Hourly Rate</span>
              <span className="font-semibold">£{clientHourlyRate.toFixed(2)}/hour</span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button 
              onClick={() => handleSave('client')} 
              disabled={saving === 'client' || clientDayRate <= 0 || clientHoursPerDay <= 0}
            >
              {saving === 'client' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Client Rate
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

