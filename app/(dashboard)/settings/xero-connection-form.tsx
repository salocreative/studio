'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { getXeroStatus, disconnectXero, getXeroAuthUrlAction } from '@/app/actions/xero'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function XeroConnectionFormContent() {
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [status, setStatus] = useState<{
    connected: boolean
    tenantName?: string
    isExpired?: boolean
  } | null>(null)
  const searchParams = useSearchParams()

  useEffect(() => {
    loadStatus()
    
    // Check for OAuth callback results
    const connected = searchParams?.get('xero_connected')
    const error = searchParams?.get('xero_error')
    
    if (connected === 'true') {
      toast.success('Successfully connected to Xero!')
      loadStatus()
      // Clean up URL
      window.history.replaceState({}, '', '/settings')
    }
    
    if (error) {
      const errorMessages: Record<string, string> = {
        'unauthorized': 'You must be an admin to connect Xero',
        'config_missing': 'Xero credentials not configured. Please set XERO_CLIENT_ID and XERO_CLIENT_SECRET environment variables.',
        'token_exchange_failed': 'Failed to authenticate with Xero. Please try again.',
        'missing_access_token': 'Xero did not return an access token. Please try again.',
        'missing_refresh_token': 'Xero did not return a refresh token. Please ensure your Xero app is configured correctly and try again.',
        'tenant_fetch_failed': 'Failed to retrieve Xero organization information.',
        'invalid_tenant': 'Invalid Xero organization information received.',
        'no_tenants': 'No Xero organizations found. Please ensure you have access to at least one organization.',
        'insert_failed': 'Failed to save Xero connection to database. Please check server logs.',
        'update_failed': 'Failed to update Xero connection. Please check server logs.',
        'unknown': 'An error occurred while connecting to Xero. Please try again.',
      }
      
      // Get error details from URL if present
      const errorDetails = searchParams?.get('details')
      const errorMessage = errorMessages[error] || 'An unknown error occurred'
      const fullMessage = errorDetails ? `${errorMessage} Error: ${errorDetails}` : errorMessage
      
      toast.error('Xero Connection Error', { 
        description: fullMessage 
      })
      console.error('Xero connection error:', error, errorDetails)
      window.history.replaceState({}, '', '/settings')
    }
  }, [searchParams])

  async function loadStatus() {
    setLoading(true)
    try {
      const result = await getXeroStatus()
      if (result.error) {
        toast.error('Error loading Xero status', { description: result.error })
      } else {
        setStatus({
          connected: result.connected || false,
          tenantName: result.tenantName,
          isExpired: result.isExpired,
        })
      }
    } catch (error) {
      toast.error('Error loading Xero status')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  async function handleConnect() {
    setConnecting(true)
    try {
      const result = await getXeroAuthUrlAction()
      if (result.error) {
        toast.error('Error connecting to Xero', { description: result.error })
        setConnecting(false)
      } else if (result.authUrl) {
        // Redirect to Xero OAuth
        window.location.href = result.authUrl
        // Don't set connecting to false - we're redirecting
      }
    } catch (error) {
      toast.error('Error connecting to Xero')
      console.error(error)
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect Xero? This will remove all stored credentials.')) {
      return
    }

    setDisconnecting(true)
    try {
      const result = await disconnectXero()
      if (result.error) {
        toast.error('Error disconnecting Xero', { description: result.error })
      } else {
        toast.success('Xero disconnected successfully')
        await loadStatus()
      }
    } catch (error) {
      toast.error('Error disconnecting Xero')
      console.error(error)
    } finally {
      setDisconnecting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {status?.connected ? (
        <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-900">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                <CardTitle>Connected to Xero</CardTitle>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  'Disconnect'
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>
                <span className="text-sm font-medium">Organization:</span>
                <span className="ml-2 text-sm text-muted-foreground">
                  {status.tenantName || 'Unknown'}
                </span>
              </div>
              {status.isExpired && (
                <div className="flex items-center gap-2 text-sm text-orange-600 dark:text-orange-400">
                  <AlertCircle className="h-4 w-4" />
                  <span>Connection expired. Please reconnect.</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Connect to Xero</CardTitle>
            <CardDescription>
              Connect your Xero account to import financial data for forecasting. This will allow
              you to see real revenue, expenses, and profit data in the Forecast page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full sm:w-auto"
            >
              {connecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Connect to Xero
                </>
              )}
            </Button>
            <p className="mt-4 text-sm text-muted-foreground">
              You'll be redirected to Xero to authorize the connection. Only admins can connect
              Xero accounts.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function XeroConnectionForm() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <XeroConnectionFormContent />
    </Suspense>
  )
}

