'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react'
import { getCustomersWithAnalysis, updateCustomerRelationshipScore, getLifetimeValueBrackets, getUserRelationshipVote, getCustomerRelationshipVotes, type Customer, type LifetimeValueBrackets } from '@/app/actions/customers'
import { toast } from 'sonner'
import { format, startOfYear, endOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, LabelList } from 'recharts'
import CustomerLeaderboardRow from './customer-leaderboard-row'

export default function CustomersPageClient() {
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [brackets, setBrackets] = useState<LifetimeValueBrackets | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [relationshipScore, setRelationshipScore] = useState<number>(5)
  const [updating, setUpdating] = useState(false)
  const [startDate, setStartDate] = useState<string>(format(startOfYear(new Date()), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState<string>(format(endOfDay(new Date()), 'yyyy-MM-dd'))
  const [groupBy, setGroupBy] = useState<'client' | 'agency'>('client')

  useEffect(() => {
    loadData()
  }, [startDate, endDate, groupBy])

  async function loadData() {
    setLoading(true)
    try {
      const [customersResult, bracketsResult] = await Promise.all([
        getCustomersWithAnalysis(startDate, endDate, groupBy),
        getLifetimeValueBrackets(),
      ])

      if (customersResult.error) {
        toast.error('Error loading customers', { description: customersResult.error })
      } else {
        // Sort by average relationship score (descending), then by lifetime value
        const sortedCustomers = (customersResult.customers || []).sort((a, b) => {
          const scoreA = a.relationship_score ?? 0
          const scoreB = b.relationship_score ?? 0
          if (scoreB !== scoreA) {
            return scoreB - scoreA // Higher score first
          }
          // If scores are equal, sort by lifetime value
          return b.lifetime_value - a.lifetime_value
        })
        setCustomers(sortedCustomers)
      }

      if (bracketsResult.error) {
        toast.error('Error loading brackets', { description: bracketsResult.error })
      } else {
        setBrackets(bracketsResult.brackets || null)
      }
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Error loading data')
    } finally {
      setLoading(false)
    }
  }

  // Calculate dynamic value ranges based on actual data
  const valueRanges = useMemo(() => {
    if (!customers.length || !brackets) {
      return { low: { min: 0, max: 0 }, medium: { min: 0, max: 0 }, high: { min: 0, max: 0 } }
    }

    const values = customers.map(c => c.lifetime_value).filter(v => v > 0).sort((a, b) => a - b)
    if (values.length === 0) return { low: { min: 0, max: 0 }, medium: { min: 0, max: 0 }, high: { min: 0, max: 0 } }

    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const totalRange = maxValue - minValue

    // Calculate ranges based on actual data distribution
    const lowMax = brackets.low.max || Math.min(brackets.medium.min, maxValue)
    const mediumMax = brackets.medium.max || Math.min(brackets.high.min, maxValue)
    
    return {
      low: { min: minValue, max: Math.max(minValue, Math.min(lowMax, maxValue)) },
      medium: { min: Math.max(brackets.medium.min, minValue), max: Math.min(mediumMax, maxValue) },
      high: { min: Math.max(brackets.high.min, minValue), max: maxValue },
    }
  }, [customers, brackets])

  // Prepare scatter plot data
  const scatterData = useMemo(() => {
    // Include all customers, default relationship score to 5 if not set
    return customers
      .filter(c => c.lifetime_value > 0) // Only show customers with some value
      .map(customer => ({
        x: customer.lifetime_value, // Value on X-axis
        y: customer.relationship_score !== null ? customer.relationship_score : 5, // Default to 5 if no score
        name: customer.client_name,
        value: customer.lifetime_value,
        score: customer.relationship_score !== null ? customer.relationship_score : 5,
        hasScore: customer.relationship_score !== null,
        projects: customer.project_count,
      }))
  }, [customers])

  function getPointColor(customer: { value: number; score: number }): string {
    // High relationship (7-10) and high value = green (ideal)
    // Low relationship (0-3) and low value = red (drop)
    // Others = neutral
    if (customer.score >= 7 && customer.value >= valueRanges.high.min) {
      return '#22c55e' // green-500
    }
    if (customer.score <= 3 && customer.value <= valueRanges.low.max) {
      return '#ef4444' // red-500
    }
    return '#6b7280' // gray-500
  }

  async function handleCustomerClick(customer: Customer) {
    setSelectedCustomer(customer)
    // Fetch user's current vote
    const voteResult = await getUserRelationshipVote(customer.client_name)
    if (!voteResult.error) {
      setRelationshipScore(voteResult.score ?? customer.relationship_score ?? 5)
    } else {
      setRelationshipScore(customer.relationship_score || 5)
    }
  }

  async function handleUpdateScore() {
    if (!selectedCustomer) return

    setUpdating(true)
    try {
      const result = await updateCustomerRelationshipScore(
        selectedCustomer.client_name,
        relationshipScore
      )

      if (result.error) {
        toast.error('Error updating relationship score', { description: result.error })
      } else {
        toast.success('Relationship score updated')
        setSelectedCustomer(null)
        await loadData()
      }
    } catch (error) {
      console.error('Error updating score:', error)
      toast.error('Error updating relationship score')
    } finally {
      setUpdating(false)
    }
  }

  // Calculate customer categories
  const perfectCustomers = customers.filter(
    c => (c.relationship_score || 0) >= 7 && c.lifetime_value >= valueRanges.high.min
  )
  const idealCustomers = customers.filter(
    c => {
      const score = c.relationship_score || 0
      const value = c.lifetime_value
      return score >= 5 && value >= valueRanges.medium.min && 
        !(score >= 7 && value >= valueRanges.high.min) // Exclude perfect customers
    }
  )
  const notIdealCustomers = customers.filter(
    c => {
      const score = c.relationship_score || 0
      const value = c.lifetime_value
      return value <= valueRanges.low.max && score < 5
    }
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Date Range Picker and Group By Toggle */}
      <Card>
        <CardHeader>
          <CardTitle>Date Range & Grouping</CardTitle>
          <CardDescription>Select the date range and choose to group by clients or agencies</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <Label htmlFor="start-date">Start Date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="end-date">End Date</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <Button
                onClick={() => {
                  const today = new Date()
                  setStartDate(format(startOfYear(today), 'yyyy-MM-dd'))
                  setEndDate(format(endOfDay(today), 'yyyy-MM-dd'))
                }}
                variant="outline"
              >
                Year to Date
              </Button>
            </div>
            <div>
              <Label>Group By</Label>
              <div className="flex gap-2 mt-2">
                <Button
                  type="button"
                  variant={groupBy === 'client' ? 'default' : 'outline'}
                  onClick={() => setGroupBy('client')}
                >
                  Clients
                </Button>
                <Button
                  type="button"
                  variant={groupBy === 'agency' ? 'default' : 'outline'}
                  onClick={() => setGroupBy('agency')}
                >
                  Agencies
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {groupBy === 'agency' 
                  ? 'Projects with "Salo Creative" as agency will be shown as clients instead.'
                  : 'Viewing all projects grouped by client name.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total {groupBy === 'agency' ? 'Agencies' : 'Customers'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{customers.length}</div>
            {customers.length > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                {customers.filter(c => c.relationship_score !== null).length} with scores, {scatterData.length} on chart
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              Perfect Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{perfectCustomers.length}</div>
            <div className="text-xs text-muted-foreground mt-1">
              High value + 7+ relationship
            </div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              Ideal Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{idealCustomers.length}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Medium+ value + 5+ relationship
            </div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
              Not Ideal Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{notIdealCustomers.length}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Low value + &lt;5 relationship
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scatter Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{groupBy === 'agency' ? 'Agency' : 'Customer'} Analysis</CardTitle>
          <CardDescription>
            Click on a {groupBy === 'agency' ? 'agency' : 'customer'} point to update their relationship score. Green points are ideal {groupBy === 'agency' ? 'agencies' : 'customers'} (high relationship, high value). 
            Red points are candidates to consider dropping (low relationship, low value).
            {scatterData.length === 0 && (
              <span className="block mt-2 text-amber-600 dark:text-amber-400">
                No {groupBy === 'agency' ? 'agencies' : 'customers'} found. Try adjusting the date range or ensure projects have values.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scatterData.length === 0 ? (
            <div className="h-[600px] w-full flex items-center justify-center border-2 border-dashed border-muted rounded-lg">
              <div className="text-center text-muted-foreground">
                <p className="text-lg font-medium mb-2">No customers to display</p>
                <p className="text-sm">
                  {customers.length === 0 
                    ? 'No customers found for the selected date range.'
                    : 'No customers have lifetime values greater than 0.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="w-full" style={{ height: '600px', minHeight: '600px' }}>
              <ResponsiveContainer width="100%" height={600}>
                <ScatterChart
                  margin={{ top: 60, right: 30, left: 0, bottom: 50 }}
                >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                
                {/* X-Axis: Lifetime Value (Low to High, left to right) */}
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Lifetime Value"
                  unit=" £"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => {
                    if (value >= 1000000) return `£${(value / 1000000).toFixed(1)}M`
                    if (value >= 1000) return `£${(value / 1000).toFixed(0)}k`
                    return `£${value.toFixed(0)}`
                  }}
                />
                
                {/* Y-Axis: Relationship Score (High at top, Low at bottom) */}
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Relationship"
                  domain={[0, 10]}
                  tick={{ fontSize: 12 }}
                  ticks={[0, 2, 4, 6, 8, 10]}
                />
                
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length > 0) {
                      const data = payload[0].payload
                      return (
                        <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold">{data.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Value: £{data.value.toLocaleString()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Relationship: {data.score}/10 {!data.hasScore && '(not set)'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Projects: {data.projects}
                          </p>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                
                {/* Reference lines for value brackets */}
                {valueRanges.low.max > 0 && (
                  <ReferenceLine
                    x={valueRanges.low.max}
                    stroke="#fbbf24"
                    strokeDasharray="2 2"
                    label={{ value: 'Low/Medium', position: 'top', fill: '#fbbf24', fontSize: 10 }}
                  />
                )}
                {valueRanges.medium.max > 0 && (
                  <ReferenceLine
                    x={valueRanges.medium.max}
                    stroke="#f97316"
                    strokeDasharray="2 2"
                    label={{ value: 'Medium/High', position: 'top', fill: '#f97316', fontSize: 10 }}
                  />
                )}
                {/* Reference lines for relationship brackets */}
                <ReferenceLine
                  y={7}
                  stroke="#22c55e"
                  strokeDasharray="2 2"
                  label={{ value: 'High Rel', position: 'right', fill: '#22c55e', fontSize: 10 }}
                />
                <ReferenceLine
                  y={4}
                  stroke="#fbbf24"
                  strokeDasharray="2 2"
                  label={{ value: 'Medium Rel', position: 'right', fill: '#fbbf24', fontSize: 10 }}
                />
                <ReferenceLine
                  y={3}
                  stroke="#ef4444"
                  strokeDasharray="2 2"
                  label={{ value: 'Low Rel', position: 'right', fill: '#ef4444', fontSize: 10 }}
                />
                
                  <Scatter
                    name="Customers"
                    data={scatterData}
                    fill="#8884d8"
                    onClick={(data: any) => {
                      if (data && data.name) {
                        const customer = customers.find(c => c.client_name === data.name)
                        if (customer) handleCustomerClick(customer)
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {scatterData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getPointColor(entry)} />
                    ))}
                    <LabelList
                      dataKey="name"
                      position="top"
                      style={{ fontSize: '11px', fill: '#374151', fontWeight: 500 }}
                      offset={5}
                    />
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span>Ideal (High Relationship, High Value)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-500" />
              <span>Other</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span>Consider Dropping (Low Relationship, Low Value)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Update Relationship Score Dialog */}
      <Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vote on Relationship Score</DialogTitle>
            <DialogDescription>
              Rate your relationship with {selectedCustomer?.client_name} from 0 (poor) to 10 (excellent). 
              The average of all votes will be used for the chart.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="relationship-score">Your Relationship Score (0-10)</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="relationship-score"
                  type="number"
                  min="0"
                  max="10"
                  value={relationshipScore}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 0
                    setRelationshipScore(Math.max(0, Math.min(10, value)))
                  }}
                  className="w-24"
                />
                <div className="flex-1">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={relationshipScore}
                    onChange={(e) => setRelationshipScore(parseInt(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>0 (Poor)</span>
                    <span>5 (Neutral)</span>
                    <span>10 (Excellent)</span>
                  </div>
                </div>
              </div>
            </div>

            {selectedCustomer && (
              <div className="text-sm space-y-1 border-t pt-4">
                <div><strong>Lifetime Value:</strong> £{selectedCustomer.lifetime_value.toLocaleString()}</div>
                <div><strong>Projects:</strong> {selectedCustomer.project_count}</div>
                <div><strong>Average Relationship Score:</strong> {(selectedCustomer.relationship_score || 0).toFixed(1)}/10</div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedCustomer(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateScore} disabled={updating}>
              {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Vote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle>Customer Relationship Leaderboard</CardTitle>
          <CardDescription>
            All {groupBy === 'agency' ? 'agencies' : 'customers'} ranked by lifetime value. Click on any customer to vote on relationship score.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No {groupBy === 'agency' ? 'agencies' : 'customers'} found for the selected date range.
            </div>
          ) : (
            <div className="space-y-2">
              {customers.map((customer, index) => (
                <CustomerLeaderboardRow
                  key={customer.client_name}
                  customer={customer}
                  rank={index + 1}
                  onVote={() => handleCustomerClick(customer)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

