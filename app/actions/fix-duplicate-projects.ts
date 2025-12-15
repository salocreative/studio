'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getFlexiDesignBoardIds } from '@/lib/monday/board-helpers'
import { getFlexiDesignCompletedBoard } from './flexi-design-completed-board'

export async function fixDuplicateFlexiDesignProjects() {
  const supabase = await createClient()
  const adminSupabase = await createAdminClient()

  if (!adminSupabase) {
    return { error: 'Admin client not available. SUPABASE_SERVICE_ROLE_KEY must be configured.' }
  }

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
        error: 'No Flexi-Design boards configured or completed board not set'
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

    // Find projects that exist in both active and completed boards
    // We'll delete the ones from active boards, keeping the ones in the completed board
    // Only delete if they have the same monday_item_id (true duplicates)
    const completedItemIds = new Set((completedProjects || []).map(p => p.monday_item_id))
    const completedProjectsByItemId = new Map((completedProjects || []).map(p => [p.monday_item_id, p]))
    
    const projectsToProcess: Array<{
      activeProjectId: string
      completedProjectId: string
      mondayItemId: string
    }> = []
    
    if (activeProjects) {
      for (const activeProject of activeProjects) {
        // Check if this project exists in the completed board by monday_item_id
        // This indicates a true duplicate - the same project exists in both places
        if (completedItemIds.has(activeProject.monday_item_id)) {
          const completedProject = completedProjectsByItemId.get(activeProject.monday_item_id)!
          projectsToProcess.push({
            activeProjectId: activeProject.id,
            completedProjectId: completedProject.id,
            mondayItemId: activeProject.monday_item_id,
          })
        }
      }
    }

    let transferredTimeEntries = 0
    let transferredTasks = 0
    let deletedCount = 0
    const errors: string[] = []

    // Process each duplicate: transfer time entries and tasks, then delete
    for (const duplicate of projectsToProcess) {
      try {
        // Check if active project has time entries using admin client to see all entries
        const { data: timeEntries, error: timeEntriesError, count: timeEntriesCount } = await adminSupabase
          .from('time_entries')
          .select('id', { count: 'exact', head: false })
          .eq('project_id', duplicate.activeProjectId)

        if (timeEntriesError) {
          errors.push(`Error checking time entries for ${duplicate.mondayItemId}: ${timeEntriesError.message}`)
          continue
        }

        // IMPORTANT: Transfer tasks FIRST, then time entries
        // This ensures tasks exist in the completed project before we try to update time entries

        // Check if active project has tasks
        const { data: tasks, error: tasksError } = await adminSupabase
          .from('monday_tasks')
          .select('id, monday_item_id')
          .eq('project_id', duplicate.activeProjectId)

        if (tasksError) {
          errors.push(`Error checking tasks for ${duplicate.mondayItemId}: ${tasksError.message}`)
          continue
        }

        // Transfer tasks if they exist
        if (tasks && tasks.length > 0) {
          const { error: updateTasksError } = await adminSupabase
            .from('monday_tasks')
            .update({ project_id: duplicate.completedProjectId })
            .eq('project_id', duplicate.activeProjectId)

          if (updateTasksError) {
            errors.push(`Error transferring tasks for ${duplicate.mondayItemId}: ${updateTasksError.message}`)
            continue
          }

          // Verify the transfer completed
          const { data: remainingTasks, error: verifyTasksError } = await adminSupabase
            .from('monday_tasks')
            .select('id')
            .eq('project_id', duplicate.activeProjectId)

          if (verifyTasksError) {
            errors.push(`Error verifying tasks transfer for ${duplicate.mondayItemId}: ${verifyTasksError.message}`)
            continue
          }

          if (remainingTasks && remainingTasks.length > 0) {
            errors.push(`Failed to transfer all tasks for ${duplicate.mondayItemId}: ${remainingTasks.length} tasks still remain`)
            continue
          }

          transferredTasks += tasks.length
          console.log(`Successfully transferred ${tasks.length} tasks for ${duplicate.mondayItemId}`)
        }

        // NOW transfer time entries (tasks are already in the completed project)
        if (timeEntriesCount && timeEntriesCount > 0) {
            // Get all time entries to transfer
            const { data: timeEntriesToTransfer, error: fetchError } = await adminSupabase
              .from('time_entries')
              .select('id, task_id, user_id, project_id, date')
              .eq('project_id', duplicate.activeProjectId)

            if (fetchError) {
              errors.push(`Error fetching time entries for transfer ${duplicate.mondayItemId}: ${fetchError.message}`)
              continue
            }

            if (!timeEntriesToTransfer || timeEntriesToTransfer.length === 0) {
              // No time entries found, skip
              continue
            }

            console.log(`Transferring ${timeEntriesToTransfer.length} time entries for project ${duplicate.mondayItemId} from ${duplicate.activeProjectId} to ${duplicate.completedProjectId}`)

            // Update each time entry - tasks are already in completed project, so task_id should still be valid
            let successfullyTransferred = 0
            const transferErrors: string[] = []

            for (const timeEntry of timeEntriesToTransfer) {
              // Verify the task exists in the completed project
              const { data: taskCheck } = await adminSupabase
                .from('monday_tasks')
                .select('id')
                .eq('id', timeEntry.task_id)
                .eq('project_id', duplicate.completedProjectId)
                .maybeSingle()

              if (!taskCheck) {
                transferErrors.push(`Time entry ${timeEntry.id} references task ${timeEntry.task_id} which doesn't exist in completed project`)
                continue
              }

              // Update the project_id - task_id should already be valid since we transferred tasks
              const { error: updateError } = await adminSupabase
                .from('time_entries')
                .update({ project_id: duplicate.completedProjectId })
                .eq('id', timeEntry.id)

              if (updateError) {
                transferErrors.push(`Failed to transfer time entry ${timeEntry.id} (task: ${timeEntry.task_id}): ${updateError.message}. Code: ${(updateError as any).code}`)
                console.error(`Time entry transfer error for ${timeEntry.id}:`, updateError)
              } else {
                successfullyTransferred++
              }
            }

            if (transferErrors.length > 0) {
              errors.push(`Error transferring some time entries for ${duplicate.mondayItemId}: ${transferErrors.join('; ')}`)
              // Don't continue - we might have partially transferred, let's check
            }

            // Small delay to ensure database consistency
            await new Promise(resolve => setTimeout(resolve, 200))

            // Verify the transfer completed - check that no time entries remain on the active project
            // Use admin client to bypass RLS for verification
            const { data: remainingTimeEntries, error: verifyTimeEntriesError, count: remainingCount } = await adminSupabase
              .from('time_entries')
              .select('id', { count: 'exact', head: false })
              .eq('project_id', duplicate.activeProjectId)

            if (verifyTimeEntriesError) {
              errors.push(`Error verifying time entries transfer for ${duplicate.mondayItemId}: ${verifyTimeEntriesError.message}`)
              continue
            }

            if (remainingCount && remainingCount > 0) {
              // Get details about the remaining entries for debugging
              const { data: remainingDetails } = await adminSupabase
                .from('time_entries')
                .select('id, task_id, user_id, project_id')
                .eq('project_id', duplicate.activeProjectId)
              
              console.error(`Remaining time entries for ${duplicate.mondayItemId}:`, remainingDetails)
              errors.push(`Failed to transfer all time entries for ${duplicate.mondayItemId}: ${remainingCount} entries still remain. Remaining IDs: ${remainingDetails?.map(e => e.id).join(', ')}`)
              continue
            }

            transferredTimeEntries += successfullyTransferred
            console.log(`Successfully transferred ${successfullyTransferred} time entries for ${duplicate.mondayItemId}`)
        }


        // Final check: ensure no time entries or tasks remain before deletion
        const { count: finalTimeEntriesCount, error: finalTimeEntriesError } = await adminSupabase
          .from('time_entries')
          .select('id', { count: 'exact', head: false })
          .eq('project_id', duplicate.activeProjectId)

        const { count: finalTasksCount, error: finalTasksError } = await adminSupabase
          .from('monday_tasks')
          .select('id', { count: 'exact', head: false })
          .eq('project_id', duplicate.activeProjectId)

        if (finalTimeEntriesError) {
          errors.push(`Error checking final time entries for ${duplicate.mondayItemId}: ${finalTimeEntriesError.message}`)
          continue
        }

        if (finalTasksError) {
          errors.push(`Error checking final tasks for ${duplicate.mondayItemId}: ${finalTasksError.message}`)
          continue
        }

        if ((finalTimeEntriesCount && finalTimeEntriesCount > 0) || 
            (finalTasksCount && finalTasksCount > 0)) {
          errors.push(`Cannot delete project ${duplicate.mondayItemId}: still has ${finalTimeEntriesCount || 0} time entries and ${finalTasksCount || 0} tasks. The transfer may have failed due to database constraints or permissions.`)
          continue
        }

        // Now safe to delete the active project
        const { error: deleteError } = await adminSupabase
          .from('monday_projects')
          .delete()
          .eq('id', duplicate.activeProjectId)

        if (deleteError) {
          errors.push(`Error deleting project ${duplicate.mondayItemId}: ${deleteError.message}`)
          continue
        }

        deletedCount++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        errors.push(`Error processing ${duplicate.mondayItemId}: ${errorMsg}`)
      }
    }

    let message = `Processed ${projectsToProcess.length} duplicate(s): `
    const parts: string[] = []
    if (deletedCount > 0) parts.push(`Deleted ${deletedCount} project(s)`)
    if (transferredTimeEntries > 0) parts.push(`Transferred ${transferredTimeEntries} time entries`)
    if (transferredTasks > 0) parts.push(`Transferred ${transferredTasks} tasks`)
    message += parts.join(', ')

    if (errors.length > 0) {
      message += `. ${errors.length} error(s) occurred.`
      console.error('Errors during duplicate fix:', errors)
    }

    return {
      success: errors.length === 0,
      deletedCount,
      transferredTimeEntries,
      transferredTasks,
      errors: errors.length > 0 ? errors : undefined,
      message,
    }
  } catch (error) {
    console.error('Error fixing duplicate projects:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { 
      error: `Failed to fix duplicates: ${errorMessage}` 
    }
  }
}

