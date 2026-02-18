'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { getSyncSettings, updateSyncSettings, type SyncSettings } from '@/app/actions/sync-settings'
import { format } from 'date-fns'

export function AutomaticSyncForm() {
  const [settings, setSettings] = useState<SyncSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    try {
      const result = await getSyncSettings()
      if (result.error) {
        setError(result.error)
        if (result.error.includes('table not found') || result.error.includes('migration')) {
          toast.error('Database Setup Required', { 
            description: 'Please run migration 015_add_monday_sync_settings.sql in Supabase Dashboard → SQL Editor.',
            duration: 10000
          })
        } else {
          toast.error('Error loading sync settings', { description: result.error })
        }
      } else {
        setError(null)
        if (result.settings) {
          setSettings(result.settings)
          setEnabled(result.settings.enabled)
          setIntervalMinutes(result.settings.interval_minutes)
        }
      }
    } catch (error) {
      toast.error('Error loading sync settings', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (intervalMinutes < 1 || intervalMinutes > 1440) {
      toast.error('Interval must be between 1 and 1440 minutes (24 hours)')
      return
    }

    setSaving(true)
    try {
      const result = await updateSyncSettings(enabled, intervalMinutes)
      if (result.error) {
        toast.error('Error updating sync settings', { description: result.error })
      } else {
        toast.success('Sync settings updated successfully')
        await loadSettings()
      }
    } catch (error) {
      toast.error('Error updating sync settings', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
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
            The sync settings table has not been created yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <p className="text-sm font-medium mb-2">To enable automatic sync, please run the migration:</p>
              <ol className="text-sm list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Go to Supabase Dashboard</li>
                <li>Go to SQL Editor</li>
                <li>Open the migration file: <code className="bg-muted px-1 rounded">supabase/migrations/015_add_monday_sync_settings.sql</code></li>
                <li>Copy and paste the SQL into the SQL Editor</li>
                <li>Click &quot;Run&quot; to execute the migration</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Convert minutes to human-readable format
  const getIntervalDisplay = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`
    } else if (minutes < 1440) {
      const hours = Math.floor(minutes / 60)
      const remainingMinutes = minutes % 60
      if (remainingMinutes === 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}`
      }
      return `${hours}h ${remainingMinutes}m`
    } else {
      const days = Math.floor(minutes / 1440)
      return `${days} day${days !== 1 ? 's' : ''}`
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="sync-enabled" className="text-base">Enable Automatic Sync</Label>
          <p className="text-sm text-muted-foreground">
            Automatically sync projects and tasks from Monday.com on a schedule
          </p>
        </div>
        <Switch
          id="sync-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={saving}
        />
      </div>

      {enabled && (
        <div className="space-y-4 pl-6 border-l-2">
          <div className="space-y-2">
            <Label htmlFor="sync-interval">Sync Interval (minutes)</Label>
            <Input
              id="sync-interval"
              type="number"
              min={1}
              max={1440}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 60)}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              How often to sync (1-1440 minutes). Current setting: {getIntervalDisplay(intervalMinutes)}
            </p>
          </div>

          {settings && (
            <div className="space-y-2 text-sm">
              {settings.last_sync_at && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last sync:</span>
                  <span className="font-medium">
                    {format(new Date(settings.last_sync_at), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
              )}
              {settings.next_sync_at && enabled && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Next sync:</span>
                  <span className="font-medium">
                    {format(new Date(settings.next_sync_at), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-900 p-4">
            <p className="text-sm font-medium mb-2">How automatic sync runs</p>
            <p className="text-xs text-muted-foreground mb-2">
              On Vercel, a cron job runs every 30 minutes. When it runs, sync executes only if at least {getIntervalDisplay(intervalMinutes)} have passed since the last sync.
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              To use an external cron (e.g. EasyCron) instead, call this URL with a GET request and header <code className="bg-background border rounded px-1">X-Cron-Secret: your_secret_key</code>. Set <code className="bg-background border rounded px-1">CRON_SECRET</code> in your environment to match.
            </p>
            <code className="text-xs bg-background border rounded px-2 py-1 block break-all mt-1">
              {typeof window !== 'undefined' ? `${window.location.origin}/api/sync/cron` : 'https://your-domain.com/api/sync/cron'}
            </code>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

