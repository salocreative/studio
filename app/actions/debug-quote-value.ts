'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Debug function to check quote_value column mappings and sample data
 */
export async function debugQuoteValueMapping() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    // 1. Get all quote_value column mappings
    const { data: mappings, error: mappingsError } = await supabase
      .from('monday_column_mappings')
      .select('*')
      .eq('column_type', 'quote_value')

    if (mappingsError) throw mappingsError

    // 2. Get a few sample projects with their monday_data
    const { data: projects, error: projectsError } = await supabase
      .from('monday_projects')
      .select('id, name, monday_board_id, quote_value, monday_data')
      .limit(5)

    if (projectsError) throw projectsError

    // 3. Check if projects have quote_value in monday_data
    const projectAnalysis = (projects || []).map((project: any) => {
      const analysis: any = {
        id: project.id,
        name: project.name,
        boardId: project.monday_board_id,
        currentQuoteValue: project.quote_value,
        mondayDataKeys: project.monday_data ? Object.keys(project.monday_data) : [],
      }

      // Find mapping for this board
      const boardMapping = mappings?.find((m: any) => m.board_id === project.monday_board_id)
      const globalMapping = mappings?.find((m: any) => !m.board_id)

      analysis.mapping = {
        boardSpecific: boardMapping ? {
          columnId: boardMapping.monday_column_id,
          boardId: boardMapping.board_id,
        } : null,
        global: globalMapping ? {
          columnId: globalMapping.monday_column_id,
        } : null,
        used: boardMapping || globalMapping || null,
      }

      // Try to extract quote_value from monday_data
      const usedMapping = boardMapping || globalMapping
      if (usedMapping && project.monday_data) {
        const columnData = project.monday_data[usedMapping.monday_column_id]
        analysis.extraction = {
          columnId: usedMapping.monday_column_id,
          columnData: columnData ? {
            type: columnData.type,
            text: columnData.text,
            value: columnData.value,
            valueType: typeof columnData.value,
          } : null,
        }

        // Try to parse the value
        if (columnData) {
          let parsedValue: number | null = null
          
          if (columnData.value !== null && columnData.value !== undefined) {
            if (typeof columnData.value === 'number') {
              parsedValue = columnData.value
            } else if (typeof columnData.value === 'object' && columnData.value.value !== undefined) {
              parsedValue = typeof columnData.value.value === 'number'
                ? columnData.value.value
                : parseFloat(String(columnData.value.value))
            } else if (typeof columnData.value === 'string') {
              parsedValue = parseFloat(columnData.value)
            } else {
              parsedValue = parseFloat(String(columnData.value))
            }
            
            if (isNaN(parsedValue)) {
              parsedValue = null
            }
          } else if (columnData.text) {
            const textValue = parseFloat(columnData.text.replace(/[£,$,\s]/g, ''))
            parsedValue = isNaN(textValue) ? null : textValue
          }

          analysis.extraction.parsedValue = parsedValue
        }
      }

      return analysis
    })

    return {
      success: true,
      mappings: mappings || [],
      projectAnalysis,
      summary: {
        totalMappings: mappings?.length || 0,
        boardSpecificMappings: mappings?.filter((m: any) => m.board_id).length || 0,
        globalMappings: mappings?.filter((m: any) => !m.board_id).length || 0,
        projectsAnalyzed: projectAnalysis.length,
        projectsWithMapping: projectAnalysis.filter((p: any) => p.mapping.used).length,
        projectsWithExtractedValue: projectAnalysis.filter((p: any) => p.extraction?.parsedValue !== null && p.extraction?.parsedValue !== undefined).length,
      },
    }
  } catch (error) {
    console.error('Error debugging quote_value:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to debug quote_value mapping',
    }
  }
}

