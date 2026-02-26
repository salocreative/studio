'use server'

import crypto from 'crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'

async function requireAdminOrManager(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { allowed: false as const, error: 'Not authenticated' }
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = profile?.role as string | undefined
  if (role !== 'admin' && role !== 'manager') return { allowed: false as const, error: 'Admin or manager access required' }
  return { allowed: true as const }
}

export interface ClientTimeEntry {
  id: string
  date: string
  hours: number
  notes: string | null
  task_name: string
  project_name: string
  project_id: string
  project_status: string
  user_id: string
  user_name: string | null
  user_email: string | null
  is_flexi: boolean
}

export interface ClientTimeReportFilters {
  projectId?: string
  userId?: string
  dateFrom?: string
  dateTo?: string
}

/**
 * Get distinct client names that have at least one time entry (main + Flexi-Design).
 */
export async function getClientsWithTimeEntries() {
  const supabase = await createClient()
  const access = await requireAdminOrManager(supabase)
  if (!access.allowed) return { error: access.error }

  const { data: projectIds, error: projectError } = await supabase
    .from('time_entries')
    .select('project_id')
  if (projectError) return { error: projectError.message }

  const ids = [...new Set((projectIds || []).map((r) => r.project_id).filter(Boolean))]
  if (ids.length === 0) return { success: true, clients: [] as string[] }

  const { data: projects, error } = await supabase
    .from('monday_projects')
    .select('client_name')
    .in('id', ids)
    .not('client_name', 'is', null)
  if (error) return { error: error.message }

  const clients = [...new Set((projects || []).map((p) => p.client_name!).filter(Boolean))].sort()
  return { success: true, clients }
}

/**
 * Get projects for a client (main and Flexi-Design) for use in the project filter.
 */
export async function getProjectsByClientName(clientName: string) {
  const supabase = await createClient()
  const access = await requireAdminOrManager(supabase)
  if (!access.allowed) return { error: access.error }

  const { data, error } = await supabase
    .from('monday_projects')
    .select('id, name, monday_board_id, status')
    .eq('client_name', clientName)
    .order('name', { ascending: true })
  if (error) return { error: error.message }

  const flexiBoardIds = await getFlexiBoardIdsSet(supabase)
  const projects = (data || []).map((p) => ({
    id: p.id,
    name: p.name,
    is_flexi: flexiBoardIds.has(p.monday_board_id),
    status: p.status || 'active',
  }))
  return { success: true, projects }
}

async function getFlexiBoardIdsSet(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: mappings } = await supabase
    .from('monday_column_mappings')
    .select('board_id')
    .not('board_id', 'is', null)
  const boardIds = [...new Set((mappings || []).map((m) => m.board_id).filter(Boolean))]
  if (boardIds.length === 0) return new Set<string>()

  const { data: flexiBoard } = await supabase
    .from('flexi_design_completed_board')
    .select('monday_board_id')
    .maybeSingle()
  const completedBoardId = flexiBoard?.monday_board_id || null

  const { getFlexiDesignBoardIds } = await import('@/lib/monday/board-helpers')
  const flexiIds = await getFlexiDesignBoardIds()
  const set = new Set(flexiIds)
  if (completedBoardId) set.add(completedBoardId)
  return set
}

/**
 * Get users (designers) who have at least one time entry for the given client.
 */
export async function getUsersWithTimeForClient(clientName: string) {
  const supabase = await createClient()
  const access = await requireAdminOrManager(supabase)
  if (!access.allowed) return { error: access.error }

  const { data: projects, error: projErr } = await supabase
    .from('monday_projects')
    .select('id')
    .eq('client_name', clientName)
  if (projErr || !projects?.length) return { success: true, users: [] }

  const projectIds = projects.map((p) => p.id)
  const { data: entries, error: entErr } = await supabase
    .from('time_entries')
    .select('user_id')
    .in('project_id', projectIds)
  if (entErr) return { error: entErr.message }

  const userIds = [...new Set((entries || []).map((e) => e.user_id).filter(Boolean))]
  if (userIds.length === 0) return { success: true, users: [] }

  // Use admin client so we can read other users' names (users RLS only allows own profile)
  const adminClient = await createAdminClient()
  if (!adminClient) return { error: 'Unable to load user list' }
  const { data: users, error: userErr } = await adminClient
    .from('users')
    .select('id, full_name, email')
    .in('id', userIds)
    .order('full_name', { ascending: true })
  if (userErr) return { error: userErr.message }

  return {
    success: true,
    users: (users || []).map((u) => ({
      id: u.id,
      full_name: u.full_name || null,
      email: u.email || null,
    })),
  }
}

/**
 * Get time entries for a client with optional project and designer filters. Includes main and Flexi-Design.
 */
