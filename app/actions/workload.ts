'use server'

import { addDays, format, parseISO } from 'date-fns'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getMondayBoardConfig } from '@/lib/monday/board-helpers'
import { isSpeculativeProject } from '@/lib/flexi-design/speculative'
import { peopleFromMondayData, normalisePersonName } from '@/lib/monday/people'
import { scoreWorkloadPriority, sortPriorityItems, type WorkloadPriorityItem } from '@/lib/workload/priority'

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

export type { WorkloadPriorityItem, WorkloadPriorityFlag, WorkloadPace } from '@/lib/workload/priority'

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

export type WorkloadCompletedItem = {
  id: string
  name: string
  client_name: string | null
  project_name: string | null
  completed_date: string
  hours: number
  is_internal: boolean
  kind: 'project' | 'task'
}

export type WorkloadMember = {
  id: string
  full_name: string | null
  email: string
  projects: WorkloadProject[]
  priorities: WorkloadPriorityItem[]
  completed: WorkloadCompletedItem[]
  total_hours: number
}

type LiveProject = {
  id: string
  name: string
  client_name: string | null
  agency: string | null
  quoted_hours: number | null
  monday_status: string | null
  due_date: string | null
  created_at: string | null
  monday_data: Record<string, unknown> | null
}

type LiveTask = {
  id: string
  name: string
  project_id: string
  quoted_hours: number | null
  assigned_user_ids: string[] | null
  is_completed: boolean | null
  monday_data: Record<string, unknown> | null
  timeline_start: string | null
  timeline_end: string | null
}

type CompletedProject = {
  id: string
  name: string
  client_name: string | null
  agency: string | null
  quoted_hours: number | null
  completed_date: string | null
  monday_status: string | null
}

/** Same flag the timesheet uses. Null means no status column, so treat as still open. */
function isOpenTask(task: LiveTask) {
  return task.is_completed !== true
}

function isStuckProject(project: { monday_status?: string | null }) {
  return /\bstuck\b/i.test(project.monday_status ?? '')
}

function todayInUk(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
}

const COMPLETED_LOOKBACK_DAYS = 14
const COMPLETED_TASK_AHEAD_DAYS = 7
const COMPLETED_LIST_CAP = 10

function shiftIsoDate(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), 'yyyy-MM-dd')
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function inDateWindow(value: string | null | undefined, since: string, until: string): boolean {
  const day = dateOnly(value)
  return Boolean(day && day >= since && day <= until)
}

function emptyMember(member: { id: string; full_name: string | null; email: string }): WorkloadMember {
  return {
    id: member.id,
    full_name: member.full_name,
    email: member.email,
    projects: [],
    priorities: [],
    completed: [],
    total_hours: 0,
  }
}

function studioIdsFromTask(
  task: { assigned_user_ids: string[] | null; monday_data: Record<string, unknown> | null },
  studioByMondayId: Map<string, string>,
  studioByName: Map<string, string>
): string[] {
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

  return [...studioIds]
}

function sortCompletedItems(items: WorkloadCompletedItem[]): WorkloadCompletedItem[] {
  return [...items]
    .sort(
      (a, b) =>
        b.completed_date.localeCompare(a.completed_date) || a.name.localeCompare(b.name)
    )
    .slice(0, COMPLETED_LIST_CAP)
}

