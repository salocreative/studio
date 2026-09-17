'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getMondayBoardConfig } from '@/lib/monday/board-helpers'
import { isSpeculativeProject } from '@/lib/flexi-design/speculative'
import { peopleFromMondayData, normalisePersonName } from '@/lib/monday/people'

const SALO_CREATIVE = 'salo creative'

/** PostgREST puts `.in()` values in the query string; too many UUIDs overflow Node's header limit. */
const IN_FILTER_CHUNK_SIZE = 80
const PAGE_SIZE = 500

type QueryPageResult<T> = { data: T[] | null; error: { message: string } | null }

async function fetchByIdChunks<T>(
  ids: string[],
  queryPage: (chunk: string[], from: number, to: number) => PromiseLike<QueryPageResult<T>>
): Promise<T[]> {
  const rows: T[] = []
  for (let i = 0; i < ids.length; i += IN_FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_FILTER_CHUNK_SIZE)
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await queryPage(chunk, from, from + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      const page = data ?? []
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  }
  return rows
}

function isSaloCreative(value: string | null | undefined) {
  return value?.trim().toLowerCase() === SALO_CREATIVE
}

/** Internal jobs have Salo Creative as both the client and the agency. */
function isInternalJob(project: { client_name: string | null; agency: string | null }) {
  return isSaloCreative(project.client_name) && isSaloCreative(project.agency)
}

export type WorkloadProject = {
  id: string
  name: string
  client_name: string | null
  hours: number
  quoted_hours: number
  logged_hours: number
  progress: number
  is_internal: boolean
}

export type WorkloadMember = {
  id: string
  full_name: string | null
  email: string
  projects: WorkloadProject[]
  total_hours: number
}

type LiveProject = {
  id: string
  name: string
  client_name: string | null
  agency: string | null
  quoted_hours: number | null
  monday_status: string | null
}

type LiveTask = {
  id: string
  project_id: string
  quoted_hours: number | null
  assigned_user_ids: string[] | null
  is_completed: boolean | null
  monday_data: Record<string, unknown> | null
}

/** Same flag the timesheet uses. Null means no status column, so treat as still open. */
function isOpenTask(task: LiveTask) {
  return task.is_completed !== true
}

function isStuckProject(project: { monday_status?: string | null }) {
  return /\bstuck\b/i.test(project.monday_status ?? '')
}

/**
 * Live-project workload per teammate.
 *
 * A project is on someone's plate if they are assigned to an open Monday subitem.
 * Completed tasks, speculative Flexi jobs, and Stuck projects are excluded. Bubble size
 * is project remaining hours (quoted minus logged), matching the timesheet.
 */
