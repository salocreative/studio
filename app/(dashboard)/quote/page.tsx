'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, Trash2, Edit2, Loader2, Calculator, Upload } from 'lucide-react'
import { getQuoteRates, getQuoteRateByType, type QuoteRate } from '@/app/actions/quote-rates'
import { createQuoteToMonday } from '@/app/actions/quote-to-monday'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface QuoteItem {
  id: string
  title: string
  hours: number
  isDays: boolean // Track if this item was entered as days
}

export default function QuotePage() {
  const [customerType, setCustomerType] = useState<'partner' | 'client'>('client')
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([])
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingHours, setEditingHours] = useState<number>(0)
  const [quoteRates, setQuoteRates] = useState<QuoteRate[]>([])
  const [loading, setLoading] = useState(true)
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemHours, setNewItemHours] = useState<number>(0)
  const [newItemIsDays, setNewItemIsDays] = useState<boolean>(false)
  const [editingIsDays, setEditingIsDays] = useState<boolean>(false)
  const [includeVAT, setIncludeVAT] = useState<boolean>(false)
  const [showPushDialog, setShowPushDialog] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')
  const [pushingToMonday, setPushingToMonday] = useState(false)
  const VAT_RATE = 0.20 // 20% VAT

  useEffect(() => {
    loadQuoteRates()
  }, [])

  async function loadQuoteRates() {
    setLoading(true)
    try {
      const result = await getQuoteRates()
      if (result.error) {
        if (result.error.includes('table not found') || result.error.includes('migration')) {
          toast.error('Database Setup Required', { 
            description: 'Please run migration 016_add_quote_rates.sql in Supabase Dashboard → SQL Editor.',
            duration: 10000
          })
        } else {
          toast.error('Error loading quote rates', { description: result.error })
        }
      } else if (result.rates) {
        setQuoteRates(result.rates)
      }
    } catch (error) {
      console.error('Error loading quote rates:', error)
      toast.error('Failed to load quote rates')
    } finally {
      setLoading(false)
    }
  }

  const currentRate = useMemo(() => {
    return quoteRates.find(rate => rate.customer_type === customerType)
  }, [quoteRates, customerType])

  const hourlyRate = useMemo(() => {
    if (!currentRate || currentRate.hours_per_day === 0) return 0
    return currentRate.day_rate_gbp / currentRate.hours_per_day
  }, [currentRate])

  const quoteSubtotal = useMemo(() => {
    if (!hourlyRate || !currentRate) return 0
    return quoteItems.reduce((sum, item) => {
      // If item was entered as days, use day rate, otherwise use hourly rate
      const itemHours = item.isDays ? item.hours * currentRate.hours_per_day : item.hours
      return sum + (itemHours * hourlyRate)
    }, 0)
  }, [quoteItems, hourlyRate, currentRate])

  const vatAmount = useMemo(() => {
    return includeVAT ? quoteSubtotal * VAT_RATE : 0
  }, [quoteSubtotal, includeVAT, VAT_RATE])

  const quoteTotal = useMemo(() => {
    return quoteSubtotal + vatAmount
  }, [quoteSubtotal, vatAmount])

  const totalHours = useMemo(() => {
    if (!currentRate) return 0
    return quoteItems.reduce((sum, item) => {
      // If item was entered as days, convert to hours
      return sum + (item.isDays ? item.hours * currentRate.hours_per_day : item.hours)
    }, 0)
  }, [quoteItems, currentRate])

  const totalDays = useMemo(() => {
    if (!currentRate || currentRate.hours_per_day === 0) return 0
    return totalHours / currentRate.hours_per_day
  }, [totalHours, currentRate])

  function handleAddItem() {
    if (!newItemTitle.trim()) {
      toast.error('Please enter an item title')
      return
    }
    if (newItemHours <= 0) {
      toast.error(newItemIsDays ? 'Days must be greater than 0' : 'Hours must be greater than 0')
      return
    }

    const newItem: QuoteItem = {
      id: Date.now().toString(),
      title: newItemTitle.trim(),
      hours: newItemHours,
      isDays: newItemIsDays,
    }

    setQuoteItems([...quoteItems, newItem])
    setNewItemTitle('')
    setNewItemHours(0)
    setNewItemIsDays(false)
    toast.success('Item added to quote')
  }

  function handleStartEdit(item: QuoteItem) {
    setEditingItemId(item.id)
    setEditingTitle(item.title)
    setEditingHours(item.hours)
    setEditingIsDays(item.isDays)
  }

  function handleSaveEdit() {
    if (!editingItemId) return
    if (!editingTitle.trim()) {
      toast.error('Please enter an item title')
      return
    }
    if (editingHours <= 0) {
      toast.error(editingIsDays ? 'Days must be greater than 0' : 'Hours must be greater than 0')
      return
    }

    setQuoteItems(items =>
      items.map(item =>
        item.id === editingItemId
          ? { ...item, title: editingTitle.trim(), hours: editingHours, isDays: editingIsDays }
          : item
      )
    )

    setEditingItemId(null)
    setEditingTitle('')
    setEditingHours(0)
    setEditingIsDays(false)
    toast.success('Item updated')
  }

  function handleCancelEdit() {
    setEditingItemId(null)
    setEditingTitle('')
    setEditingHours(0)
    setEditingIsDays(false)
  }

  function handleDeleteItem(id: string) {
    setQuoteItems(items => items.filter(item => item.id !== id))
    toast.success('Item removed')
  }

  function handleClearQuote() {
    if (quoteItems.length === 0) return
    if (!confirm('Are you sure you want to clear all items from this quote?')) {
      return
    }
    setQuoteItems([])
    toast.success('Quote cleared')
  }

  async function handlePushToMonday() {
    if (quoteItems.length === 0) {
      toast.error('Please add items to the quote before pushing to Monday.com')
      return
    }

    if (!projectTitle.trim()) {
      toast.error('Please enter a project title')
      return
    }

    setPushingToMonday(true)
    try {
      const result = await createQuoteToMonday({
        projectTitle: projectTitle.trim(),
        customerType,
        items: quoteItems.map(item => ({
          title: item.title,
          hours: item.hours,
          isDays: item.isDays,
        })),
        subtotal: quoteSubtotal,
      })

      if (result.error) {
        toast.error('Error pushing to Monday.com', { description: result.error })
      } else {
        toast.success(result.message || 'Quote pushed to Monday.com successfully')
        setShowPushDialog(false)
        setProjectTitle('')
      }
    } catch (error) {
      console.error('Error pushing quote to Monday.com:', error)
      toast.error('Failed to push quote to Monday.com', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setPushingToMonday(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b bg-background">
          <div className="flex h-16 items-center px-6">
            <div>
              <h1 className="text-2xl font-semibold">Quote</h1>
              <p className="text-sm text-muted-foreground">
                Build and calculate project quotes
              </p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    )
  }

  if (!currentRate) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b bg-background">
          <div className="flex h-16 items-center px-6">
            <div>
              <h1 className="text-2xl font-semibold">Quote</h1>
              <p className="text-sm text-muted-foreground">
                Build and calculate project quotes
              </p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive">Quote Rates Not Configured</CardTitle>
              <CardDescription>
                Quote rates need to be set up before using the quoting tool.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                  <p className="text-sm font-medium mb-2">To enable quoting, please:</p>
                  <ol className="text-sm list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Run the migration: <code className="bg-muted px-1 rounded">supabase/migrations/016_add_quote_rates.sql</code></li>
                    <li>Configure rates in Settings → Quote Rates</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Quote</h1>
            <p className="text-sm text-muted-foreground">
              Build and calculate project quotes
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Customer Type Toggle */}
          <Card>
            <CardHeader>
              <CardTitle>Customer Type</CardTitle>
              <CardDescription>
                Select the customer type to apply the appropriate day rate
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={customerType} onValueChange={(value) => setCustomerType(value as 'partner' | 'client')}>
                <TabsList className="grid w-full max-w-md grid-cols-2">
                  <TabsTrigger value="partner">
                    Partner
                    {quoteRates.find(r => r.customer_type === 'partner') && (
                      <Badge variant="secondary" className="ml-2">
                        £{quoteRates.find(r => r.customer_type === 'partner')?.day_rate_gbp.toFixed(0)}/day
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="client">
                    Client
                    {quoteRates.find(r => r.customer_type === 'client') && (
                      <Badge variant="secondary" className="ml-2">
                        £{quoteRates.find(r => r.customer_type === 'client')?.day_rate_gbp.toFixed(0)}/day
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Day Rate</p>
                    <p className="font-semibold">£{currentRate.day_rate_gbp.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Hours/Day</p>
                    <p className="font-semibold">{currentRate.hours_per_day}h</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Hourly Rate</p>
                    <p className="font-semibold">£{hourlyRate.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Customer Type</p>
                    <p className="font-semibold capitalize">{customerType}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quote Items */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Quote Items</CardTitle>
                      <CardDescription>
                        Add items to build your quote
                      </CardDescription>
                    </div>
                    {quoteItems.length > 0 && (
                      <Button variant="outline" size="sm" onClick={handleClearQuote}>
                        Clear All
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Add New Item */}
                  <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <h3 className="font-medium">Add Item</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <Label htmlFor="new-item-title">Title</Label>
                        <Input
                          id="new-item-title"
                          placeholder="e.g., Design mockups, Development"
                          value={newItemTitle}
                          onChange={(e) => setNewItemTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleAddItem()
                            }
                          }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="new-item-hours">{newItemIsDays ? 'Days' : 'Hours'}</Label>
                        <Input
                          id="new-item-hours"
                          type="number"
                          step={newItemIsDays ? "0.5" : "0.5"}
                          min="0"
                          placeholder="0"
                          value={newItemHours || ''}
                          onChange={(e) => setNewItemHours(parseFloat(e.target.value) || 0)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleAddItem()
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="new-item-days-toggle"
                        checked={newItemIsDays}
                        onCheckedChange={setNewItemIsDays}
                      />
                      <Label htmlFor="new-item-days-toggle" className="cursor-pointer">
                        Quote in days instead of hours
                      </Label>
                    </div>
                    <Button onClick={handleAddItem} className="w-full">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Item
                    </Button>
                  </div>

                  {/* Quote Items List */}
                  {quoteItems.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Calculator className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No items in quote yet</p>
                      <p className="text-sm mt-1">Add items above to build your quote</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {quoteItems.map((item) => {
                        const isEditing = editingItemId === item.id
                        // Calculate item cost: if days, use day rate, otherwise hourly
                        const itemHours = item.isDays ? item.hours * (currentRate?.hours_per_day || 6) : item.hours
                        const itemCost = itemHours * hourlyRate

                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "p-4 border rounded-lg",
                              isEditing && "border-primary bg-primary/5"
                            )}
                          >
                            {isEditing ? (
                              <div className="space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div className="md:col-span-2">
                                    <Label htmlFor={`edit-title-${item.id}`}>Title</Label>
                                    <Input
                                      id={`edit-title-${item.id}`}
                                      value={editingTitle}
                                      onChange={(e) => setEditingTitle(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          handleSaveEdit()
                                        } else if (e.key === 'Escape') {
                                          handleCancelEdit()
                                        }
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`edit-hours-${item.id}`}>{editingIsDays ? 'Days' : 'Hours'}</Label>
                                    <Input
                                      id={`edit-hours-${item.id}`}
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      value={editingHours || ''}
                                      onChange={(e) => setEditingHours(parseFloat(e.target.value) || 0)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          handleSaveEdit()
                                        } else if (e.key === 'Escape') {
                                          handleCancelEdit()
                                        }
                                      }}
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Switch
                                    id={`edit-days-toggle-${item.id}`}
                                    checked={editingIsDays}
                                    onCheckedChange={setEditingIsDays}
                                  />
                                  <Label htmlFor={`edit-days-toggle-${item.id}`} className="cursor-pointer text-sm">
                                    Quote in days instead of hours
                                  </Label>
                                </div>
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={handleSaveEdit}>
                                    Save
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <h4 className="font-medium">{item.title}</h4>
                                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                                    <span>
                                      {item.isDays ? (
                                        <>{item.hours} day{item.hours !== 1 ? 's' : ''} ({itemHours.toFixed(1)}h)</>
                                      ) : (
                                        <>{item.hours}h</>
                                      )}
                                    </span>
                                    {!item.isDays && (
                                      <>
                                        <span>×</span>
                                        <span>£{hourlyRate.toFixed(2)}/h</span>
                                      </>
                                    )}
                                    {item.isDays && currentRate && (
                                      <>
                                        <span>×</span>
                                        <span>£{currentRate.day_rate_gbp.toFixed(2)}/day</span>
                                      </>
                                    )}
                                    <span>=</span>
                                    <span className="font-semibold text-foreground">£{itemCost.toFixed(2)}</span>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleStartEdit(item)}
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteItem(item.id)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Quote Summary */}
            <div className="space-y-6">
              <Card className="sticky top-6">
                <CardHeader>
                  <CardTitle>Quote Summary</CardTitle>
                  <CardDescription>
                    Total quote calculation
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Hours</span>
                      <span className="font-medium">{totalHours.toFixed(1)}h</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Days</span>
                      <span className="font-medium">{totalDays.toFixed(1)} days</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Hourly Rate</span>
                      <span className="font-medium">£{hourlyRate.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Items</span>
                      <span className="font-medium">{quoteItems.length}</span>
                    </div>
                    <div className="border-t pt-3 mt-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Subtotal</span>
                        <span className="text-lg font-semibold">
                          £{quoteSubtotal.toFixed(2)}
                        </span>
                      </div>
                      
                      {/* VAT Toggle */}
                      <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="vat-toggle"
                            checked={includeVAT}
                            onCheckedChange={setIncludeVAT}
                          />
                          <Label htmlFor="vat-toggle" className="cursor-pointer text-sm">
                            Include VAT (20%)
                          </Label>
                        </div>
                      </div>

                      {includeVAT && (
                        <div className="flex justify-between text-sm text-muted-foreground">
                          <span>VAT (20%)</span>
                          <span>£{vatAmount.toFixed(2)}</span>
                        </div>
                      )}

                      <div className="border-t pt-3 mt-2">
                        <div className="flex justify-between items-center">
                          <span className="text-lg font-semibold">Total Quote</span>
                          <span className="text-2xl font-bold text-primary">
                            £{quoteTotal.toFixed(2)}
                          </span>
                        </div>
                        {includeVAT && (
                          <p className="text-xs text-muted-foreground mt-1">Including VAT</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {quoteItems.length > 0 && (
                    <div className="pt-4 border-t space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Based on {customerType} rate: £{currentRate.day_rate_gbp.toFixed(2)}/day
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ({currentRate.hours_per_day}h per day)
                      </p>
                    </div>
                  )}

                  {quoteItems.length > 0 && (
                    <div className="pt-4 border-t">
                      <Button
                        onClick={() => setShowPushDialog(true)}
                        className="w-full"
                        variant="default"
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Push to Monday.com
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Push to Monday.com Dialog */}
      <Dialog open={showPushDialog} onOpenChange={setShowPushDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Push Quote to Monday.com</DialogTitle>
            <DialogDescription>
              This will create a new project in the Leads board with subtasks for each quote item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="project-title">Project Title *</Label>
              <Input
                id="project-title"
                placeholder="e.g., Website Redesign, Brand Identity"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && projectTitle.trim() && !pushingToMonday) {
                    handlePushToMonday()
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                This will be the name of the project in Monday.com
              </p>
            </div>
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <p className="text-sm font-medium">What will be created:</p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>1 project item: "{projectTitle || '[Project Title]'}"</li>
                <li>{quoteItems.length} subtask{quoteItems.length !== 1 ? 's' : ''} with quoted hours</li>
                <li>Board: Leads board (configured in Settings)</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowPushDialog(false)
                setProjectTitle('')
              }}
              disabled={pushingToMonday}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePushToMonday}
              disabled={!projectTitle.trim() || pushingToMonday || quoteItems.length === 0}
            >
              {pushingToMonday ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Pushing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Push to Monday.com
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

