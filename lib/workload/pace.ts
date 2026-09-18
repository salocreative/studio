export type WorkloadPace = 'ahead' | 'behind' | 'on-pace' | 'over-budget' | 'no-timeline'

/** Pace is on track when logged hours are within this fraction of quoted hours of the expected amount. */
const PACE_TOLERANCE = 0.1

function toMs(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Same pace rules as the Projects list: logged hours vs quoted hours across the job timeline.
 */
export function getWorkloadPace(input: {
  quotedHours: number
  loggedHours: number
  timelineStarts: Array<string | null | undefined>
  timelineEnds: Array<string | null | undefined>
  dueDate?: string | null
  createdAt?: string | null
}): WorkloadPace {
  const isOverBudget =
    (input.quotedHours > 0 && input.loggedHours > input.quotedHours) ||
    (input.quotedHours <= 0 && input.loggedHours > 0)

  const startTimes = input.timelineStarts.map(toMs).filter((ms): ms is number => ms != null)
  const endTimes = input.timelineEnds.map(toMs).filter((ms): ms is number => ms != null)

  const startMs =
    startTimes.length > 0 ? Math.min(...startTimes) : toMs(input.createdAt)
  const endMs = endTimes.length > 0 ? Math.max(...endTimes) : toMs(input.dueDate)

  if (startMs == null || endMs == null || endMs <= startMs || input.quotedHours <= 0) {
    return isOverBudget ? 'over-budget' : 'no-timeline'
  }

  const totalDuration = endMs - startMs
  const elapsed = Math.min(Math.max(Date.now() - startMs, 0), totalDuration)
  const expectedHours = input.quotedHours * (elapsed / totalDuration)
  const varianceHours = input.loggedHours - expectedHours
  const varianceRatio = varianceHours / input.quotedHours

  if (isOverBudget) return 'over-budget'
  if (Math.abs(varianceRatio) <= PACE_TOLERANCE) return 'on-pace'
  return varianceHours > 0 ? 'ahead' : 'behind'
}
