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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { TrendingUp } from 'lucide-react'
import { getTeamUtilization } from '@/app/actions/performance'
import { startOfMonth, endOfMonth, format, subMonths, parseISO, startOfWeek } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface TeamMemberUtilization {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'designer' | 'manager'
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

interface DayBreakdown {
  date: string
  dayName: string
  isWeekend: boolean
  users: {
    userId: string
    userName: string
    hoursLogged: number
    percentage: number
  }[]
  totalHoursLogged: number
  expectedHours: number
  totalPercentage: number
}

export default function PerformancePage() {
  const [members, setMembers] = useState<TeamMemberUtilization[]>([])
  const [period, setPeriod] = useState<Period | null>(null)
  const [futureCapacity, setFutureCapacity] = useState<FutureCapacity | null>(null)
  const [dailyBreakdown, setDailyBreakdown] = useState<DayBreakdown[]>([])
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
        if (result.dailyBreakdown) {
          setDailyBreakdown(result.dailyBreakdown)
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

        {/* Daily Breakdown */}
        {dailyBreakdown.length > 0 && (() => {
          // Group days by week
          const weeks = new Map<string, DayBreakdown[]>()
          
          dailyBreakdown.forEach((day) => {
            const date = parseISO(day.date)
            const weekStart = startOfWeek(date, { weekStartsOn: 1 }) // Monday as start of week
            const weekKey = format(weekStart, 'yyyy-MM-dd')
            
            if (!weeks.has(weekKey)) {
              weeks.set(weekKey, [])
            }
            weeks.get(weekKey)!.push(day)
          })
          
          // Sort weeks by date
          const sortedWeeks = Array.from(weeks.entries()).sort((a, b) => 
            a[0].localeCompare(b[0])
          )
          
          return (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Daily Breakdown</CardTitle>
                <CardDescription>
                  Day-by-day breakdown of hours logged by each team member. Days with no logging are highlighted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" className="w-full">
                  {sortedWeeks.map(([weekKey, weekDays]) => {
                    const weekStart = parseISO(weekKey)
                    const weekEnd = weekDays[weekDays.length - 1]
                    const weekLabel = weekDays.length > 0
                      ? `${format(weekStart, 'MMM d')} - ${format(parseISO(weekEnd.date), 'MMM d, yyyy')}`
                      : format(weekStart, 'MMM d, yyyy')
                    
                    const weekTotalHours = weekDays.reduce((sum, day) => sum + day.totalHoursLogged, 0)
                    const weekExpectedHours = weekDays.reduce((sum, day) => sum + day.expectedHours, 0)
                    const weekPercentage = weekExpectedHours > 0 
                      ? (weekTotalHours / weekExpectedHours) * 100 
                      : 0
                    
                    return (
                      <AccordionItem key={weekKey} value={weekKey}>
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center justify-between w-full pr-4">
                            <span className="font-medium">{weekLabel}</span>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span>{weekDays.length} day{weekDays.length !== 1 ? 's' : ''}</span>
                              <span>{weekTotalHours.toFixed(1)}h / {weekExpectedHours.toFixed(0)}h</span>
                              <span className={cn(
                                "font-semibold",
                                weekPercentage === 0 && "text-muted-foreground",
                                weekPercentage > 0 && weekPercentage < 100 && "text-yellow-600 dark:text-yellow-500",
                                weekPercentage >= 100 && "text-green-600 dark:text-green-500"
                              )}>
                                {weekPercentage.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="rounded-md border overflow-x-auto mt-4">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="sticky left-0 bg-background z-10 min-w-[150px]">Date</TableHead>
                                  {members.map((member) => (
                                    <TableHead key={member.id} className="text-right min-w-[120px]">
                                      {member.full_name || member.email}
                                    </TableHead>
                                  ))}
                                  <TableHead className="text-right min-w-[100px]">Total Hours</TableHead>
                                  <TableHead className="text-right min-w-[100px]">Expected</TableHead>
                                  <TableHead className="text-right min-w-[100px]">Total %</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {weekDays.map((day) => {
                                  const hasNoLogging = day.totalHoursLogged === 0
                                  const isIncomplete = day.totalPercentage < 100 && day.totalHoursLogged > 0
                                  
                                  return (
                                    <TableRow 
                                      key={day.date}
                                      className={cn(
                                        hasNoLogging && "bg-destructive/5 hover:bg-destructive/10",
                                        isIncomplete && "bg-yellow-50 dark:bg-yellow-950/20"
                                      )}
                                    >
                                      <TableCell className="font-medium sticky left-0 bg-inherit z-10">
                                        <div>
                                          <div>{day.dayName}</div>
                                          {hasNoLogging && (
                                            <div className="text-xs text-destructive font-normal mt-1">
                                              No time logged
                                            </div>
                                          )}
                                          {isIncomplete && (
                                            <div className="text-xs text-yellow-600 dark:text-yellow-500 font-normal mt-1">
                                              Incomplete
                                            </div>
                                          )}
                                        </div>
                                      </TableCell>
                                      {members.map((member) => {
                                        const dayUser = day.users.find(u => u.userId === member.id)
                                        const hoursLogged = dayUser?.hoursLogged || 0
                                        const percentage = dayUser?.percentage || 0
                                        const hasLoggedHours = hoursLogged > 0
                                        
                                        return (
                                          <TableCell key={member.id} className="text-right">
                                            <div className="flex flex-col items-end gap-1">
                                              <span className={cn(
                                                "text-sm",
                                                hasLoggedHours ? "font-medium" : "text-muted-foreground"
                                              )}>
                                                {hoursLogged > 0 ? `${hoursLogged.toFixed(1)}h` : '—'}
                                              </span>
                                              <span className={cn(
                                                "text-xs",
                                                percentage === 0 && "text-muted-foreground",
                                                percentage > 0 && percentage < 100 && "text-yellow-600 dark:text-yellow-500",
                                                percentage >= 100 && "text-green-600 dark:text-green-500"
                                              )}>
                                                {percentage.toFixed(0)}%
                                              </span>
                                            </div>
                                          </TableCell>
                                        )
                                      })}
                                      <TableCell className="text-right font-medium">
                                        {day.totalHoursLogged > 0 ? `${day.totalHoursLogged.toFixed(1)}h` : '—'}
                                      </TableCell>
                                      <TableCell className="text-right text-muted-foreground">
                                        {day.expectedHours > 0 ? `${day.expectedHours.toFixed(0)}h` : '—'}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <span className={cn(
                                          "font-semibold",
                                          day.totalPercentage === 0 && "text-muted-foreground",
                                          day.totalPercentage > 0 && day.totalPercentage < 100 && "text-yellow-600 dark:text-yellow-500",
                                          day.totalPercentage >= 100 && "text-green-600 dark:text-green-500"
                                        )}>
                                          {day.totalPercentage.toFixed(0)}%
                                        </span>
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )
                  })}
                </Accordion>
              </CardContent>
            </Card>
          )
        })()}

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

