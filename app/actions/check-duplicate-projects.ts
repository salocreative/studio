'use server'

import { createClient } from '@/lib/supabase/server'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'
import { getFlexiDesignCompletedBoard } from './flexi-design-completed-board'

interface DuplicateProject {
  name: string
  client_name: string | null
  monday_item_id: string
  activeProject: {
    id: string
    monday_board_id: string
    status: string
    monday_item_id: string
  }
  completedProject: {
    id: string
    monday_board_id: string
    status: string
    monday_item_id: string
  }
}

export async function checkDuplicateFlexiDesignProjects() {
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

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Get Flexi-Design active board IDs
    const flexiDesignBoardIds = await getFlexiDesignBoardIds()
    
    // Get Flexi-Design completed board ID
    const completedBoardResult = await getFlexiDesignCompletedBoard()
    const completedBoardId = completedBoardResult.success && completedBoardResult.board 
      ? completedBoardResult.board.monday_board_id 
      : null

    if (flexiDesignBoardIds.size === 0 || !completedBoardId) {
      return { 
        success: true, 
        duplicates: [],
        message: 'No Flexi-Design boards configured or completed board not set'
      }
    }

    // Get all projects from active Flexi-Design boards
    const { data: activeProjects, error: activeError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, monday_item_id, monday_board_id, status')
      .in('monday_board_id', Array.from(flexiDesignBoardIds))
      .in('status', ['active', 'archived', 'locked'])

    if (activeError) throw activeError

    // Get all projects from completed Flexi-Design board
    const { data: completedProjects, error: completedError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, monday_item_id, monday_board_id, status')
      .eq('monday_board_id', completedBoardId)
      .in('status', ['active', 'archived', 'locked'])

    if (completedError) throw completedError

    // Check for duplicates by monday_item_id (shouldn't happen but let's check)
    const activeByItemId = new Map((activeProjects || []).map(p => [p.monday_item_id, p]))
    const completedByItemId = new Map((completedProjects || []).map(p => [p.monday_item_id, p]))
    
    const duplicateItemIds: string[] = []
    activeByItemId.forEach((project, itemId) => {
      if (completedByItemId.has(itemId)) {
        duplicateItemIds.push(itemId)
      }
    })

    // Check for duplicates by name and client_name (projects that appear in both)
    const duplicates: DuplicateProject[] = []
    
    if (activeProjects && completedProjects) {
      for (const activeProject of activeProjects) {
        // Find matching project in completed board by name and client_name
        const matchingCompleted = completedProjects.find(
          cp => cp.name === activeProject.name && 
          (cp.client_name || '') === (activeProject.client_name || '')
        )

        if (matchingCompleted) {
          duplicates.push({
            name: activeProject.name,
            client_name: activeProject.client_name,
            monday_item_id: activeProject.monday_item_id,
            activeProject: {
              id: activeProject.id,
              monday_board_id: activeProject.monday_board_id,
              status: activeProject.status,
              monday_item_id: activeProject.monday_item_id,
            },
            completedProject: {
              id: matchingCompleted.id,
              monday_board_id: matchingCompleted.monday_board_id,
              status: matchingCompleted.status,
              monday_item_id: matchingCompleted.monday_item_id,
            },
          })
        }
      }
    }

    // Also check for duplicate monday_item_id in the entire database
    const { data: allProjects, error: allProjectsError } = await supabase
      .from('monday_projects')
      .select('id, name, client_name, monday_item_id, monday_board_id, status')

    if (allProjectsError) throw allProjectsError

    // Group by monday_item_id to find duplicates
    const projectsByItemId = new Map<string, any[]>()
    allProjects?.forEach(p => {
      if (!projectsByItemId.has(p.monday_item_id)) {
        projectsByItemId.set(p.monday_item_id, [])
      }
      projectsByItemId.get(p.monday_item_id)!.push(p)
    })

    const duplicateItemIdsInDb = Array.from(projectsByItemId.entries())
      .filter(([_, projects]) => projects.length > 1)
      .map(([itemId]) => itemId)

    return {
      success: true,
      duplicates,
      duplicateItemIds,
      duplicateItemIdsInDb,
      stats: {
        activeProjectsCount: activeProjects?.length || 0,
        completedProjectsCount: completedProjects?.length || 0,
        duplicatesByNameCount: duplicates.length,
        duplicatesByItemIdCount: duplicateItemIds.length,
        duplicatesByItemIdInDbCount: duplicateItemIdsInDb.length,
      }
    }
  } catch (error) {
    console.error('Error checking for duplicate projects:', error)
    return { 
      error: error instanceof Error ? error.message : 'Failed to check for duplicates' 
    }
  }
}

