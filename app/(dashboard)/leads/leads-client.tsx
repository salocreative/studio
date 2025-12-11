'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { getLeads } from '@/app/actions/leads'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export default function LeadsPageClient() {
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<any[]>([])

  useEffect(() => {
    loadLeads()
  }, [])

  async function loadLeads() {
    setLoading(true)
    try {
      const leadsResult = await getLeads()
      if (leadsResult.error) {
        console.error('Error loading leads:', leadsResult.error)
        toast.error('Error loading leads')
      } else {
        setLeads(leadsResult.leads || [])
      }
    } catch (error) {
      console.error('Error loading leads:', error)
      toast.error('Error loading leads')
    } finally {
      setLoading(false)
    }
  }

  const totalLeadsHours = leads.reduce((sum, lead) => sum + (lead.quoted_hours || 0), 0)
  // Simplified: Estimate revenue from leads (assuming £X per hour)
  // This would be configurable in production
  const estimatedHourlyRate = 75 // Placeholder - should be configurable
  const potentialRevenue = totalLeadsHours * estimatedHourlyRate

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b bg-background">
          <div className="flex h-16 items-center px-6">
            <div>
              <h1 className="text-2xl font-semibold">Leads</h1>
              <p className="text-sm text-muted-foreground">
                Potential future revenue from leads and prospects
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

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background">
        <div className="flex h-16 items-center px-6">
          <div>
            <h1 className="text-2xl font-semibold">Leads</h1>
            <p className="text-sm text-muted-foreground">
              Potential future revenue from leads and prospects from Monday.com
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl space-y-6">
          {/* Leads Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Leads Overview</CardTitle>
              <CardDescription>
                Potential future revenue from leads and prospects from Monday.com
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Total Leads</div>
                  <div className="text-2xl font-bold">{leads.length}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Total Quoted Hours</div>
                  <div className="text-2xl font-bold">{totalLeadsHours.toFixed(1)}h</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Total Value</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    £{leads.reduce((sum, lead) => sum + (lead.quote_value || lead.quoted_hours ? (lead.quoted_hours || 0) * estimatedHourlyRate : 0), 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {leads.some(l => l.quote_value) 
                      ? 'From Monday.com values'
                      : `Est. at £${estimatedHourlyRate}/hour`}
                  </div>
                </div>
              </div>

              {/* Detailed Leads Table */}
              {leads.length > 0 && (
                <div className="border-t pt-6">
                  <h3 className="text-lg font-semibold mb-4">All Leads</h3>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project Name</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead className="text-right">Quoted Hours</TableHead>
                          <TableHead className="text-right">Quote Value</TableHead>
                          <TableHead className="text-right">Est. Value</TableHead>
                          <TableHead>Timeline</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leads.map((lead) => {
                          const estimatedValue = lead.quoted_hours ? lead.quoted_hours * estimatedHourlyRate : 0
                          const displayValue = lead.quote_value || estimatedValue
                          const isEstimated = !lead.quote_value

                          return (
                            <TableRow key={lead.id}>
                              <TableCell className="font-medium">{lead.name}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {lead.client_name || '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                {lead.quoted_hours ? `${lead.quoted_hours.toFixed(1)}h` : '—'}
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {lead.quote_value ? (
                                  `£${lead.quote_value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className={cn(
                                "text-right",
                                isEstimated && "text-muted-foreground"
                              )}>
                                {estimatedValue > 0 ? (
                                  <>
                                    £{estimatedValue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    {isEstimated && lead.quote_value === null && (
                                      <span className="text-xs ml-1">(est.)</span>
                                    )}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {lead.timeline_start || lead.timeline_end ? (
                                  <div>
                                    {lead.timeline_start && (
                                      <div>{format(new Date(lead.timeline_start), 'MMM d, yyyy')}</div>
                                    )}
                                    {lead.timeline_start && lead.timeline_end && (
                                      <div className="text-xs">to</div>
                                    )}
                                    {lead.timeline_end && (
                                      <div>{format(new Date(lead.timeline_end), 'MMM d, yyyy')}</div>
                                    )}
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                        <TableRow className="font-semibold bg-muted/50">
                          <TableCell colSpan={2}>Total</TableCell>
                          <TableCell className="text-right">
                            {totalLeadsHours.toFixed(1)}h
                          </TableCell>
                          <TableCell className="text-right">
                            £{leads.reduce((sum, lead) => sum + (lead.quote_value || 0), 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            £{potentialRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