export async function getTeamWorkload(): Promise<
  { success: true; members: WorkloadMember[] } | { error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin API not available. Please configure SUPABASE_SERVICE_ROLE_KEY.' }
  }

  try {
    const { mainBoardIds, flexiBoardIds } = await getMondayBoardConfig()
    const boardIds = [...new Set([...mainBoardIds, ...flexiBoardIds])]

    const { data: users, error: usersError } = await adminClient
      .from('users')
      .select('id, full_name, email, monday_user_id')
      .eq('exclude_from_utilization', false)
      .is('deleted_at', null)
      .order('full_name', { ascending: true, nullsFirst: false })

    if (usersError) throw usersError

    const team = users ?? []
    if (team.length === 0 || boardIds.length === 0) {
      return { success: true, members: [] }
    }

    const projects = await fetchByIdChunks<LiveProject>(
      boardIds,
      (boardChunk, from, to) =>
        supabase
          .from('monday_projects')
          .select('id, name, client_name, agency, quoted_hours, monday_status')
          .eq('status', 'active')
          .in('monday_board_id', boardChunk)
          .order('name', { ascending: true })
          .range(from, to)
    )

    const liveProjects = projects.filter(
      (project) => !isSpeculativeProject(project) && !isStuckProject(project)
    )

    if (liveProjects.length === 0) {
      return {
        success: true,
        members: team.map((member) => ({
          id: member.id,
          full_name: member.full_name,
          email: member.email,
          projects: [],
          total_hours: 0,
        })),
      }
    }

    const projectIds = liveProjects.map((project) => project.id)

    const tasks = await fetchByIdChunks<LiveTask>(
      projectIds,
      (idChunk, from, to) =>
        supabase
          .from('monday_tasks')
          .select('id, project_id, quoted_hours, assigned_user_ids, is_completed, monday_data')
          .in('project_id', idChunk)
          .eq('is_subtask', true)
          .range(from, to)
    )

    const timeEntries = await fetchByIdChunks<{
      project_id: string
      hours: number
    }>(projectIds, (idChunk, from, to) =>
      supabase
        .from('time_entries')
        .select('project_id, hours')
        .in('project_id', idChunk)
        .range(from, to)
    )

    const loggedByProject: Record<string, number> = {}
    const quotedByProject: Record<string, number> = {}

    for (const task of tasks) {
      quotedByProject[task.project_id] =
        (quotedByProject[task.project_id] || 0) + (task.quoted_hours ? Number(task.quoted_hours) : 0)
    }

    for (const entry of timeEntries) {
      loggedByProject[entry.project_id] =
        (loggedByProject[entry.project_id] || 0) + (Number(entry.hours) || 0)
    }

    const studioByMondayId = new Map<string, string>()
    const studioByName = new Map<string, string>()
    for (const member of team) {
      if (member.monday_user_id) {
        studioByMondayId.set(String(member.monday_user_id), member.id)
      }
      const name = normalisePersonName(member.full_name)
      if (name && !studioByName.has(name)) {
        studioByName.set(name, member.id)
      }
    }

    const assignedTaskIdsByUserProject = new Map<string, Set<string>>()
    for (const task of tasks) {
      if (!isOpenTask(task)) continue

      const fromData = peopleFromMondayData(task.monday_data)
      const storedIds = (task.assigned_user_ids || []).map(String).filter(Boolean)
      const mondayIds = fromData.ids.length > 0 ? fromData.ids : storedIds
      const studioIds = new Set<string>()

      for (const mondayId of mondayIds) {
        const studioId = studioByMondayId.get(String(mondayId))
        if (studioId) studioIds.add(studioId)
      }
      for (const name of fromData.names) {
        const studioId = studioByName.get(normalisePersonName(name))
        if (studioId) studioIds.add(studioId)
      }

      for (const studioId of studioIds) {
        const key = `${studioId}:${task.project_id}`
        if (!assignedTaskIdsByUserProject.has(key)) {
          assignedTaskIdsByUserProject.set(key, new Set())
        }
        assignedTaskIdsByUserProject.get(key)!.add(task.id)
      }
    }

    const members: WorkloadMember[] = team.map((member) => {
      const projectsOnPlate: WorkloadProject[] = []

      for (const project of liveProjects) {
        const assignedTaskIds = assignedTaskIdsByUserProject.get(`${member.id}:${project.id}`)
        if (!assignedTaskIds || assignedTaskIds.size === 0) continue

        const taskQuoted = quotedByProject[project.id] || 0
        const quotedHours =
          taskQuoted > 0
            ? taskQuoted
            : project.quoted_hours
              ? Number(project.quoted_hours)
              : 0
        const loggedHours = loggedByProject[project.id] || 0
        const hours = quotedHours > 0 ? Math.max(0, quotedHours - loggedHours) : 0
        const progress =
          quotedHours > 0
            ? Math.min(1, Math.max(0, loggedHours / quotedHours))
            : loggedHours > 0
              ? 1
              : 0

        projectsOnPlate.push({
          id: project.id,
          name: project.name,
          client_name: project.client_name,
          hours,
          quoted_hours: quotedHours,
          logged_hours: loggedHours,
          progress,
          is_internal: isInternalJob(project),
        })
      }

      projectsOnPlate.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
      const totalHours = projectsOnPlate.reduce((sum, project) => sum + project.hours, 0)

      return {
        id: member.id,
        full_name: member.full_name,
        email: member.email,
        projects: projectsOnPlate,
        total_hours: totalHours,
      }
    })

    return { success: true, members }
  } catch (error) {
    console.error('Error fetching team workload:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch workload' }
  }
}