/**
 * Live-project workload per teammate, plus recently completed work.
 *
 * A project is on someone's plate if they are assigned to an open Monday subitem.
 * Completed tasks, speculative Flexi jobs, and Stuck projects are excluded. Bubble size
 * is project remaining hours (quoted minus logged), matching the timesheet. Recently
 * completed covers shipped projects and finished subitems from the last two weeks.
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
    if (team.length === 0) {
      return { success: true, members: [] }
    }

    const today = todayInUk()
    const completedSince = shiftIsoDate(today, -COMPLETED_LOOKBACK_DAYS)
    const completedTaskUntil = shiftIsoDate(today, COMPLETED_TASK_AHEAD_DAYS)

    const projects = boardIds.length
      ? await fetchByIdChunks<LiveProject>(
          boardIds,
          (boardChunk, from, to) =>
            supabase
              .from('monday_projects')
              .select('id, name, client_name, agency, quoted_hours, monday_status, due_date, created_at, monday_data')
              .eq('status', 'active')
              .in('monday_board_id', boardChunk)
              .order('name', { ascending: true })
              .range(from, to)
        )
      : []

    const liveProjects = projects.filter(
      (project) => !isSpeculativeProject(project) && !isStuckProject(project)
    )

    const { data: lockedRows, error: lockedError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, agency, quoted_hours, completed_date, monday_status')
      .eq('status', 'locked')
      .gte('completed_date', completedSince)
      .order('completed_date', { ascending: false })
      .limit(200)

    if (lockedError) throw lockedError

    const recentCompletedProjects = ((lockedRows ?? []) as CompletedProject[]).filter(
      (project) => !isSpeculativeProject(project) && Boolean(dateOnly(project.completed_date))
    )

    const liveProjectIds = liveProjects.map((project) => project.id)
    const completedProjectIds = recentCompletedProjects.map((project) => project.id)
    const taskProjectIds = [...new Set([...liveProjectIds, ...completedProjectIds])]

    if (taskProjectIds.length === 0) {
      return { success: true, members: team.map(emptyMember) }
    }

    const tasks = await fetchByIdChunks<LiveTask>(
      taskProjectIds,
      (idChunk, from, to) =>
        supabase
          .from('monday_tasks')
          .select(
            'id, name, project_id, quoted_hours, assigned_user_ids, is_completed, monday_data, timeline_start, timeline_end'
          )
          .in('project_id', idChunk)
          .eq('is_subtask', true)
          .range(from, to)
    )

    const timeEntries =
      liveProjectIds.length === 0
        ? []
        : await fetchByIdChunks<{
            project_id: string
            hours: number
          }>(liveProjectIds, (idChunk, from, to) =>
            supabase
              .from('time_entries')
              .select('project_id, hours')
              .in('project_id', idChunk)
              .range(from, to)
          )

    const loggedByProject: Record<string, number> = {}
    const quotedByProject: Record<string, number> = {}
    const liveProjectIdSet = new Set(liveProjectIds)

    for (const task of tasks) {
      if (!liveProjectIdSet.has(task.project_id)) continue
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
    const completedByMember = new Map<string, WorkloadCompletedItem[]>()

    const pushCompleted = (memberId: string, item: WorkloadCompletedItem) => {
      const list = completedByMember.get(memberId) ?? []
      if (list.some((existing) => existing.id === item.id)) return
      list.push(item)
      completedByMember.set(memberId, list)
    }

    const liveProjectById = new Map(liveProjects.map((project) => [project.id, project]))
    const completedProjectById = new Map(recentCompletedProjects.map((project) => [project.id, project]))

    for (const task of tasks) {
      const studioIds = studioIdsFromTask(task, studioByMondayId, studioByName)
      if (studioIds.length === 0) continue

      if (isOpenTask(task) && liveProjectIdSet.has(task.project_id)) {
        for (const studioId of studioIds) {
          const key = `${studioId}:${task.project_id}`
          if (!assignedTaskIdsByUserProject.has(key)) {
            assignedTaskIdsByUserProject.set(key, new Set())
          }
          assignedTaskIdsByUserProject.get(key)!.add(task.id)
        }
      }

      const completedProject = completedProjectById.get(task.project_id)
      if (completedProject) {
        const completedDate = dateOnly(completedProject.completed_date)
        if (completedDate) {
          for (const studioId of studioIds) {
            pushCompleted(studioId, {
              id: `project:${completedProject.id}`,
              name: completedProject.name,
              client_name: completedProject.client_name,
              project_name: null,
              completed_date: completedDate,
              hours: completedProject.quoted_hours ? Number(completedProject.quoted_hours) : 0,
              is_internal: isInternalJob(completedProject),
              kind: 'project',
            })
          }
        }
        continue
      }

      if (task.is_completed !== true) continue
      const liveProject = liveProjectById.get(task.project_id)
      if (!liveProject) continue
      if (!inDateWindow(task.timeline_end, completedSince, completedTaskUntil)) continue

      const completedDate = dateOnly(task.timeline_end)
      if (!completedDate) continue

      for (const studioId of studioIds) {
        pushCompleted(studioId, {
          id: `task:${task.id}`,
          name: task.name,
          client_name: liveProject.client_name,
          project_name: liveProject.name,
          completed_date: completedDate,
          hours: task.quoted_hours ? Number(task.quoted_hours) : 0,
          is_internal: isInternalJob(liveProject),
          kind: 'task',
        })
      }
    }

    const taskById = new Map(tasks.map((task) => [task.id, task]))
    const timelinesByProject = new Map<string, Array<{ start: string | null; end: string | null }>>()
    for (const task of tasks) {
      if (!liveProjectIdSet.has(task.project_id)) continue
      const list = timelinesByProject.get(task.project_id) ?? []
      list.push({ start: task.timeline_start, end: task.timeline_end })
      timelinesByProject.set(task.project_id, list)
    }

    const members: WorkloadMember[] = team.map((member) => {
      const projectsOnPlate: WorkloadProject[] = []
      const priorityItems: WorkloadPriorityItem[] = []

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

        const assignedTimelines = [...assignedTaskIds].map((taskId) => {
          const task = taskById.get(taskId)
          return { start: task?.timeline_start ?? null, end: task?.timeline_end ?? null }
        })

        priorityItems.push(
          scoreWorkloadPriority({
            id: project.id,
            name: project.name,
            client_name: project.client_name,
            hours,
            quotedHours,
            loggedHours,
            isInternal: isInternalJob(project),
            mondayStatus: project.monday_status,
            mondayData: project.monday_data,
            dueDate: project.due_date,
            createdAt: project.created_at,
            projectTimelines: timelinesByProject.get(project.id) ?? [],
            assignedTimelines,
            today,
          })
        )
      }

      projectsOnPlate.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
      const totalHours = projectsOnPlate.reduce((sum, project) => sum + project.hours, 0)

      return {
        id: member.id,
        full_name: member.full_name,
        email: member.email,
        projects: projectsOnPlate,
        priorities: sortPriorityItems(priorityItems),
        completed: sortCompletedItems(completedByMember.get(member.id) ?? []),
        total_hours: totalHours,
      }
    })

    return { success: true, members }
  } catch (error) {
    console.error('Error fetching team workload:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch workload' }
  }
}
