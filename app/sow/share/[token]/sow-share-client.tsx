'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { SaloLogo } from '@/components/brand/salo-logo'
import {
  approveSowByToken,
  getSowByToken,
  rejectSowByToken,
  type PublicSowDocument,
} from '@/app/actions/sow-public'
import { getRateMultiplier, scaleForQuote } from '@/lib/sow/calculations'
import { cn } from '@/lib/utils'

interface SowShareClientProps {
  shareToken: string
}

function formatMoney(value: number) {
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function SowShareClient({ shareToken }: SowShareClientProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [document, setDocument] = useState<PublicSowDocument | null>(null)
  const [approverName, setApproverName] = useState('')
  const [approverEmail, setApproverEmail] = useState('')
  const [rejectionNotes, setRejectionNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showRejectForm, setShowRejectForm] = useState(false)

  async function loadDocument() {
    setLoading(true)
    setError(null)
    const result = await getSowByToken(shareToken)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      setDocument(null)
      return
    }
    if (result.document) setDocument(result.document)
  }

  useEffect(() => {
    loadDocument()
  }, [shareToken])

  async function handleApprove() {
    setSubmitting(true)
    const result = await approveSowByToken(shareToken, approverName, approverEmail)
    setSubmitting(false)
    if (result.error) {
      setError(result.error)
    } else {
      await loadDocument()
    }
  }

  async function handleReject() {
    setSubmitting(true)
    const result = await rejectSowByToken(shareToken, approverName, rejectionNotes)
    setSubmitting(false)
    if (result.error) {
      setError(result.error)
    } else {
      await loadDocument()
      setShowRejectForm(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !document) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Unable to load</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (!document) return null

  const isApproved = document.status === 'approved'
  const isRejected = document.status === 'rejected'
  const canRespond = !isApproved && !isRejected
  const showQuotedHours = document.show_quoted_hours ?? true
  const showPaymentSchedule = document.show_payment_schedule ?? true
  const rateMultiplier = getRateMultiplier(
    Number(document.base_day_rate_gbp) || 0,
    document.day_rate_override_gbp != null ? Number(document.day_rate_override_gbp) : null
  )
  const displayTotalHours = scaleForQuote(Number(document.total_hours), rateMultiplier)

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <SaloLogo className="h-8 w-auto" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Statement of Work</h1>
          {document.agency_name ? (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Agency partner: <span className="font-medium text-foreground">{document.agency_name}</span>
              </p>
              <p className="text-lg text-muted-foreground">
                End client: <span className="font-medium text-foreground">{document.client_name}</span>
              </p>
            </div>
          ) : (
            <p className="text-lg text-muted-foreground">{document.client_name}</p>
          )}
        </div>

        {isApproved && (
          <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
            <CardContent className="pt-6 flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-300">Approved</p>
                <p className="text-sm text-green-700 dark:text-green-400">
                  {document.approved_by_name} approved this on{' '}
                  {document.approved_at
                    ? new Date(document.approved_at).toLocaleDateString()
                    : '—'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isRejected && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="pt-6 flex items-start gap-3">
              <XCircle className="h-6 w-6 text-destructive shrink-0" />
              <div>
                <p className="font-semibold">Declined</p>
                <p className="text-sm text-muted-foreground">
                  {document.rejected_by_name} declined on{' '}
                  {document.rejected_at
                    ? new Date(document.rejected_at).toLocaleDateString()
                    : '—'}
                </p>
                {document.rejection_notes && (
                  <p className="text-sm mt-2">{document.rejection_notes}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{document.title}</CardTitle>
            <CardDescription>
              {showQuotedHours ? 'Scope, time, and investment' : 'Scope and investment'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {document.notes && (
              <div className="rounded-lg bg-muted/50 p-4 text-sm whitespace-pre-wrap">
                {document.notes}
              </div>
            )}

            {(document.start_date || document.end_date) && (
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                {document.start_date && (
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground">Project start</p>
                    <p className="font-medium mt-1">
                      {new Date(document.start_date).toLocaleDateString()}
                    </p>
                  </div>
                )}
                {document.end_date && (
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground">Project end</p>
                    <p className="font-medium mt-1">
                      {new Date(document.end_date).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deliverable</TableHead>
                    {showQuotedHours && <TableHead className="text-right">Time</TableHead>}
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {document.line_items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="font-medium">{item.title}</p>
                        {item.description && (
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">
                            {item.description}
                          </p>
                        )}
                        {(item.timeline_start || item.timeline_end) && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {item.timeline_start
                              ? new Date(item.timeline_start).toLocaleDateString()
                              : '—'}
                            {' → '}
                            {item.timeline_end
                              ? new Date(item.timeline_end).toLocaleDateString()
                              : '—'}
                          </p>
                        )}
                      </TableCell>
                      {showQuotedHours && (
                        <TableCell className="text-right text-muted-foreground">
                          {item.is_days
                            ? `${scaleForQuote(Number(item.quantity), rateMultiplier)} day${
                                scaleForQuote(Number(item.quantity), rateMultiplier) !== 1
                                  ? 's'
                                  : ''
                              } (${scaleForQuote(Number(item.hours), rateMultiplier).toFixed(1)}h)`
                            : `${scaleForQuote(Number(item.hours), rateMultiplier).toFixed(1)}h`}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        {formatMoney(Number(item.line_total_gbp))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-1 text-sm border-t pt-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatMoney(Number(document.subtotal_gbp))}</span>
              </div>
              {document.include_vat && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT (20%)</span>
                  <span>{formatMoney(Number(document.vat_amount_gbp))}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-base pt-2">
                <span>Total</span>
                <span>{formatMoney(Number(document.total_gbp))}</span>
              </div>
              {showQuotedHours && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Total hours</span>
                  <span>{displayTotalHours.toFixed(1)}h</span>
                </div>
              )}
            </div>

            {(showPaymentSchedule && (document.payment_milestones?.length ?? 0) > 0) && (
              <div className="border-t pt-4 space-y-2">
                <h3 className="font-medium text-sm">Payment schedule</h3>
                <div className="space-y-1.5 text-sm">
                  {document.payment_milestones!.map((milestone) => {
                    const amount =
                      (Number(document.total_gbp) * Number(milestone.percentage)) / 100
                    return (
                      <div
                        key={milestone.id}
                        className="flex items-baseline justify-between gap-4"
                      >
                        <span>
                          <span className="font-medium">{milestone.label}</span>
                          <span className="text-muted-foreground">
                            {' '}
                            · {Number(milestone.percentage).toFixed(0)}%
                            {milestone.due_date
                              ? ` · due ${new Date(milestone.due_date).toLocaleDateString()}`
                              : ''}
                          </span>
                        </span>
                        <span className="font-medium whitespace-nowrap">{formatMoney(amount)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {canRespond && (
          <Card>
            <CardHeader>
              <CardTitle>Your response</CardTitle>
              <CardDescription>
                Approve this statement of work to confirm scope and investment, or decline with feedback.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="approver-name">Your name *</Label>
                  <Input
                    id="approver-name"
                    value={approverName}
                    onChange={(e) => setApproverName(e.target.value)}
                    placeholder="Full name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="approver-email">Email (optional)</Label>
                  <Input
                    id="approver-email"
                    type="email"
                    value={approverEmail}
                    onChange={(e) => setApproverEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              {showRejectForm && (
                <div className="space-y-2">
                  <Label htmlFor="rejection-notes">Feedback (optional)</Label>
                  <Textarea
                    id="rejection-notes"
                    value={rejectionNotes}
                    onChange={(e) => setRejectionNotes(e.target.value)}
                    placeholder="Let us know what needs changing..."
                    rows={3}
                  />
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row gap-3">
                {!showRejectForm ? (
                  <>
                    <Button
                      variant="outline"
                      className="w-auto self-start sm:self-auto"
                      onClick={() => setShowRejectForm(true)}
                      disabled={submitting}
                    >
                      Decline
                    </Button>
                    <Button
                      className={cn('w-full flex-1', 'bg-green-600 hover:bg-green-700')}
                      onClick={handleApprove}
                      disabled={submitting || !approverName.trim()}
                    >
                      {submitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Approve statement of work
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setShowRejectForm(false)
                        setRejectionNotes('')
                      }}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={handleReject}
                      disabled={submitting || !approverName.trim()}
                    >
                      Confirm decline
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
