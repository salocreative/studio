'use server'

import { createClient } from '@/lib/supabase/server'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'
import { getFlexiDesignCompletedBoard } from '@/app/actions/flexi-design-completed-board'
import { getLeadsStatusConfig } from '@/app/actions/leads-status-config'
import {
  extractLikelihoodFromMondayData,
  extractMondayStatusFromMondayData,
  forecastDateFromProject,
  weightedQuoteValue,
} from '@/lib/monday/column-extract'
import { findMappingColumnId } from '@/lib/monday/mapping-resolver'

export type ForecastPipelineSegment = 'completed' | 'active' | 'lead'

export interface ForecastPipelineProject {
  id: string
  monday_item_id: string
  name: string
  client_name: string | null
  agency: string | null
  segment: ForecastPipelineSegment
  /** Lifecycle status in Studio (active / locked / lead) */
  lifecycle_status: 'active' | 'locked' | 'lead' | 'archived'
  /** Monday workflow label (Scoping, Ongoing, etc.) */
  monday_status: string | null
  quote_value: number | null
  quoted_hours: number | null
  /** Win likelihood 0–100; meaningful for leads */
  likelihood: number | null
  completed_date: string | null
  due_date: string | null
  /** completed_date for locked projects, else due_date (with completed_date fallback) */
  forecast_date: string | null
  /** quote_value weighted by likelihood for leads */
  weighted_value: number | null
}

export interface ForecastPipelineSummary {
  total_count: number
  with_value: number
  with_forecast_date: number
  missing_value: number
  missing_forecast_date: number
  by_segment: Record<ForecastPipelineSegment, number>
}

function parseQuoteValue(
  raw: unknown,
  mondayData: Record<string, { text?: string; value?: unknown }> | null,
  quoteValueColumnId: string | null
): number | null {
  if (raw != null && raw !== '') {
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw))
    if (!isNaN(n)) return n
  }
  if (!mondayData || !quoteValueColumnId || !mondayData[quoteValueColumnId]) return null
  const col = mondayData[quoteValueColumnId]
  if (col.value != null && col.value !== '') {
    const v = col.value
    if (typeof v === 'number' && !isNaN(v)) return v
    if (typeof v === 'object' && v !== null && 'value' in v) {
      const inner = (v as { value?: number | string }).value
      const n = typeof inner === 'number' ? inner : parseFloat(String(inner))
      if (!isNaN(n)) return n
    }
    const n = parseFloat(String(v))
    if (!isNaN(n)) return n
  }
  if (col.text) {
    const n = parseFloat(col.text.replace(/[£,$,\s]/g, ''))
    if (!isNaN(n)) return n
  }
  return null
}

function leadPassesStatusFilter(
  mondayStatus: string | null,
  includedStatuses: string[],
  excludedStatuses: string[]
): boolean {
  if (!mondayStatus) return true
  if (includedStatuses.length > 0) return includedStatuses.includes(mondayStatus)
  if (excludedStatuses.length > 0) return !excludedStatuses.includes(mondayStatus)
  return true
}

function toSegment(lifecycleStatus: string): ForecastPipelineSegment | null {
  if (lifecycleStatus === 'locked') return 'completed'
  if (lifecycleStatus === 'active') return 'active'
  if (lifecycleStatus === 'lead') return 'lead'
  return null
}

/**
 * Normalised forecast dataset: main-board completed, active, and leads (Flexi-Design excluded).
 */
