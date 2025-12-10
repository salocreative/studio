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
import { Plus, Trash2, Edit2, Loader2, Calculator } from 'lucide-react'
import { getQuoteRates, getQuoteRateByType, type QuoteRate } from '@/app/actions/quote-rates'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface QuoteItem {
  id: string
  title: string
  hours: number
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

  const quoteTotal = useMemo(() => {
    if (!hourlyRate) return 0
    const totalHours = quoteItems.reduce((sum, item) => sum + item.hours, 0)
    return totalHours * hourlyRate
  }, [quoteItems, hourlyRate])

  const totalHours = useMemo(() => {
    return quoteItems.reduce((sum, item) => sum + item.hours, 0)
  }, [quoteItems])

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
      toast.error('Hours must be greater than 0')
      return
    }

    const newItem: QuoteItem = {
      id: Date.now().toString(),
      title: newItemTitle.trim(),
      hours: newItemHours,
    }

    setQuoteItems([...quoteItems, newItem])
    setNewItemTitle('')
    setNewItemHours(0)
    toast.success('Item added to quote')
  }

  function handleStartEdit(item: QuoteItem) {
    setEditingItemId(item.id)
    setEditingTitle(item.title)
    setEditingHours(item.hours)
  }

  function handleSaveEdit() {
    if (!editingItemId) return
    if (!editingTitle.trim()) {
      toast.error('Please enter an item title')
      return
    }
    if (editingHours <= 0) {
      toast.error('Hours must be greater than 0')
      return
    }

    setQuoteItems(items =>
      items.map(item =>
        item.id === editingItemId
          ? { ...item, title: editingTitle.trim(), hours: editingHours }
          : item
      )
    )

    setEditingItemId(null)
    setEditingTitle('')
    setEditingHours(0)
    toast.success('Item updated')
  }

  function handleCancelEdit() {
    setEditingItemId(null)
    setEditingTitle('')
    setEditingHours(0)
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
                        <Label htmlFor="new-item-hours">Hours</Label>
                        <Input
                          id="new-item-hours"
                          type="number"
                          step="0.5"
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
                        const itemCost = item.hours * hourlyRate

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
                                    <Label htmlFor={`edit-hours-${item.id}`}>Hours</Label>
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
                                    <span>{item.hours}h</span>
                                    <span>×</span>
                                    <span>£{hourlyRate.toFixed(2)}/h</span>
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
                    <div className="border-t pt-3 mt-3">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-semibold">Total Quote</span>
                        <span className="text-2xl font-bold text-primary">
                          £{quoteTotal.toFixed(2)}
                        </span>
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
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