export async function getClientTimeEntries(
  clientName: string,
  filters: ClientTimeReportFilters = {}
) {
  const supabase = await createClient()
  const access = await requireAdminOrManager(supabase)
  if (!access.allowed) return { error: access.error }

  const { data: projects, error: projErr } = await supabase
    .from('monday_projects')
    .select('id, name, monday_board_id, status')
    .eq('client_name', clientName)
  if (projErr) return { error: projErr.message }
  if (!projects?.length) return { success: true, entries: [] as ClientTimeEntry[], totalHours: 0 }

  const flexiBoardIds = await getFlexiBoardIdsSet(supabase)
  const projectIds = projects.map((p) => p.id)
  const projectMap = new Map(projects.map((p) => [
    p.id,
    { name: p.name, isFlexi: flexiBoardIds.has(p.monday_board_id), status: p.status || 'active' },
  ]))

  // Use admin client so join to users returns all designers' names (users RLS only allows own profile)
  const adminClient = await createAdminClient()
  if (!adminClient) return { error: 'Unable to load time entries' }
  let query = adminClient
    .from('time_entries')
    .select(`
      id,
      date,
      hours,
      notes,
      user_id,
      project_id,
      task:monday_tasks(name),
      user:users(full_name, email)
    `)
    .in('project_id', projectIds)
    .order('date', { ascending: false })

  if (filters.projectId) query = query.eq('project_id', filters.projectId)
  if (filters.userId) query = query.eq('user_id', filters.userId)
  if (filters.dateFrom) query = query.gte('date', filters.dateFrom)
  if (filters.dateTo) query = query.lte('date', filters.dateTo)

  const { data: rows, error } = await query
  if (error) return { error: error.message }

  const entries: ClientTimeEntry[] = (rows || []).map((row: any) => {
    const task = row.task || {}
    const userRow = row.user || {}
    const proj = projectMap.get(row.project_id) || { name: '', isFlexi: false, status: 'active' }
    return {
      id: row.id,
      date: row.date,
      hours: Number(row.hours),
      notes: row.notes || null,
      task_name: task.name || '',
      project_name: proj.name,
      project_id: row.project_id,
      project_status: proj.status,
      user_id: row.user_id,
      user_name: userRow.full_name || null,
      user_email: userRow.email || null,
      is_flexi: proj.isFlexi,
    }
  })

  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0)
  return { success: true, entries, totalHours }
}

/**
 * Create a share link for a client's time report (admin/manager). Returns the full URL.
 */
export async function createTimeReportShareLink(clientName: string) {
  const supabase = await createClient()
  const access = await requireAdminOrManager(supabase)
  if (!access.allowed) return { error: access.error }

  const { data: { user } } = await supabase.auth.getUser()
  const shareToken = crypto.randomBytes(32).toString('hex')

  const { data, error } = await supabase
    .from('time_report_share_links')
    .insert({
      client_name: clientName,
      share_token: shareToken,
      created_by: user?.id ?? null,
      is_active: true,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  return { success: true, shareToken }
}

/**
 * Get live time report data by share token (public, no auth). Used for shared customer view.
 */
export async function getTimeReportByToken(shareToken: string) {
  const adminClient = await createAdminClient()
  if (!adminClient) return { error: 'Service unavailable' }

  const { data: link, error: linkError } = await adminClient
    .from('time_report_share_links')
    .select('client_name, expires_at, is_active')
    .eq('share_token', shareToken)
    .single()

  if (linkError || !link) return { error: 'Invalid or expired link' }
  if (!link.is_active) return { error: 'This link is no longer active' }
  if (link.expires_at && new Date(link.expires_at) < new Date()) return { error: 'This link has expired' }

  const clientName = link.client_name as string
  const { data: projects, error: projErr } = await adminClient
    .from('monday_projects')
    .select('id, name, monday_board_id, status')
    .eq('client_name', clientName)
  if (projErr || !projects?.length) return { success: true, clientName, entries: [] as ClientTimeEntry[], totalHours: 0 }

  const flexiBoardIds = await getFlexiBoardIdsSet(adminClient)
  const projectIds = projects.map((p: { id: string }) => p.id)
  const projectMap = new Map(projects.map((p: { id: string; name: string; monday_board_id: string; status?: string }) => [
    p.id,
    { name: p.name, isFlexi: flexiBoardIds.has(p.monday_board_id), status: p.status || 'active' },
  ]))

  const { data: rows, error } = await adminClient
    .from('time_entries')
    .select(`
      id, date, hours, notes, user_id, project_id,
      task:monday_tasks(name),
      user:users(full_name, email)
    `)
    .in('project_id', projectIds)
    .order('date', { ascending: false })

  if (error) return { error: error.message }

  const entries: ClientTimeEntry[] = (rows || []).map((row: any) => {
    const task = row.task || {}
    const userRow = row.user || {}
    const proj = projectMap.get(row.project_id) || { name: '', isFlexi: false, status: 'active' }
    return {
      id: row.id,
      date: row.date,
      hours: Number(row.hours),
      notes: row.notes || null,
      task_name: task.name || '',
      project_name: proj.name,
      project_id: row.project_id,
      project_status: proj.status,
      user_id: row.user_id,
      user_name: userRow.full_name || null,
      user_email: userRow.email || null,
      is_flexi: proj.isFlexi,
    }
  })
  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0)
  return { success: true, clientName, entries, totalHours }
}
