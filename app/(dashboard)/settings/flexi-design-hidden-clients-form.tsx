'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getFlexiDesignClients,
  setFlexiDesignClientHidden,
} from '@/app/actions/flexi-design'

interface FlexiClientVisibilityRow {
  id: string
  client_name: string
  total_projects: number
  is_hidden?: boolean
}

export function FlexiDesignHiddenClientsForm() {
  const [clients, setClients] = useState<FlexiClientVisibilityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingName, setTogglingName] = useState<string | null>(null)

  useEffect(() => {
    void loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    try {
      const result = await getFlexiDesignClients({ includeHidden: true })
      if (result.error) {
        toast.error('Error loading Flexi-Design clients', { description: result.error })
        return
      }
      setClients(
        (result.clients || []).map((client) => ({
          id: client.id,
          client_name: client.client_name,
          total_projects: client.total_projects,
          is_hidden: Boolean(client.is_hidden),
        }))
      )
    } catch (error) {
      console.error('Error loading Flexi-Design clients for visibility:', error)
      toast.error('Failed to load Flexi-Design clients')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggle(client: FlexiClientVisibilityRow, isHidden: boolean) {
    setTogglingName(client.client_name)
    const previous = clients
    setClients((current) =>
      current.map((row) =>
        row.client_name === client.client_name ? { ...row, is_hidden: isHidden } : row
      )
    )

    try {
      const result = await setFlexiDesignClientHidden(client.client_name, isHidden)
      if (result.error) {
        setClients(previous)
        toast.error('Error updating visibility', { description: result.error })
        return
      }
      toast.success(
        isHidden ? `${client.client_name} hidden from Clients` : `${client.client_name} restored`
      )
    } catch (error) {
      setClients(previous)
      console.error('Error toggling Flexi-Design client visibility:', error)
      toast.error('Failed to update visibility')
    } finally {
      setTogglingName(null)
    }
  }

  const hiddenCount = clients.filter((client) => client.is_hidden).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Flexi-Design client visibility</CardTitle>
        <CardDescription>
          Hide clients you no longer work with from the Flexi-Design Clients list. History and share
          links stay intact.
          {hiddenCount > 0 ? ` ${hiddenCount} currently hidden.` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading clients…
          </div>
        ) : clients.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No Flexi-Design clients found yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="w-28">Projects</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-28 text-right">Hidden</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => {
                const isHidden = Boolean(client.is_hidden)
                return (
                  <TableRow key={client.client_name} className={isHidden ? 'opacity-70' : undefined}>
                    <TableCell className="font-medium">{client.client_name}</TableCell>
                    <TableCell>{client.total_projects}</TableCell>
                    <TableCell>
                      <Badge variant={isHidden ? 'secondary' : 'default'}>
                        {isHidden ? 'Hidden' : 'Visible'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <Switch
                          id={`hide-${client.client_name}`}
                          checked={isHidden}
                          disabled={togglingName === client.client_name}
                          onCheckedChange={(checked) => void handleToggle(client, checked)}
                          aria-label={`Hide ${client.client_name}`}
                        />
                        <Label
                          htmlFor={`hide-${client.client_name}`}
                          className="sr-only"
                        >
                          Hide {client.client_name}
                        </Label>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
