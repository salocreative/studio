import { format, parseISO } from 'date-fns'
import { londonToday, roundGbp } from '@/lib/billing/invoices'

export interface BillingProgressTaskInput {
  id: string
  name: string
  quotedHours: number
  isCompleted: boolean | null
  loggedHours: number
  loggedHoursThisMonth: number
}

export interface BillingProgressTask extends BillingProgressTaskInput {}

export interface BillingProgressInput {
  quoteValue: number | null
  projectQuotedHours: number | null
  invoicedTotal: number
  unallocated: number
  tasks: BillingProgressTaskInput[]
}

export interface BillingProgress {
  totalQuotedHours: number
  completedQuotedHours: number
  completedPercent: number | null
  earned: number | null
  suggestedAmount: number
  invoicedAhead: boolean
  canRecommend: boolean
  loggedHours: number
  loggedHoursThisMonth: number
  tasks: BillingProgressTask[]
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100
}

export function londonMonthRange(today: string = londonToday()): { start: string; end: string } {
  const [year, month] = today.split('-').map(Number)
  if (!year || !month) return { start: today, end: today }
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export function progressInvoiceLabel(today: string = londonToday()): string {
  try {
    return format(parseISO(`${today.slice(0, 7)}-01`), 'MMMM yyyy')
  } catch {
    return today
  }
}

export function parseInvoiceSubitemNotes(notes: string | null | undefined): string[] {
  if (!notes?.trim()) return []
  return notes
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
}

export function listedSubitemNames(notesList: Array<string | null | undefined>): Set<string> {
  const names = new Set<string>()
  for (const notes of notesList) {
    for (const line of parseInvoiceSubitemNotes(notes)) {
      names.add(line.toLowerCase())
    }
  }
  return names
}

export function formatInvoiceSubitemNotes(tasks: Array<{ name: string }>): string {
  return tasks
    .map((task) => task.name.trim())
    .filter(Boolean)
    .join('\n')
}

export function progressSubitemsForInvoice(
  tasks: BillingProgressTaskInput[],
  alreadyListed: Set<string>
): BillingProgressTaskInput[] {
  const completed = tasks.filter((task) => task.isCompleted === true && task.name.trim())
  const remaining = completed.filter((task) => !alreadyListed.has(task.name.trim().toLowerCase()))
  return remaining.length > 0 ? remaining : completed
}

export function splitAmountByWeights(
  total: number,
  items: Array<{ description: string; weight: number }>
): Array<{ description: string; amount: number }> {
  const usable = items.filter((item) => item.description.trim())
  if (usable.length === 0 || total <= 0) return []
  const weights = usable.map((item) => Math.max(0, item.weight))
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  const useEqual = weightSum <= 0
  const lines: Array<{ description: string; amount: number }> = []
  let allocated = 0
  for (let index = 0; index < usable.length; index++) {
    const isLast = index === usable.length - 1
    const share = useEqual ? 1 / usable.length : weights[index] / weightSum
    const amount = isLast ? roundGbp(total - allocated) : roundGbp(total * share)
    allocated = roundGbp(allocated + amount)
    if (amount > 0.009) {
      lines.push({ description: usable[index].description.trim(), amount })
    }
  }
  return lines
}

function sortProgressTasks(tasks: BillingProgressTaskInput[]): BillingProgressTask[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.isCompleted === true ? 0 : 1
    const bDone = b.isCompleted === true ? 0 : 1
    if (aDone !== bDone) return aDone - bDone
    return a.name.localeCompare(b.name)
  })
}

export function projectBillingProgress(input: BillingProgressInput): BillingProgress {
  const taskQuotedHours = roundHours(
    input.tasks.reduce((sum, task) => sum + Math.max(0, task.quotedHours), 0)
  )
  const totalQuotedHours =
    taskQuotedHours > 0 ? taskQuotedHours : roundHours(Math.max(0, input.projectQuotedHours ?? 0))
  const completedQuotedHours = roundHours(
    input.tasks.reduce(
      (sum, task) => (task.isCompleted === true ? sum + Math.max(0, task.quotedHours) : sum),
      0
    )
  )
  const loggedHours = roundHours(input.tasks.reduce((sum, task) => sum + task.loggedHours, 0))
  const loggedHoursThisMonth = roundHours(
    input.tasks.reduce((sum, task) => sum + task.loggedHoursThisMonth, 0)
  )

  const completedPercent = totalQuotedHours > 0.009 ? completedQuotedHours / totalQuotedHours : null
  const quoteValue = input.quoteValue
  const canRecommend =
    quoteValue != null && quoteValue > 0.009 && completedPercent != null && Number.isFinite(completedPercent)
  const earned = canRecommend && completedPercent != null ? roundGbp(quoteValue * completedPercent) : null
  const suggestedAmount =
    canRecommend && earned != null
      ? roundGbp(Math.min(input.unallocated, Math.max(0, earned - input.invoicedTotal)))
      : 0
  const invoicedAhead = Boolean(
    canRecommend && earned != null && input.invoicedTotal > earned + 0.009
  )

  return {
    totalQuotedHours,
    completedQuotedHours,
    completedPercent,
    earned,
    suggestedAmount,
    invoicedAhead,
    canRecommend,
    loggedHours,
    loggedHoursThisMonth,
    tasks: sortProgressTasks(input.tasks),
  }
}
