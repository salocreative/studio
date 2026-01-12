'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Users, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { getRetainerClients, type RetainerClient } from '@/app/actions/retainers'

export default function RetainersPageClient() {
  const router = useRouter()
  const [clients, setClients] = useState<RetainerClient[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    try {
      const result = await getRetainerClients()
      if (result.error) {
        toast.error('Error loading retainers', { description: result.error })
      } else if (result.success && result.clients) {
        setClients(result.clients)
      }
    } catch (error) {
      console.error('Error loading retainers:', error)
      toast.error('Failed to load retainers')
    } finally {
      setLoading(false)
    }
  }

  function handleClientClick(clientId: string, clientName: string) {
    router.push(`/retainers/${encodeURIComponent(clientName)}`)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Retainers</h1>
            <p className="text-sm text-muted-foreground">
              View monthly project breakdowns and time tracking for retainer clients
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : clients.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">No retainer clients</p>
                <p className="text-sm text-muted-foreground text-center mb-4">
                  Add retainer clients in Settings to get started.
                </p>
                <Button onClick={() => router.push('/settings')}>
                  Go to Settings
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clients.map((client) => (
                <Card
                  key={client.id}
                  className="hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => handleClientClick(client.id, client.client_name)}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      {client.client_name}
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>
                      Click to view monthly project breakdowns and time tracking
                    </CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

