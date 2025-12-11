'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, X, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getLeadsStatusConfig, updateLeadsStatusConfig } from '@/app/actions/leads-status-config'

export function LeadsStatusConfigForm() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [includedStatuses, setIncludedStatuses] = useState<string[]>([])
  const [excludedStatuses, setExcludedStatuses] = useState<string[]>([])
  const [newIncludedStatus, setNewIncludedStatus] = useState('')
  const [newExcludedStatus, setNewExcludedStatus] = useState('')

  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig() {
    setLoading(true)
    try {
      const result = await getLeadsStatusConfig()
      if (result.error) {
        toast.error('Error loading status config', { description: result.error })
      } else {
        setIncludedStatuses(result.includedStatuses || [])
        setExcludedStatuses(result.excludedStatuses || [])
      }
    } catch (error) {
      console.error('Error loading status config:', error)
      toast.error('Failed to load status config')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const result = await updateLeadsStatusConfig(includedStatuses, excludedStatuses)
      if (result.error) {
        toast.error('Error saving status config', { description: result.error })
      } else {
        toast.success('Status configuration saved')
      }
    } catch (error) {
      console.error('Error saving status config:', error)
      toast.error('Failed to save status config')
    } finally {
      setSaving(false)
    }
  }

  function addIncludedStatus() {
    const status = newIncludedStatus.trim()
    if (status && !includedStatuses.includes(status)) {
      setIncludedStatuses([...includedStatuses, status])
      setNewIncludedStatus('')
    }
  }

  function removeIncludedStatus(status: string) {
    setIncludedStatuses(includedStatuses.filter(s => s !== status))
  }

  function addExcludedStatus() {
    const status = newExcludedStatus.trim()
    if (status && !excludedStatuses.includes(status)) {
      setExcludedStatuses([...excludedStatuses, status])
      setNewExcludedStatus('')
    }
  }

  function removeExcludedStatus(status: string) {
    setExcludedStatuses(excludedStatuses.filter(s => s !== status))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          Configure which lead statuses to include or exclude from the Monthly Summary forecast.
          Use "Included Statuses" to only show specific statuses, or "Excluded Statuses" to hide specific ones (like "Stuck" or "Blocked").
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          <strong>Note:</strong> If you set included statuses, only leads with those statuses will be shown. If you set excluded statuses, leads with those statuses will be hidden. If both are empty, all leads will be shown.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Included Statuses</CardTitle>
          <CardDescription>
            Only leads with these statuses will be included in Monthly Summary. Leave empty to include all (unless excluded).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newIncludedStatus}
              onChange={(e) => setNewIncludedStatus(e.target.value)}
              placeholder="Enter status name (e.g., 'Active', 'In Progress')"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addIncludedStatus()
                }
              }}
            />
            <Button onClick={addIncludedStatus} disabled={!newIncludedStatus.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>
          {includedStatuses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {includedStatuses.map((status) => (
                <Badge key={status} variant="default" className="flex items-center gap-1">
                  {status}
                  <button
                    onClick={() => removeIncludedStatus(status)}
                    className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {includedStatuses.length === 0 && (
            <p className="text-sm text-muted-foreground">No included statuses. All statuses will be shown (unless excluded).</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Excluded Statuses</CardTitle>
          <CardDescription>
            Leads with these statuses will be excluded from Monthly Summary (e.g., "Stuck", "Blocked").
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newExcludedStatus}
              onChange={(e) => setNewExcludedStatus(e.target.value)}
              placeholder="Enter status name (e.g., 'Stuck', 'Blocked')"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addExcludedStatus()
                }
              }}
            />
            <Button onClick={addExcludedStatus} disabled={!newExcludedStatus.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>
          {excludedStatuses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {excludedStatuses.map((status) => (
                <Badge key={status} variant="destructive" className="flex items-center gap-1">
                  {status}
                  <button
                    onClick={() => removeExcludedStatus(status)}
                    className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {excludedStatuses.length === 0 && (
            <p className="text-sm text-muted-foreground">No excluded statuses.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Configuration'
          )}
        </Button>
      </div>
    </div>
  )
}

