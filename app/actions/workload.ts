'use server'

import { addDays, format, parseISO } from 'date-fns'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getMondayBoardConfig } from '@/lib/monday/board-helpers'
import { isSpeculativeProject } from '@/lib/flexi-design/speculative'
import { peopleFromMondayData, normalisePersonName, mondayAssigneeCount } from '@/lib/monday/people'
import { scoreWorkloadPriority, sortPriorityItems, type WorkloadPriorityItem } from '@/lib/workload/priority'
import { buildLeaveFractionByUserDate, loadCapacityReducingLeave } from '@/lib/holidays/working-days'
import {
  allocateHoursToWeeks,
  emptyWeekPeaks,
  remainingTimelineDays,
  workloadHorizonEnd,
  workloadWeekStarts,
  type WorkloadWeekPeak,
} from '@/lib/workload/week-peaks'

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
export type { WorkloadWeekPeak } from '@/lib/workload/week-peaks'

export type WorkloadProject = {
  id: string
  name: string
  client_name: string | null
  hours: number
  quoted_hours: number
  logged_hours: number
  progress: number
  is_internal: boolean
  is_lead: boolean
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
  weeks: WorkloadWeekPeak[]
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

type LeadProject = {
  id: string
  name: string
  client_name: string | null
  agency: string | null
  quoted_hours: number | null
  monday_status: string | null
  monday_data: Record<string, unknown> | null
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

function emptyMember(
  member: { id: string; full_name: string | null; email: string },
  weeks: WorkloadWeekPeak[] = []
): WorkloadMember {
  return {
    id: member.id,
    full_name: member.full_name,
    email: member.email,
    projects: [],
    priorities: [],
    completed: [],
    weeks,
    total_hours: 0,
  }
}

function studioIdsFromPeople(
  input: { assigned_user_ids?: string[] | null; monday_data: Record<string, unknown> | null },
  studioByMondayId: Map<string, string>,
  studioByName: Map<string, string>
): string[] {
  const fromData = peopleFromMondayData(input.monday_data)
  const storedIds = (input.assigned_user_ids || []).map(String).filter(Boolean)
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

function leadStatusAllowed(
  status: string | null,
  included: string[],
  excluded: string[]
) {
  if (!status) return true
  if (included.length > 0) return included.includes(status)
  if (excluded.length > 0) return !excluded.includes(status)
  return true
}

/**
 * Live-project workload per teammate, plus recently completed work.
 *
 * A project is on someone's plate if they are assigned to an open Monday subitem.
 * Leads appear when a teammate is named on the lead (or its subitems). Completed tasks,
 * speculative Flexi jobs, and Stuck projects are excluded. Bubble size is remaining hours
 * on that person's assigned subitems, not the whole job. Shared subitems split quoted
 * hours equally across everyone named on the task. Lead bubbles use the same subitem split
 * when the lead has quoted subitems. Weekly bars spread remaining dated hours across this week
 * and the next two, against each person's capacity; turning leads on adds three further weeks.
 * Recently completed covers shipped projects and finished subitems from the last two weeks.
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
      .select('id, full_name, email, monday_user_id, expected_utilization_percentage')
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
    const weekStarts = workloadWeekStarts(today)
    const leaveByUserDate = buildLeaveFractionByUserDate(
      await loadCapacityReducingLeave(adminClient, today, workloadHorizonEnd(weekStarts))
    )
    const weeksByMember = new Map(
      team.map((member) => [
        member.id,
        emptyWeekPeaks(
          weekStarts,
          today,
          member.expected_utilization_percentage,
          leaveByUserDate[member.id] || {}
        ),
      ])
    )

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

    const [{ data: leadRows, error: leadsError }, { data: leadStatusConfig }] = await Promise.all([
      supabase
        .from('monday_projects')
        .select('id, name, client_name, agency, quoted_hours, monday_status, monday_data')
        .eq('status', 'lead')
        .order('name', { ascending: true }),
      supabase
        .from('leads_status_config')
        .select('included_statuses, excluded_statuses')
        .limit(1)
        .maybeSingle(),
    ])

    if (leadsError && leadsError.code !== '42P01' && !leadsError.message?.includes('schema cache')) {
      throw leadsError
    }

    const includedLeadStatuses = (leadStatusConfig?.included_statuses as string[] | null) ?? []
    const excludedLeadStatuses = (leadStatusConfig?.excluded_statuses as string[] | null) ?? []
    const leadProjects = ((leadRows ?? []) as LeadProject[]).filter(
      (project) =>
        !isSpeculativeProject(project) &&
        leadStatusAllowed(project.monday_status, includedLeadStatuses, excludedLeadStatuses)
    )

    const liveProjectIds = liveProjects.map((project) => project.id)
    const completedProjectIds = recentCompletedProjects.map((project) => project.id)
    const leadProjectIds = leadProjects.map((project) => project.id)
    const taskProjectIds = [...new Set([...liveProjectIds, ...completedProjectIds, ...leadProjectIds])]

    if (taskProjectIds.length === 0) {
      return {
        success: true,
        members: team.map((member) => emptyMember(member, weeksByMember.get(member.id))),
      }
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

    const hoursProjectIds = [...new Set([...liveProjectIds, ...leadProjectIds])]
    const timeEntries =
      hoursProjectIds.length === 0
        ? []
        : await fetchByIdChunks<{
            task_id: string
            user_id: string
            project_id: string
            hours: number
          }>(hoursProjectIds, (idChunk, from, to) =>
            supabase
              .from('time_entries')
              .select('task_id, user_id, project_id, hours')
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
    const allocatedByUserProject = new Map<string, number>()
    const completedByMember = new Map<string, WorkloadCompletedItem[]>()
    const leadAssignees = new Map<string, Set<string>>()
    const peakAssignments: Array<{
      studioId: string
      taskId: string
      share: number
      isLead: boolean
      timelineStart: string | null
      timelineEnd: string | null
    }> = []

    const pushCompleted = (memberId: string, item: WorkloadCompletedItem) => {
      const list = completedByMember.get(memberId) ?? []
      if (list.some((existing) => existing.id === item.id)) return
      list.push(item)
      completedByMember.set(memberId, list)
    }

    const liveProjectById = new Map(liveProjects.map((project) => [project.id, project]))
    const completedProjectById = new Map(recentCompletedProjects.map((project) => [project.id, project]))
    const leadIdSet = new Set(leadProjectIds)

    for (const task of tasks) {
      const studioIds = studioIdsFromPeople(task, studioByMondayId, studioByName)
      if (studioIds.length === 0) continue

      if (leadIdSet.has(task.project_id)) {
        const assigned = leadAssignees.get(task.project_id) ?? new Set<string>()
        for (const studioId of studioIds) assigned.add(studioId)
        leadAssignees.set(task.project_id, assigned)
        if (isOpenTask(task)) {
          const quotedHours = task.quoted_hours ? Number(task.quoted_hours) : 0
          const headcount = Math.max(
            studioIds.length,
            mondayAssigneeCount(task.monday_data, task.assigned_user_ids)
          )
          const share = quotedHours / headcount
          for (const studioId of studioIds) {
            const key = `${studioId}:${task.project_id}`
            if (!assignedTaskIdsByUserProject.has(key)) {
              assignedTaskIdsByUserProject.set(key, new Set())
            }
            assignedTaskIdsByUserProject.get(key)!.add(task.id)
            allocatedByUserProject.set(key, (allocatedByUserProject.get(key) || 0) + share)
            peakAssignments.push({
              studioId,
              taskId: task.id,
              share,
              isLead: true,
              timelineStart: task.timeline_start,
              timelineEnd: task.timeline_end,
            })
          }
        }
        continue
      }

      if (isOpenTask(task) && liveProjectIdSet.has(task.project_id)) {
        const quotedHours = task.quoted_hours ? Number(task.quoted_hours) : 0
        const headcount = Math.max(
          studioIds.length,
          mondayAssigneeCount(task.monday_data, task.assigned_user_ids)
        )
        const share = quotedHours / headcount
        for (const studioId of studioIds) {
          const key = `${studioId}:${task.project_id}`
          if (!assignedTaskIdsByUserProject.has(key)) {
            assignedTaskIdsByUserProject.set(key, new Set())
          }
          assignedTaskIdsByUserProject.get(key)!.add(task.id)
          allocatedByUserProject.set(key, (allocatedByUserProject.get(key) || 0) + share)
          peakAssignments.push({
            studioId,
            taskId: task.id,
            share,
            isLead: false,
            timelineStart: task.timeline_start,
            timelineEnd: task.timeline_end,
          })
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

    const loggedByUserProject = new Map<string, number>()
    const loggedByUserTask = new Map<string, number>()
    for (const entry of timeEntries) {
      const projectKey = `${entry.user_id}:${entry.project_id}`
      const assignedTaskIds = assignedTaskIdsByUserProject.get(projectKey)
      if (!assignedTaskIds || !assignedTaskIds.has(entry.task_id)) continue
      const hours = Number(entry.hours) || 0
      loggedByUserProject.set(projectKey, (loggedByUserProject.get(projectKey) || 0) + hours)
      const taskKey = `${entry.user_id}:${entry.task_id}`
      loggedByUserTask.set(taskKey, (loggedByUserTask.get(taskKey) || 0) + hours)
    }

    for (const assignment of peakAssignments) {
      if (!assignment.timelineStart && !assignment.timelineEnd) continue
      const logged = loggedByUserTask.get(`${assignment.studioId}:${assignment.taskId}`) || 0
      const remaining = assignment.share > 0 ? Math.max(0, assignment.share - logged) : 0
      if (remaining <= 0) continue

      const days = remainingTimelineDays(assignment.timelineStart, assignment.timelineEnd, today)
      const buckets = allocateHoursToWeeks(remaining, days, weekStarts)
      const weeks = weeksByMember.get(assignment.studioId)
      if (!weeks) continue
      for (let index = 0; index < buckets.length; index++) {
        if (assignment.isLead) {
          weeks[index].leadHours += buckets[index]
        } else {
          weeks[index].liveHours += buckets[index]
        }
        weeks[index].hours = weeks[index].liveHours + weeks[index].leadHours
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

        const allocationKey = `${member.id}:${project.id}`
        const quotedHours = allocatedByUserProject.get(allocationKey) || 0
        const loggedHours = loggedByUserProject.get(allocationKey) || 0
        const hours = quotedHours > 0 ? Math.max(0, quotedHours - loggedHours) : 0
        const progress =
          quotedHours > 0
            ? Math.min(1, Math.max(0, loggedHours / quotedHours))
            : loggedHours > 0
              ? 1
              : 0

        const projectQuoted = quotedByProject[project.id] || (project.quoted_hours ? Number(project.quoted_hours) : 0)
        const projectLogged = loggedByProject[project.id] || 0

        projectsOnPlate.push({
          id: project.id,
          name: project.name,
          client_name: project.client_name,
          hours,
          quoted_hours: quotedHours,
          logged_hours: loggedHours,
          progress,
          is_internal: isInternalJob(project),
          is_lead: false,
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
            quotedHours: projectQuoted,
            loggedHours: projectLogged,
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

      for (const lead of leadProjects) {
        const assigned = new Set(leadAssignees.get(lead.id) ?? [])
        for (const studioId of studioIdsFromPeople(lead, studioByMondayId, studioByName)) {
          assigned.add(studioId)
        }
        if (!assigned.has(member.id)) continue

        const allocationKey = `${member.id}:${lead.id}`
        const fromSubitems = allocatedByUserProject.get(allocationKey) || 0
        const quotedHours =
          fromSubitems > 0
            ? fromSubitems
            : lead.quoted_hours
              ? Number(lead.quoted_hours) / Math.max(assigned.size, 1)
              : 0
        const loggedHours = loggedByUserProject.get(allocationKey) || 0
        const hours = quotedHours > 0 ? Math.max(0, quotedHours - loggedHours) : 0
        const progress =
          quotedHours > 0
            ? Math.min(1, Math.max(0, loggedHours / quotedHours))
            : loggedHours > 0
              ? 1
              : 0

        projectsOnPlate.push({
          id: lead.id,
          name: lead.name,
          client_name: lead.client_name,
          hours,
          quoted_hours: quotedHours,
          logged_hours: loggedHours,
          progress,
          is_internal: isInternalJob(lead),
          is_lead: true,
        })
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
        weeks: weeksByMember.get(member.id) ?? emptyWeekPeaks(weekStarts, today, null, {}),
        total_hours: totalHours,
      }
    })

    return { success: true, members }
  } catch (error) {
    console.error('Error fetching team workload:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch workload' }
  }
}
