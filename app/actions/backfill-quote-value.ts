'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Backfill quote_value from monday_data for existing projects
 * This should be run once after configuring quote_value column mappings
 */
export async function backfillQuoteValue() {
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
    // Get all quote_value column mappings
    const { data: mappings, error: mappingsError } = await supabase
      .from('monday_column_mappings')
      .select('*')
      .eq('column_type', 'quote_value')

    if (mappingsError) throw mappingsError

    if (!mappings || mappings.length === 0) {
      return { error: 'No quote_value column mappings found. Please configure them first.' }
    }

    // Get all projects with monday_data but null quote_value
    const { data: projects, error: projectsError } = await supabase
      .from('monday_projects')
      .select('id, monday_board_id, quote_value, monday_data')
      .not('monday_data', 'is', null)

    if (projectsError) throw projectsError

    let updated = 0
    let skipped = 0
    let errors = 0

    for (const project of projects || []) {
      // Skip if already has quote_value
      if (project.quote_value !== null) {
        skipped++
        continue
      }

      // Find mapping for this board
      const boardMapping = mappings.find((m: any) => m.board_id === project.monday_board_id)
      const globalMapping = mappings.find((m: any) => !m.board_id)
      const usedMapping = boardMapping || globalMapping

      if (!usedMapping) {
        skipped++
        continue
      }

      // Extract quote_value from monday_data
      const columnData = project.monday_data?.[usedMapping.monday_column_id]
      if (!columnData) {
        skipped++
        continue
      }

      let quoteValue: number | null = null

      // Try to extract the value (same logic as sync)
      if (columnData.value !== null && columnData.value !== undefined) {
        if (typeof columnData.value === 'number') {
          quoteValue = columnData.value
        } else if (typeof columnData.value === 'object' && columnData.value.value !== undefined) {
          const numValue = typeof columnData.value.value === 'number'
            ? columnData.value.value
            : parseFloat(String(columnData.value.value))
          if (!isNaN(numValue)) {
            quoteValue = numValue
          }
        } else if (typeof columnData.value === 'string') {
          const numValue = parseFloat(columnData.value)
          if (!isNaN(numValue)) {
            quoteValue = numValue
          }
        } else {
          const numValue = parseFloat(String(columnData.value))
          if (!isNaN(numValue)) {
            quoteValue = numValue
          }
        }
      } else if (columnData.text) {
        const textValue = parseFloat(columnData.text.replace(/[£,$,\s]/g, ''))
        if (!isNaN(textValue)) {
          quoteValue = textValue
        }
      }

      if (quoteValue !== null && !isNaN(quoteValue)) {
        // Update the project
        const { error: updateError } = await supabase
          .from('monday_projects')
          .update({ quote_value: quoteValue })
          .eq('id', project.id)

        if (updateError) {
          console.error(`Error updating project ${project.id}:`, updateError)
          errors++
        } else {
          updated++
        }
      } else {
        skipped++
      }
    }

    return {
      success: true,
      updated,
      skipped,
      errors,
      total: (projects || []).length,
      message: `Updated ${updated} projects, skipped ${skipped}, ${errors} errors`,
    }
  } catch (error) {
    console.error('Error backfilling quote_value:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to backfill quote_value',
    }
  }
}

