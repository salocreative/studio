'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getLifetimeValueBrackets, updateLifetimeValueBrackets, type LifetimeValueBrackets } from '@/app/actions/customers'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

export function LifetimeValueBracketsForm() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [brackets, setBrackets] = useState<LifetimeValueBrackets>({
    low: { min: 1, max: 4999.99 },
    medium: { min: 5000, max: 9999.99 },
    high: { min: 10000, max: null },
  })

  useEffect(() => {
    loadBrackets()
  }, [])

  async function loadBrackets() {
    setLoading(true)
    try {
      const result = await getLifetimeValueBrackets()
      if (result.error) {
        toast.error('Error loading brackets', { description: result.error })
      } else if (result.brackets) {
        setBrackets(result.brackets)
      }
    } catch (error) {
      console.error('Error loading brackets:', error)
      toast.error('Error loading brackets')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Validate brackets
      if (brackets.low.max === null || brackets.medium.max === null) {
        toast.error('Low and Medium brackets must have a maximum value')
        return
      }

      if (brackets.low.min >= brackets.low.max!) {
        toast.error('Low bracket minimum must be less than maximum')
        return
      }

      if (brackets.medium.min >= brackets.medium.max!) {
        toast.error('Medium bracket minimum must be less than maximum')
        return
      }

      if (brackets.high.min < brackets.medium.max!) {
        toast.error('High bracket minimum must be greater than or equal to medium bracket maximum')
        return
      }

      if (brackets.low.max! >= brackets.medium.min) {
        toast.error('Low bracket maximum must be less than medium bracket minimum')
        return
      }

      const result = await updateLifetimeValueBrackets(brackets)
      if (result.error) {
        toast.error('Error updating brackets', { description: result.error })
      } else {
        toast.success('Lifetime value brackets updated successfully')
      }
    } catch (error) {
      console.error('Error saving brackets:', error)
      toast.error('Error saving brackets')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lifetime Value Brackets</CardTitle>
          <CardDescription>Configure the value ranges for customer lifetime value categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifetime Value Brackets</CardTitle>
        <CardDescription>
          Configure the value ranges for customer lifetime value categories used in the customer analysis grid.
          These brackets determine how customers are categorized in the grid.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Low Bracket */}
        <div className="space-y-2">
          <Label htmlFor="low-min">Low Value Bracket</Label>
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <Label htmlFor="low-min" className="text-xs text-muted-foreground">Minimum (£)</Label>
              <Input
                id="low-min"
                type="number"
                step="0.01"
                min="0"
                value={brackets.low.min}
                onChange={(e) => {
                  const value = parseFloat(e.target.value) || 0
                  setBrackets({
                    ...brackets,
                    low: { ...brackets.low, min: value },
                  })
                }}
              />
            </div>
            <div className="pt-6">to</div>
            <div className="flex-1">
              <Label htmlFor="low-max" className="text-xs text-muted-foreground">Maximum (£)</Label>
              <Input
                id="low-max"
                type="number"
                step="0.01"
                min="0"
                value={brackets.low.max || ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? null : parseFloat(e.target.value) || 0
                  setBrackets({
                    ...brackets,
                    low: { ...brackets.low, max: value },
                  })
                }}
              />
            </div>
          </div>
        </div>

        {/* Medium Bracket */}
        <div className="space-y-2">
          <Label htmlFor="medium-min">Medium Value Bracket</Label>
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <Label htmlFor="medium-min" className="text-xs text-muted-foreground">Minimum (£)</Label>
              <Input
                id="medium-min"
                type="number"
                step="0.01"
                min="0"
                value={brackets.medium.min}
                onChange={(e) => {
                  const value = parseFloat(e.target.value) || 0
                  setBrackets({
                    ...brackets,
                    medium: { ...brackets.medium, min: value },
                  })
                }}
              />
            </div>
            <div className="pt-6">to</div>
            <div className="flex-1">
              <Label htmlFor="medium-max" className="text-xs text-muted-foreground">Maximum (£)</Label>
              <Input
                id="medium-max"
                type="number"
                step="0.01"
                min="0"
                value={brackets.medium.max || ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? null : parseFloat(e.target.value) || 0
                  setBrackets({
                    ...brackets,
                    medium: { ...brackets.medium, max: value },
                  })
                }}
              />
            </div>
          </div>
        </div>

        {/* High Bracket */}
        <div className="space-y-2">
          <Label htmlFor="high-min">High Value Bracket</Label>
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <Label htmlFor="high-min" className="text-xs text-muted-foreground">Minimum (£)</Label>
              <Input
                id="high-min"
                type="number"
                step="0.01"
                min="0"
                value={brackets.high.min}
                onChange={(e) => {
                  const value = parseFloat(e.target.value) || 0
                  setBrackets({
                    ...brackets,
                    high: { ...brackets.high, min: value },
                  })
                }}
              />
            </div>
            <div className="pt-6">and above</div>
            <div className="flex-1">
              <Label htmlFor="high-max" className="text-xs text-muted-foreground">Maximum (leave empty for unlimited)</Label>
              <Input
                id="high-max"
                type="number"
                step="0.01"
                min="0"
                value={brackets.high.max || ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? null : parseFloat(e.target.value) || 0
                  setBrackets({
                    ...brackets,
                    high: { ...brackets.high, max: value },
                  })
                }}
                placeholder="Unlimited"
              />
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Brackets
        </Button>
      </CardContent>
    </Card>
  )
}

