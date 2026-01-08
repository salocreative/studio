'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
import { syncScorecardRecentWeeks } from '@/app/actions/scorecard'
import { toast } from 'sonner'

export function ScorecardSyncForm() {
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<{
    success: boolean
    weeksSynced?: number
    totalEntriesSynced?: number
    errors?: string[]
  } | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setLastSync(null)

    try {
      const result = await syncScorecardRecentWeeks(3)

      if (result.error) {
        toast.error('Sync failed', {
          description: result.error,
        })
        setLastSync({
          success: false,
        })
      } else {
        const message = `Synced ${result.totalEntriesSynced || 0} entries across ${result.weeksSynced || 0} weeks`
        toast.success('Sync completed', {
          description: message,
        })

        setLastSync({
          success: true,
          weeksSynced: result.weeksSynced,
          totalEntriesSynced: result.totalEntriesSynced,
          errors: result.errors,
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      toast.error('Sync failed', {
        description: errorMessage,
      })
      setLastSync({
        success: false,
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scorecard Data Sync</CardTitle>
        <CardDescription>
          Manually sync scorecard data for the last 3 weeks. Automated metrics will be calculated and saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Manual Sync</p>
            <p className="text-xs text-muted-foreground">
              Calculates and saves automated metrics for the past 3 weeks. This helps capture any recent changes to source data.
            </p>
          </div>
          <Button
            onClick={handleSync}
            disabled={syncing}
            variant="outline"
          >
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Now
              </>
            )}
          </Button>
        </div>

        {lastSync && (
          <div className={`rounded-lg border p-4 ${
            lastSync.success
              ? 'border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-900'
              : 'border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-900'
          }`}>
            <div className="flex items-start gap-2">
              {lastSync.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
              )}
              <div className="flex-1 space-y-1">
                <p className={`text-sm font-medium ${
                  lastSync.success
                    ? 'text-green-900 dark:text-green-100'
                    : 'text-red-900 dark:text-red-100'
                }`}>
                  {lastSync.success ? 'Sync Completed Successfully' : 'Sync Failed'}
                </p>
                {lastSync.success && (
                  <div className="text-xs space-y-1">
                    <p className={lastSync.success ? 'text-green-700 dark:text-green-300' : ''}>
                      Synced {lastSync.totalEntriesSynced || 0} entries across {lastSync.weeksSynced || 0} weeks
                    </p>
                    {lastSync.errors && lastSync.errors.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="font-medium">Some metrics had errors:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          {lastSync.errors.map((error, idx) => (
                            <li key={idx} className="text-red-600 dark:text-red-400">{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-900 p-4">
          <p className="text-sm font-medium mb-2">Automatic Sync</p>
          <p className="text-xs text-muted-foreground">
            Scorecard data is automatically synced every Sunday evening at 8:00 PM UTC for the last 3 weeks.
            This ensures any late updates to source data are captured.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

