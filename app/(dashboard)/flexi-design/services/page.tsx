'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GripVertical, Loader2, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  createFlexiDesignService,
  listFlexiDesignServices,
  reorderFlexiDesignServices,
  setFlexiDesignServiceActive,
  updateFlexiDesignService,
  type FlexiDesignService,
  type FlexiDesignServiceInput,
} from '@/app/actions/flexi-design-services'

function emptyForm(category = ''): FlexiDesignServiceInput {
  return {
    category,
    title: '',
    description: '',
    credit_estimate: 1,
    sort_order: undefined,
    is_active: true,
  }
}

function serviceToForm(service: FlexiDesignService): FlexiDesignServiceInput {
  return {
    category: service.category,
    title: service.title,
    description: service.description,
    credit_estimate: Number(service.credit_estimate),
    sort_order: service.sort_order,
    is_active: service.is_active,
  }
}

function formatCredits(value: number) {
  return Number(value).toLocaleString('en-GB', {
    maximumFractionDigits: 2,
  })
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export default function FlexiDesignServicesPage() {
  const [services, setServices] = useState<FlexiDesignService[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [showInactive, setShowInactive] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FlexiDesignService | null>(null)
  const [form, setForm] = useState<FlexiDesignServiceInput>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)

  useEffect(() => {
    void loadServices(showInactive)
  }, [showInactive])

  async function loadServices(includeInactive: boolean) {
    setLoading(true)
    try {
      const result = await listFlexiDesignServices({ includeInactive })
      if (result.error) {
        toast.error('Error loading services', { description: result.error })
        return
      }
      setServices(result.services || [])
      setCanManage(result.canManage === true)
    } catch (error) {
      console.error('Error loading Flexi-Design services:', error)
      toast.error('Failed to load services')
    } finally {
      setLoading(false)
    }
  }

  const categories = useMemo(() => {
    const set = new Set(services.map((s) => s.category))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [services])

  const grouped = useMemo(() => {
    const filtered =
      categoryFilter === 'all'
        ? services
        : services.filter((s) => s.category === categoryFilter)

    const map = new Map<string, FlexiDesignService[]>()
    for (const service of filtered) {
      const list = map.get(service.category) || []
      list.push(service)
      map.set(service.category, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [services, categoryFilter])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm(categoryFilter === 'all' ? '' : categoryFilter))
    setFormOpen(true)
  }

  function openEdit(service: FlexiDesignService) {
    setEditing(service)
    setForm(serviceToForm(service))
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
    setForm(emptyForm())
  }

  function updateField<K extends keyof FlexiDesignServiceInput>(
    key: K,
    value: FlexiDesignServiceInput[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const result = editing
        ? await updateFlexiDesignService(editing.id, form)
        : await createFlexiDesignService(form)

      if (result.error) {
        toast.error(editing ? 'Error updating service' : 'Error creating service', {
          description: result.error,
        })
        return
      }

      toast.success(editing ? 'Service updated' : 'Service created')
      closeForm()
      await loadServices(showInactive)
    } catch (error) {
      console.error('Error saving Flexi-Design service:', error)
      toast.error('Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(service: FlexiDesignService, isActive: boolean) {
    setTogglingId(service.id)
    const previous = services
    setServices((current) =>
      current.map((item) => (item.id === service.id ? { ...item, is_active: isActive } : item))
    )
    try {
      const result = await setFlexiDesignServiceActive(service.id, isActive)
      if (result.error) {
        setServices(previous)
        toast.error('Error updating status', { description: result.error })
        return
      }
      if (!showInactive && !isActive) {
        setServices((current) => current.filter((item) => item.id !== service.id))
      }
    } catch (error) {
      setServices(previous)
      console.error('Error toggling Flexi-Design service:', error)
      toast.error('Failed to update status')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDrop(category: string, targetId: string) {
    if (!canManage || !draggingId || draggingId === targetId || reordering) {
      setDraggingId(null)
      setDragOverId(null)
      return
    }

    const visibleItems = grouped.find(([name]) => name === category)?.[1] || []
    const fromIndex = visibleItems.findIndex((item) => item.id === draggingId)
    const toIndex = visibleItems.findIndex((item) => item.id === targetId)
    setDraggingId(null)
    setDragOverId(null)

    if (fromIndex < 0 || toIndex < 0) return

    const reorderedVisible = moveItem(visibleItems, fromIndex, toIndex)
    const visibleIds = new Set(reorderedVisible.map((item) => item.id))
    const hiddenInCategory = services
      .filter((item) => item.category === category && !visibleIds.has(item.id))
      .sort((a, b) => a.sort_order - b.sort_order)

    const orderedIds = [
      ...reorderedVisible.map((item) => item.id),
      ...hiddenInCategory.map((item) => item.id),
    ]

    const previous = services
    setServices((current) => {
      const orderMap = new Map(orderedIds.map((id, index) => [id, index + 1]))
      return [...current]
        .map((item) =>
          item.category === category && orderMap.has(item.id)
            ? { ...item, sort_order: orderMap.get(item.id)! }
            : item
        )
        .sort((a, b) => {
          if (a.category !== b.category) return a.category.localeCompare(b.category)
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
          return a.title.localeCompare(b.title)
        })
    })

    setReordering(true)
    try {
      const result = await reorderFlexiDesignServices(category, orderedIds)
      if (result.error) {
        setServices(previous)
        toast.error('Error reordering services', { description: result.error })
      }
    } catch (error) {
      setServices(previous)
      console.error('Error reordering Flexi-Design services:', error)
      toast.error('Failed to reorder services')
    } finally {
      setReordering(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-2xl font-semibold">Services</h1>
            <p className="text-sm text-muted-foreground">
              Flexi-Design deliverables catalog with credit estimates
            </p>
          </div>
          {canManage && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Service
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Deliverables</CardTitle>
              <CardDescription>
                {services.length} service{services.length === 1 ? '' : 's'}
                {showInactive ? ' (including inactive)' : ''}
                {canManage ? ' · Drag rows to reorder within a category' : ''}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canManage && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="show-inactive"
                    checked={showInactive}
                    onCheckedChange={setShowInactive}
                  />
                  <Label htmlFor="show-inactive" className="text-sm font-normal">
                    Show inactive
                  </Label>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading services…
              </div>
            ) : grouped.length === 0 ? (
              <p className="py-12 text-center text-muted-foreground">
                No services found. Run migration 067_flexi_design_services.sql to seed the catalog.
              </p>
            ) : (
              <div className="space-y-8">
                {grouped.map(([category, items]) => (
                  <div key={category} className="space-y-3">
                    <div className="flex items-baseline gap-2 border-b pb-2">
                      <h2 className="text-lg font-semibold">{category}</h2>
                      <span className="text-sm text-muted-foreground">
                        {items.length} deliverable{items.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {canManage && <TableHead className="w-10" />}
                          <TableHead>Title</TableHead>
                          <TableHead className="hidden md:table-cell">Description</TableHead>
                          <TableHead className="w-32 text-right">Est. credits</TableHead>
                          <TableHead className="w-24">Active</TableHead>
                          {canManage && <TableHead className="w-16 text-right" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((service) => (
                          <TableRow
                            key={service.id}
                            className={cn(
                              !service.is_active && 'opacity-60',
                              dragOverId === service.id && 'bg-muted/60',
                              draggingId === service.id && 'opacity-40'
                            )}
                            onDragOver={(event) => {
                              if (!canManage || !draggingId) return
                              event.preventDefault()
                              if (dragOverId !== service.id) setDragOverId(service.id)
                            }}
                            onDrop={(event) => {
                              event.preventDefault()
                              void handleDrop(category, service.id)
                            }}
                          >
                            {canManage && (
                              <TableCell className="w-10 pr-0">
                                <div
                                  draggable={!reordering}
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move'
                                    event.dataTransfer.setData('text/plain', service.id)
                                    setDraggingId(service.id)
                                  }}
                                  onDragEnd={() => {
                                    setDraggingId(null)
                                    setDragOverId(null)
                                  }}
                                  className="inline-flex cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                                  aria-label={`Reorder ${service.title}`}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <GripVertical className="h-4 w-4" />
                                </div>
                              </TableCell>
                            )}
                            <TableCell className="font-medium">
                              <div>{service.title}</div>
                              <div className="mt-1 text-xs text-muted-foreground md:hidden">
                                {service.description}
                              </div>
                            </TableCell>
                            <TableCell className="hidden max-w-xl text-muted-foreground md:table-cell">
                              {service.description}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              ~{formatCredits(service.credit_estimate)}
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={service.is_active}
                                disabled={!canManage || togglingId === service.id}
                                onCheckedChange={(checked) =>
                                  void handleToggleActive(service, checked)
                                }
                                aria-label={`${service.title} active`}
                              />
                            </TableCell>
                            {canManage && (
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEdit(service)}
                                  aria-label={`Edit ${service.title}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={formOpen} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit service' : 'Add service'}</DialogTitle>
            <DialogDescription>
              Deliverables appear in the Services catalog and can later power Inspo and briefing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="service-category">Category</Label>
              <Input
                id="service-category"
                list="service-categories"
                value={form.category}
                onChange={(e) => updateField('category', e.target.value)}
                placeholder="e.g. Social"
              />
              <datalist id="service-categories">
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-title">Title</Label>
              <Input
                id="service-title"
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder="e.g. LinkedIn graphic"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-description">Description</Label>
              <Textarea
                id="service-description"
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                rows={3}
                placeholder="What this deliverable includes"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-credits">Credit estimate</Label>
              <Input
                id="service-credits"
                type="number"
                min={0}
                step={0.5}
                value={form.credit_estimate}
                onChange={(e) => updateField('credit_estimate', Number(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="service-active"
                checked={form.is_active ?? true}
                onCheckedChange={(checked) => updateField('is_active', checked)}
              />
              <Label htmlFor="service-active" className="font-normal">
                Active
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
