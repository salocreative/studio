/**
 * Monday.com API integration (server-side only)
 * This will be used to sync projects and tasks from Monday.com
 */

import { createClient } from '@/lib/supabase/server'

const MONDAY_API_URL = 'https://api.monday.com/v2'

export interface MondayProject {
  id: string
  name: string
  board_id: string
  client_name?: string
  status?: string
  quoted_hours?: number
  column_values?: Record<string, any>
  board_name?: string
}

export interface MondayTask {
  id: string
  name: string
  parent_item_id?: string
  assigned_user_ids?: string[]
  quoted_hours?: number
  timeline_start?: string
  timeline_end?: string
  column_values?: Record<string, any>
}

interface MondayApiResponse<T> {
  data: T
  errors?: Array<{ message: string }>
}

/**
 * Make a GraphQL request to Monday.com API
 */
async function mondayRequest<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  })

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.statusText}`)
  }

  const result: MondayApiResponse<T> = await response.json()

  if (result.errors && result.errors.length > 0) {
    throw new Error(`Monday.com API errors: ${result.errors.map((e) => e.message).join(', ')}`)
  }

  return result.data
}

/**
 * Get all boards from Monday.com
 */
async function getMondayBoards(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const query = `
    query {
      boards(limit: 100) {
        id
        name
      }
    }
  `

  const data = await mondayRequest<{ boards: Array<{ id: string; name: string }> }>(
    accessToken,
    query
  )

  return data.boards || []
}

/**
 * Get projects (items) from Monday.com boards
 */
export async function getMondayProjects(accessToken: string, includeCompletedBoards: boolean = false): Promise<MondayProject[]> {
  // Get column mappings from Supabase to determine which boards to sync
  const supabase = await createClient()
  const { data: allMappings } = await supabase
    .from('monday_column_mappings')
    .select('monday_column_id, column_type, board_id, workspace_id')
  
  if (!allMappings || allMappings.length === 0) {
    // No mappings configured, return empty array
    return []
  }
  
  // Get unique board IDs and workspace IDs from mappings (only boards with mappings)
  const mappedBoardIds = new Set<string>()
  const mappedWorkspaceIds = new Set<string>()
  allMappings?.forEach(m => {
    if (m.board_id) {
      mappedBoardIds.add(m.board_id)
    }
    if (m.workspace_id) {
      mappedWorkspaceIds.add(m.workspace_id)
    }
  })
  
  // If including completed boards, fetch those as well
  if (includeCompletedBoards) {
    const { data: completedBoards } = await supabase
      .from('monday_completed_boards')
      .select('monday_board_id')
    
    completedBoards?.forEach(cb => {
      mappedBoardIds.add(cb.monday_board_id)
    })
    
    // Also include leads board if configured (it needs column mappings too)
    const { data: leadsBoard } = await supabase
      .from('monday_leads_board')
      .select('monday_board_id')
      .maybeSingle()
    
    if (leadsBoard?.monday_board_id) {
      // Only include if it has column mappings
      const hasMappings = allMappings?.some(m => m.board_id === leadsBoard.monday_board_id)
      if (hasMappings) {
        mappedBoardIds.add(leadsBoard.monday_board_id)
      }
    }
  }
  
  // If no board-specific mappings, we can't sync (need at least one board mapped)
  if (mappedBoardIds.size === 0) {
    // Check if there are global mappings - if so, we'd need to sync all boards
    // For now, return empty - user should configure board-specific mappings
    return []
  }
  
  // Only fetch boards that have mappings
  const boardsToSync = Array.from(mappedBoardIds)
  
  // Build a map of board_id -> column_type -> column_id for quick lookup
  const columnMappingsByBoard = new Map<string, Map<string, string>>()
  
  // Add global mappings (board_id = null)
  const globalMappings = new Map<string, string>()
  allMappings?.forEach(m => {
    if (!m.board_id) {
      globalMappings.set(m.column_type, m.monday_column_id)
    }
  })
  
  // Add board-specific mappings
  allMappings?.forEach(m => {
    if (m.board_id) {
      if (!columnMappingsByBoard.has(m.board_id)) {
        columnMappingsByBoard.set(m.board_id, new Map())
      }
      columnMappingsByBoard.get(m.board_id)!.set(m.column_type, m.monday_column_id)
    }
  })
  
  // Helper to get column ID for a board (prioritize board-specific, fallback to global)
  function getColumnId(boardId: string, columnType: string): string | undefined {
    const boardMappings = columnMappingsByBoard.get(boardId)
    return boardMappings?.get(columnType) || globalMappings.get(columnType)
  }

  // Build a query to get items from all boards
  const query = `
    query($boardIds: [ID!]) {
      boards(ids: $boardIds) {
        id
        name
        items_page(limit: 500) {
          items {
            id
            name
            column_values {
              id
              text
              value
              type
            }
            board {
              id
            }
          }
        }
      }
    }
  `

  // Only query the mapped boards
  const boardIds = boardsToSync
  const data = await mondayRequest<{
    boards: Array<{
      id: string
      name: string
      items_page: {
        items: Array<{
          id: string
          name: string
          column_values: Array<{
            id: string
            text?: string
            value?: string
            type: string
          }>
          board: {
            id: string
          }
        }>
      }
    }>
  }>(accessToken, query, { boardIds })

  const projects: MondayProject[] = []

  for (const board of data.boards || []) {
    // Get client column ID for this board (from parent items)
    const clientColumnId = getColumnId(board.id, 'client')

    for (const item of board.items_page.items || []) {
      // Find client name from column values using the mapped column
      let client_name: string | undefined

      if (item.column_values && clientColumnId) {
        const clientColumn = item.column_values.find((cv) => cv.id === clientColumnId)
        if (clientColumn?.text) {
          client_name = clientColumn.text
        }
      }

      // Convert column_values to a more usable format
      const column_values: Record<string, any> = {}
      item.column_values?.forEach((cv) => {
        column_values[cv.id] = {
          text: cv.text,
          value: cv.value ? JSON.parse(cv.value) : null,
          type: cv.type,
        }
      })

      projects.push({
        id: item.id,
        name: item.name,
        board_id: board.id,
        client_name,
        board_name: board.name,
        column_values,
      })
    }
  }

  return projects
}

/**
 * Get tasks (subitems) for a specific project
 */
export async function getMondayTasks(
  accessToken: string,
  projectId: string,
  boardId?: string
): Promise<MondayTask[]> {
  // Get column mappings for subtasks (quoted_hours, timeline)
  const supabase = await createClient()
  const { data: allMappings } = await supabase
    .from('monday_column_mappings')
    .select('monday_column_id, column_type, board_id')
    .in('column_type', ['quoted_hours', 'timeline'])
  
  // Build mappings map (board-specific or global)
  let quotedHoursColumnId: string | undefined
  let timelineColumnId: string | undefined
  
  if (boardId && allMappings) {
    // Find board-specific mappings first
    const boardMappings = allMappings.filter(m => m.board_id === boardId)
    if (boardMappings.length > 0) {
      quotedHoursColumnId = boardMappings.find(m => m.column_type === 'quoted_hours')?.monday_column_id
      timelineColumnId = boardMappings.find(m => m.column_type === 'timeline')?.monday_column_id
    }
  }
  
  // Fallback to global mappings if no board-specific ones found
  if (!quotedHoursColumnId || !timelineColumnId) {
    const globalMappings = allMappings?.filter(m => !m.board_id) || []
    if (!quotedHoursColumnId) {
      quotedHoursColumnId = globalMappings.find(m => m.column_type === 'quoted_hours')?.monday_column_id
    }
    if (!timelineColumnId) {
      timelineColumnId = globalMappings.find(m => m.column_type === 'timeline')?.monday_column_id
    }
  }

  const query = `
    query($itemId: [ID!]) {
      items(ids: $itemId) {
        id
        name
        board {
          id
        }
        subitems {
          id
          name
          column_values {
            id
            text
            value
            type
          }
        }
      }
    }
  `

  const data = await mondayRequest<{
    items: Array<{
      id: string
      name: string
      board: {
        id: string
      }
      subitems: Array<{
        id: string
        name: string
        column_values: Array<{
          id: string
          text?: string
          value?: string
          type: string
        }>
      }>
    }>
  }>(accessToken, query, { itemId: [projectId] })

  const tasks: MondayTask[] = []

  for (const item of data.items || []) {
    // Use board ID from item if not provided
    const itemBoardId = item.board.id || boardId
    
    // Get mappings for this board if we have it
    let taskQuotedHoursColumnId = quotedHoursColumnId
    let taskTimelineColumnId = timelineColumnId
    
    if (itemBoardId && allMappings) {
      const boardMappings = allMappings.filter(m => m.board_id === itemBoardId)
      if (boardMappings.length > 0) {
        taskQuotedHoursColumnId = boardMappings.find(m => m.column_type === 'quoted_hours')?.monday_column_id || taskQuotedHoursColumnId
        taskTimelineColumnId = boardMappings.find(m => m.column_type === 'timeline')?.monday_column_id || taskTimelineColumnId
      }
    }
    
    for (const subitem of item.subitems || []) {
      let quoted_hours: number | undefined
      let timeline_start: string | undefined
      let timeline_end: string | undefined
      let assigned_user_ids: string[] | undefined

      if (subitem.column_values) {
        // Find quoted hours using mapped column
        if (taskQuotedHoursColumnId) {
          const quotedHoursColumn = subitem.column_values.find((cv) => cv.id === taskQuotedHoursColumnId)
          if (quotedHoursColumn) {
            // Handle different number column types
            if (quotedHoursColumn.text) {
              const numValue = parseFloat(quotedHoursColumn.text)
              if (!isNaN(numValue) && numValue > 0) {
                quoted_hours = numValue
              }
            } else if (quotedHoursColumn.value) {
              try {
                const value = JSON.parse(quotedHoursColumn.value)
                const numValue = typeof value === 'number' ? value : parseFloat(value?.toString() || '0')
                if (!isNaN(numValue) && numValue > 0) {
                  quoted_hours = numValue
                }
              } catch {
                // Ignore parsing errors
              }
            }
          }
        }

        // Find timeline using mapped column
        if (taskTimelineColumnId) {
          const timelineColumn = subitem.column_values.find((cv) => cv.id === taskTimelineColumnId)
          if (timelineColumn?.value) {
            try {
              const value = JSON.parse(timelineColumn.value)
              if (value) {
                if (value.from) timeline_start = value.from
                if (value.to) timeline_end = value.to
                // Handle different timeline formats
                if (!timeline_start && value.start) timeline_start = value.start
                if (!timeline_end && value.end) timeline_end = value.end
              }
            } catch {
              // Ignore parsing errors
            }
          }
        }

        // Try to find assigned users (people column)
        for (const col of subitem.column_values) {
          if (col.type === 'people' && col.value) {
            try {
              const value = JSON.parse(col.value)
              if (Array.isArray(value.personIds)) {
                assigned_user_ids = value.personIds
              } else if (Array.isArray(value)) {
                assigned_user_ids = value.map((v: any) => v.personId || v.id || v).filter(Boolean)
              }
            } catch {
              // Ignore parsing errors
            }
          }
        }
      }

      const column_values: Record<string, any> = {}
      subitem.column_values?.forEach((cv) => {
        column_values[cv.id] = {
          text: cv.text,
          value: cv.value ? JSON.parse(cv.value) : null,
          type: cv.type,
        }
      })

      tasks.push({
        id: subitem.id,
        name: subitem.name,
        parent_item_id: projectId,
        assigned_user_ids: assigned_user_ids?.length ? [...new Set(assigned_user_ids)] : undefined,
        quoted_hours,
        timeline_start,
        timeline_end,
        column_values,
      })
    }
  }

  return tasks
}

/**
 * Sync projects and tasks from Monday.com to Supabase
 * This should be called periodically or via webhook
 * 
 * Returns the number of projects synced
 */
export async function syncMondayData(accessToken: string): Promise<{ projectsSynced: number; archived: number; deleted: number }> {
  const supabase = await createClient()

  try {
    // 1. Fetch projects from Monday.com (from both active and completed boards)
    const mondayProjects = await getMondayProjects(accessToken, true)
    
    // Get completed board IDs
    const { data: completedBoards } = await supabase
      .from('monday_completed_boards')
      .select('monday_board_id')
    
    const completedBoardIds = new Set(completedBoards?.map(cb => cb.monday_board_id) || [])
    
    // Get leads board ID
    const { data: leadsBoard } = await supabase
      .from('monday_leads_board')
      .select('monday_board_id')
      .maybeSingle()
    
    const leadsBoardId = leadsBoard?.monday_board_id || null
    
    // Get column mappings to determine active boards
    const { data: allMappings } = await supabase
      .from('monday_column_mappings')
      .select('board_id')
      .not('board_id', 'is', null)
    
    const activeBoardIds = new Set(allMappings?.map(m => m.board_id) || [])

    // Track projects found in Monday (by monday_item_id)
    const mondayProjectIds = new Set(mondayProjects.map(p => p.id))
    
    // Get all existing projects from Supabase
    const { data: existingProjects } = await supabase
      .from('monday_projects')
      .select('id, monday_item_id, status, monday_board_id')

    let archived = 0
    let deleted = 0

    // 2. Check existing projects - archive or delete if not found in Monday
    if (existingProjects) {
      for (const existingProject of existingProjects) {
        // Skip if project still exists in Monday
        if (mondayProjectIds.has(existingProject.monday_item_id)) {
          continue
        }
        
        // Project no longer exists in Monday.com - handle deletion/archival
        // Check if project has time tracking data
        const { data: timeEntries } = await supabase
          .from('time_entries')
          .select('id')
          .eq('project_id', existingProject.id)
          .limit(1)
        
        const hasTimeEntries = timeEntries && timeEntries.length > 0
        
        if (hasTimeEntries) {
          // Archive if it has time entries (preserve data for reporting)
          // This applies to both active and locked/completed projects
          if (existingProject.status !== 'archived') {
            await supabase
              .from('monday_projects')
              .update({ status: 'archived' })
              .eq('id', existingProject.id)
            archived++
          }
        } else {
          // Delete if no time entries (no data to preserve, safe to remove)
          // This applies even to locked/completed projects that have been deleted from Monday
          await supabase
            .from('monday_projects')
            .delete()
            .eq('id', existingProject.id)
          deleted++
        }
      }
    }

    // 3. Sync projects to Supabase
    for (const project of mondayProjects) {
      // Determine status based on board
      const isActive = activeBoardIds.has(project.board_id)
      const isCompleted = completedBoardIds.has(project.board_id)
      const isLead = leadsBoardId && project.board_id === leadsBoardId
      
      // Projects on completed boards should be locked (not just archived)
      // Projects on leads board should be marked as 'lead'
      let projectStatus: 'active' | 'archived' | 'locked' | 'lead'
      if (isLead) {
        projectStatus = 'lead'
      } else if (isActive) {
        projectStatus = 'active'
      } else if (isCompleted) {
        projectStatus = 'locked'
      } else {
        projectStatus = 'archived'
      }
      
      // Check if project exists - get full record to preserve quoted_hours for locked projects
      const { data: existing } = await supabase
        .from('monday_projects')
        .select('id, status, quoted_hours')
        .eq('monday_item_id', project.id)
        .single()

      // For locked/completed projects, preserve existing quoted_hours if Monday doesn't provide it
      // This ensures historical budget data is maintained for reflection
      const preserveQuotedHours = existing?.status === 'locked' && (!project.quoted_hours || project.quoted_hours === 0)
      const finalQuotedHours = preserveQuotedHours 
        ? (existing.quoted_hours || project.quoted_hours || null)
        : (project.quoted_hours || null)

      // Handle status transitions
      // - Leads can move to active, but once active/completed they shouldn't go back to lead
      // - Locked projects stay locked (preserve time tracking data)
      // - If project was previously a lead and is now on leads board, keep it as lead
      // - If project was previously a lead and moved to active board, change to active
      let finalStatus = projectStatus
      if (existing) {
        if (existing.status === 'locked') {
          // Once locked, stay locked (preserve time tracking data)
          finalStatus = 'locked'
        } else if (existing.status === 'lead' && !isLead) {
          // Lead moved to active/completed board, update status accordingly
          finalStatus = projectStatus
        } else if (isLead) {
          // On leads board, should be 'lead' status
          finalStatus = 'lead'
        } else if (isCompleted) {
          // On completed board, should be 'locked'
          finalStatus = 'locked'
        }
      }

      const projectData = {
        monday_item_id: project.id,
        monday_board_id: project.board_id,
        name: project.name,
        client_name: project.client_name || null,
        quoted_hours: finalQuotedHours,
        monday_data: project.column_values,
        status: finalStatus,
        updated_at: new Date().toISOString(),
      }

      if (existing) {
        // Update existing project
        await supabase
          .from('monday_projects')
          .update(projectData)
          .eq('monday_item_id', project.id)
      } else {
        // Insert new project
        await supabase.from('monday_projects').insert(projectData)
      }

      // 3. Fetch and sync tasks for this project
      const { data: projectRecord } = await supabase
        .from('monday_projects')
        .select('id, status')
        .eq('monday_item_id', project.id)
        .single()

      if (projectRecord) {
        const isProjectLocked = projectRecord.status === 'locked'
        const mondayTasks = await getMondayTasks(accessToken, project.id, project.board_id)

        // Get existing tasks to preserve quoted_hours for locked projects
        const { data: existingTasks } = await supabase
          .from('monday_tasks')
          .select('id, monday_item_id, quoted_hours')
          .eq('project_id', projectRecord.id)

        // Track total quoted hours from tasks
        let totalTaskQuotedHours = 0

        for (const task of mondayTasks) {
          // For locked projects, preserve existing quoted_hours if Monday doesn't provide it
          const existingTask = existingTasks?.find(t => t.monday_item_id === task.id)
          const preserveTaskQuotedHours = isProjectLocked && existingTask && (!task.quoted_hours || task.quoted_hours === 0)
          const finalTaskQuotedHours = preserveTaskQuotedHours
            ? (existingTask.quoted_hours || task.quoted_hours || null)
            : (task.quoted_hours || null)

          // Add to total (use 0 if null)
          if (finalTaskQuotedHours) {
            totalTaskQuotedHours += finalTaskQuotedHours
          }

          const taskData = {
            monday_item_id: task.id,
            project_id: projectRecord.id,
            name: task.name,
            is_subtask: true,
            parent_task_id: null, // Can be set if there are nested subtasks
            assigned_user_ids: task.assigned_user_ids || null,
            quoted_hours: finalTaskQuotedHours,
            timeline_start: task.timeline_start || null,
            timeline_end: task.timeline_end || null,
            monday_data: task.column_values,
            updated_at: new Date().toISOString(),
          }

          // Check if task exists
          const { data: existingTaskRecord } = await supabase
            .from('monday_tasks')
            .select('id')
            .eq('monday_item_id', task.id)
            .single()

          if (existingTaskRecord) {
            await supabase
              .from('monday_tasks')
              .update(taskData)
              .eq('monday_item_id', task.id)
          } else {
            await supabase.from('monday_tasks').insert(taskData)
          }
        }

        // Update project's quoted_hours as sum of all task quoted_hours
        // For locked projects: only update if new total is greater than 0, or if existing is 0/null
        // This preserves historical budget data while still allowing updates when tasks are synced
        const shouldUpdateQuotedHours = !isProjectLocked || 
          totalTaskQuotedHours > 0 || 
          !existing?.quoted_hours || 
          existing.quoted_hours === 0
        
        if (shouldUpdateQuotedHours) {
          const updatedQuotedHours = totalTaskQuotedHours > 0 ? totalTaskQuotedHours : (existing?.quoted_hours || null)
          await supabase
            .from('monday_projects')
            .update({ 
              quoted_hours: updatedQuotedHours,
              updated_at: new Date().toISOString()
            })
            .eq('id', projectRecord.id)
        }
      }
    }

    return { 
      projectsSynced: mondayProjects.length,
      archived,
      deleted 
    }
  } catch (error) {
    console.error('Error syncing Monday.com data:', error)
    throw error
  }
}

