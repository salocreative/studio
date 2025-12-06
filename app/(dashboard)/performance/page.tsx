'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TrendingUp } from 'lucide-react'
import { getTeamUtilization } from '@/app/actions/performance'
import { startOfMonth, endOfMonth, format, subMonths, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface TeamMemberUtilization {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'designer' | 'employee'
  hours_logged: number
  available_hours: number
  utilization_percentage: number
  days_worked: number
}

interface Period {
  start: string
  end: string
  working_days: number
  total_available_hours: number
}

interface FutureCapacity {
  totalLeadsHours: number
  leadsCount: number
}

export default function PerformancePage() {
  const [members, setMembers] = useState<TeamMemberUtilization[]>([])
  const [period, setPeriod] = useState<Period | null>(null)
  const [futureCapacity, setFutureCapacity] = useState<FutureCapacity | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState<'current' | 'last' | 'custom'>('current')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')

  useEffect(() => {
    loadPerformance()
  }, [dateRange, customStartDate, customEndDate])

  const getDateRange = () => {
    if (dateRange === 'current') {
      const start = startOfMonth(new Date())
      const end = endOfMonth(new Date())
      return {
        start: format(start, 'yyyy-MM-dd'),
        end: format(end, 'yyyy-MM-dd'),
      }
    } else if (dateRange === 'last') {
      const start = startOfMonth(subMonths(new Date(), 1))
      const end = endOfMonth(subMonths(new Date(), 1))
      return {
        start: format(start, 'yyyy-MM-dd'),
        end: format(end, 'yyyy-MM-dd'),
      }
    } else {
      return {
        start: customStartDate,
        end: customEndDate,
      }
    }
  }

  async function loadPerformance() {
    // Don't load if custom dates are selected but not filled
    if (dateRange === 'custom' && (!customStartDate || !customEndDate)) {
      return
    }

    setLoading(true)
    try {
      const dates = getDateRange()
      const result = await getTeamUtilization(dates.start, dates.end)
      
      if (result.error) {
        console.error('Error loading performance:', result.error)
        toast.error('Error loading performance', { description: result.error })
      } else if (result.members) {
        setMembers(result.members)
        if (result.period) {
          setPeriod(result.period)
        }
        if (result.futureCapacity) {
          setFutureCapacity(result.futureCapacity)
        }
      }
    } catch (error) {
      console.error('Error loading performance:', error)
      toast.error('Error loading performance')
    } finally {
      setLoading(false)
    }
  }

  const getUtilizationColor = (percentage: number) => {
    if (percentage >= 90) return 'text-green-600 dark:text-green-500'
    if (percentage >= 75) return 'text-blue-600 dark:text-blue-500'
    if (percentage >= 50) return 'text-yellow-600 dark:text-yellow-500'
    return 'text-orange-600 dark:text-orange-500'
  }

  const getUtilizationBadgeVariant = (percentage: number) => {
    if (percentage >= 90) return 'default'
    if (percentage >= 75) return 'default'
    if (percentage >= 50) return 'secondary'
    return 'destructive'
  }

  const averageUtilization = useMemo(() => {
    if (members.length === 0) return 0
    const sum = members.reduce((acc, member) => acc + member.utilization_percentage, 0)
    return sum / members.length
  }, [members])

  const totalHoursLogged = useMemo(() => {
    return members.reduce((acc, member) => acc + member.hours_logged, 0)
  }, [members])

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-2xl font-semibold">Performance</h1>
            <p className="text-sm text-muted-foreground">Team member utilisation and productivity metrics</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Team Members
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{members.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Average Utilisation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn("text-3xl font-bold", getUtilizationColor(averageUtilization))}>
                {averageUtilization.toFixed(1)}%
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Hours Logged
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalHoursLogged.toFixed(1)}h</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Available Hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {period?.total_available_hours.toFixed(0) || 0}h
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Date Range Selector */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Date Range</CardTitle>
            <CardDescription>Select the time period for utilisation calculation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Label htmlFor="date-range">Period</Label>
                <Select value={dateRange} onValueChange={(value: 'current' | 'last' | 'custom') => setDateRange(value)}>
                  <SelectTrigger id="date-range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">Current Month</SelectItem>
                    <SelectItem value="last">Last Month</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {dateRange === 'custom' && (
                <>
                  <div className="flex-1">
                    <Label htmlFor="start-date">Start Date</Label>
                    <Input
                      id="start-date"
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="end-date">End Date</Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                    />
                  </div>
                </>
              )}

              {period && (
                <div className="flex items-end">
                  <div className="text-sm text-muted-foreground">
                    {format(parseISO(period.start), 'MMM d, yyyy')} - {format(parseISO(period.end), 'MMM d, yyyy')}
                    <br />
                    <span className="text-xs">{period.working_days} working days</span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Utilization Table */}
        <Card>
          <CardHeader>
            <CardTitle>Team Utilisation</CardTitle>
            <CardDescription>
              Utilisation is calculated as hours logged divided by available hours (6 hours per working day)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center text-muted-foreground">Loading utilisation data...</div>
              </div>
            ) : members.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No team members found
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Hours Logged</TableHead>
                      <TableHead className="text-right">Available Hours</TableHead>
                      <TableHead className="text-right">Days Worked</TableHead>
                      <TableHead className="text-right">Utilization</TableHead>
                      <TableHead>Progress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">
                          {member.full_name || member.email}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{member.role}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {member.hours_logged.toFixed(1)}h
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {member.available_hours.toFixed(0)}h
                        </TableCell>
                        <TableCell className="text-right">
                          {member.days_worked} day{member.days_worked !== 1 ? 's' : ''}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn("font-semibold", getUtilizationColor(member.utilization_percentage))}>
                            {member.utilization_percentage.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress 
                              value={Math.min(member.utilization_percentage, 100)} 
                              className="h-2 flex-1"
                            />
                            {member.utilization_percentage > 100 && (
                              <span className="text-xs text-destructive">Over</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Future Capacity Section */}
        {futureCapacity && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Future Capacity</CardTitle>
              <CardDescription>
                Upcoming projects from leads board that will affect future capacity
              </CardDescription>
            </CardHeader>
            <CardContent>
              {futureCapacity.leadsCount === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">No leads configured</p>
                  <p className="text-xs mt-1">
                    Configure a leads board in Settings to see future capacity projections
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Total Leads Projects</div>
                      <div className="text-2xl font-bold">{futureCapacity.leadsCount}</div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Total Quoted Hours</div>
                      <div className="text-2xl font-bold">{futureCapacity.totalLeadsHours.toFixed(1)}h</div>
                    </div>
                  </div>
                  {period && members.length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="text-sm text-muted-foreground">
                        Based on {period.total_available_hours.toFixed(0)} available hours per team member this period,
                        the leads would add approximately{' '}
                        <span className="font-semibold">
                          {((futureCapacity.totalLeadsHours / (period.total_available_hours * members.length)) * 100).toFixed(1)}%
                        </span>{' '}
                        additional capacity requirement if all leads convert.
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