export async function getForecastPipeline() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (
    !userProfile ||
    (userProfile.role !== 'admin' &&
      userProfile.role !== 'designer' &&
      userProfile.role !== 'manager')
  ) {
    return { error: 'Unauthorized: Admin, Designer, or Manager access required' }
  }

  try {
    const flexiDesignBoardIds = await getFlexiDesignBoardIds()
    const completedBoardResult = await getFlexiDesignCompletedBoard()
    const boardIdsToExclude = new Set(Array.from(flexiDesignBoardIds))
    if (completedBoardResult.success && completedBoardResult.board?.monday_board_id) {
      boardIdsToExclude.add(completedBoardResult.board.monday_board_id)
    }

    const { data: mappings } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, board_id, column_type')
      .in('column_type', ['quote_value', 'status', 'likelihood'])

    const statusConfig = await getLeadsStatusConfig()
    const includedStatuses = statusConfig.success ? statusConfig.includedStatuses : []
    const excludedStatuses = statusConfig.success ? statusConfig.excludedStatuses : []

    const { data: rows, error } = await supabase
      .from('monday_projects')
      .select(
        'id, monday_item_id, name, client_name, agency, status, quote_value, quoted_hours, completed_date, due_date, monday_status, likelihood, monday_data, monday_board_id'
      )
      .in('status', ['active', 'locked', 'lead'])
      .order('name', { ascending: true })

    if (error) throw error

    const projects: ForecastPipelineProject[] = []

    for (const row of rows || []) {
      if (boardIdsToExclude.has(row.monday_board_id)) continue

      const segment = toSegment(row.status)
      if (!segment) continue

      if (segment === 'lead') {
        const statusLabel =
          row.monday_status ??
          extractMondayStatusFromMondayData(
            row.monday_data as Record<string, { text?: string; value?: unknown }> | null,
            findMappingColumnId(mappings, 'status', row.monday_board_id)
          )
        if (!leadPassesStatusFilter(statusLabel, includedStatuses, excludedStatuses)) {
          continue
        }
      }

      const quoteValueColumnId = findMappingColumnId(mappings, 'quote_value', row.monday_board_id)
      const statusColumnId = findMappingColumnId(mappings, 'status', row.monday_board_id)
      const likelihoodColumnId = findMappingColumnId(mappings, 'likelihood', row.monday_board_id)

      const mondayData = row.monday_data as Record<string, { text?: string; value?: unknown }> | null

      const quote_value = parseQuoteValue(row.quote_value, mondayData, quoteValueColumnId)

      const monday_status =
        row.monday_status ??
        extractMondayStatusFromMondayData(mondayData, statusColumnId)

      const likelihood =
        row.likelihood != null
          ? Number(row.likelihood)
          : extractLikelihoodFromMondayData(mondayData, likelihoodColumnId)

      const forecast_date = forecastDateFromProject({
        status: row.status,
        completed_date: row.completed_date,
        due_date: row.due_date,
      })

      projects.push({
        id: row.id,
        monday_item_id: row.monday_item_id,
        name: row.name,
        client_name: row.client_name,
        agency: row.agency,
        segment,
        lifecycle_status: row.status as ForecastPipelineProject['lifecycle_status'],
        monday_status,
        quote_value,
        quoted_hours: row.quoted_hours != null ? Number(row.quoted_hours) : null,
        likelihood: likelihood != null && !isNaN(likelihood) ? likelihood : null,
        completed_date: row.completed_date,
        due_date: row.due_date,
        forecast_date,
        weighted_value: weightedQuoteValue(quote_value, likelihood, segment),
      })
    }

    const summary: ForecastPipelineSummary = {
      total_count: projects.length,
      with_value: projects.filter((p) => p.quote_value != null).length,
      with_forecast_date: projects.filter((p) => p.forecast_date != null).length,
      missing_value: projects.filter((p) => p.quote_value == null).length,
      missing_forecast_date: projects.filter((p) => p.forecast_date == null).length,
      by_segment: {
        completed: projects.filter((p) => p.segment === 'completed').length,
        active: projects.filter((p) => p.segment === 'active').length,
        lead: projects.filter((p) => p.segment === 'lead').length,
      },
    }

    projects.sort((a, b) => {
      const dateA = a.forecast_date ?? ''
      const dateB = b.forecast_date ?? ''
      if (dateA !== dateB) return dateB.localeCompare(dateA)
      return a.name.localeCompare(b.name)
    })

    return { success: true, projects, summary }
  } catch (err) {
    console.error('Error fetching forecast pipeline:', err)
    return {
      error: err instanceof Error ? err.message : 'Failed to fetch forecast pipeline',
    }
  }
}
