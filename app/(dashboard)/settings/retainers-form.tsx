'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Trash2, Loader2, Edit2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getRetainerClients,
  addRetainerClient,
  removeRetainerClient,
  updateRetainerClient,
  getAvailableClients,
  type RetainerClient,
} from '@/app/actions/retainers'

export function RetainersForm() {
  const [retainerClients, setRetainerClients] = useState<RetainerClient[]>([])
  const [availableClients, setAvailableClients] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [selectedClient, setSelectedClient] = useState<string>('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [editingClient, setEditingClient] = useState<RetainerClient | null>(null)
  const [monthlyHours, setMonthlyHours] = useState<string>('')
  const [rolloverHours, setRolloverHours] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    loadRetainers()
    loadAvailableClients()
  }, [])

  async function loadRetainers() {
    setLoading(true)
    try {
      const result = await getRetainerClients()
      if (result.error) {
        toast.error('Error loading retainers', { description: result.error })
      } else if (result.success && result.clients) {
        setRetainerClients(result.clients)
      }
    } catch (error) {
      console.error('Error loading retainers:', error)
      toast.error('Failed to load retainers')
    } finally {
      setLoading(false)
    }
  }

  async function loadAvailableClients() {
    setLoadingAvailable(true)
    try {
      const result = await getAvailableClients()
      if (result.error) {
        console.error('Error loading available clients:', result.error)
      } else if (result.success && result.clients) {
        setAvailableClients(result.clients)
      }
    } catch (error) {
      console.error('Error loading available clients:', error)
    } finally {
      setLoadingAvailable(false)
    }
  }

  async function handleAdd() {
    if (!selectedClient) {
      toast.error('Please select a client')
      return
    }

    setAdding(true)
    try {
      const result = await addRetainerClient(selectedClient)
      if (result.error) {
        toast.error('Error adding retainer', { description: result.error })
      } else {
        toast.success('Retainer client added successfully')
        setSelectedClient('')
        await loadRetainers()
        await loadAvailableClients() // Refresh to update available clients
      }
    } catch (error) {
      console.error('Error adding retainer:', error)
      toast.error('Failed to add retainer client')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(clientId: string, clientName: string) {
    if (!confirm(`Are you sure you want to remove "${clientName}" from retainers?`)) {
      return
    }

    setRemoving(clientId)
    try {
      const result = await removeRetainerClient(clientId)
      if (result.error) {
        toast.error('Error removing retainer', { description: result.error })
      } else {
        toast.success('Retainer client removed successfully')
        await loadRetainers()
        await loadAvailableClients() // Refresh to update available clients
      }
    } catch (error) {
      console.error('Error removing retainer:', error)
      toast.error('Failed to remove retainer client')
    } finally {
      setRemoving(null)
    }
  }

  function handleEdit(client: RetainerClient) {
    setEditingClient(client)
    setMonthlyHours(client.monthly_hours?.toString() || '')
    setRolloverHours(client.rollover_hours?.toString() || '')
    setStartDate(client.start_date || '')
  }

  function handleCloseEdit() {
    setEditingClient(null)
    setMonthlyHours('')
    setRolloverHours('')
    setStartDate('')
  }

  async function handleUpdate() {
    if (!editingClient) return

    setUpdating(true)
    try {
      const result = await updateRetainerClient(
        editingClient.id,
        monthlyHours ? parseFloat(monthlyHours) : null,
        rolloverHours ? parseFloat(rolloverHours) : null,
        startDate || null
      )
      if (result.error) {
        toast.error('Error updating retainer', { description: result.error })
      } else {
        toast.success('Retainer client updated successfully')
        handleCloseEdit()
        await loadRetainers()
      }
    } catch (error) {
      console.error('Error updating retainer:', error)
      toast.error('Failed to update retainer client')
    } finally {
      setUpdating(false)
    }
  }

  // Filter out clients that are already retainers
  const availableToAdd = availableClients.filter(
    client => !retainerClients.some(rc => rc.client_name === client)
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retainer Clients</CardTitle>
        <CardDescription>
          Manage which clients are tracked as retainers. Retainer clients will appear on the
          Retainers page with monthly project breakdowns and time tracking.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Client Form */}
        <div className="flex gap-2">
          <Select
            value={selectedClient}
            onValueChange={setSelectedClient}
            disabled={adding || loadingAvailable}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select a client to add as retainer" />
            </SelectTrigger>
            <SelectContent>
              {loadingAvailable ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading clients...</div>
              ) : availableToAdd.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">No available clients to add</div>
              ) : (
                availableToAdd.map((client) => (
                  <SelectItem key={client} value={client}>
                    {client}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} disabled={!selectedClient || adding || loadingAvailable}>
            {adding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add
              </>
            )}
          </Button>
        </div>

        {/* Retainer Clients List */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : retainerClients.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No retainer clients configured. Add a client above to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client Name</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {retainerClients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.client_name}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(client)}
                        className="h-8 w-8"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemove(client.id, client.client_name)}
                        disabled={removing === client.id}
                        className="text-destructive hover:text-destructive h-8 w-8"
                      >
                        {removing === client.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Edit Dialog */}
      <Dialog open={!!editingClient} onOpenChange={(open) => !open && handleCloseEdit()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Retainer Settings</DialogTitle>
            <DialogDescription>
              Configure monthly hours, rollover hours, and start date for {editingClient?.client_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="monthly-hours">Monthly Hours</Label>
              <Input
                id="monthly-hours"
                type="number"
                step="0.01"
                min="0"
                value={monthlyHours}
                onChange={(e) => setMonthlyHours(e.target.value)}
                placeholder="e.g. 20"
              />
              <p className="text-xs text-muted-foreground">
                Agreed number of hours per month for this retainer
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rollover-hours">Rollover Hours</Label>
              <Input
                id="rollover-hours"
                type="number"
                step="0.01"
                min="0"
                value={rolloverHours}
                onChange={(e) => setRolloverHours(e.target.value)}
                placeholder="e.g. 5"
              />
              <p className="text-xs text-muted-foreground">
                Number of hours that can roll over to the next month
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Retainer start date. Project data before this date will be excluded.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseEdit} disabled={updating}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updating}>
              {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

