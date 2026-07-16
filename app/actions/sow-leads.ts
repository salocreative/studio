'use server'

import { createClient } from '@/lib/supabase/server'
import type { SowLineItemInput } from '@/lib/sow/calculations'

export interface SowLeadOption {
  id: string
  name: string
  client_name: string | null
  agency: string | null
  monday_status: string | null
}

export interface SowLeadImportData {
  monday_project_id: string
  monday_item_id: string
  monday_board_id: string | null
  title: string
  client_name: string
  agency_name: string | null
  customer_type: 'partner' | 'client'
  line_items: SowLineItemInput[]
}

async function requireTeamMember() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, supabase: null }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  if (
    !profile ||
    (profile.role !== 'admin' && profile.role !== 'designer' && profile.role !== 'manager')
  ) {
    return { error: 'Unauthorized' as const, supabase: null }
  }

  return { supabase, error: null as null }
}

export async function getSowLeadsForImport() {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data, error } = await auth.supabase
      .from('monday_projects')
      .select('id, name, client_name, agency, monday_status')
      .eq('status', 'lead')
      .order('name', { ascending: true })

    if (error) throw error

    return { success: true, leads: (data || []) as SowLeadOption[] }
  } catch (error) {
    console.error('Error fetching leads for SoW import:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch leads' }
  }
}

export async function getSowLeadImportData(projectId: string) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  try {
    const { data: project, error: projectError } = await auth.supabase
      .from('monday_projects')
      .select('id, monday_item_id, monday_board_id, name, client_name, agency, status')
      .eq('id', projectId)
      .eq('status', 'lead')
      .single()

    if (projectError || !project) {
      return { error: 'Lead not found on the leads board' }
    }

    const { data: tasks, error: tasksError } = await auth.supabase
      .from('monday_tasks')
      .select('name, quoted_hours')
      .eq('project_id', projectId)
      .order('name', { ascending: true })

    if (tasksError) throw tasksError

    const agency = project.agency?.trim() || null
    const lineItems: SowLineItemInput[] = (tasks || []).map((task) => ({
      title: task.name,
      description: null,
      quantity: task.quoted_hours ? Number(task.quoted_hours) : 0,
      is_days: false,
    }))

    const importData: SowLeadImportData = {
      monday_project_id: project.id,
      monday_item_id: project.monday_item_id,
      monday_board_id: project.monday_board_id,
      title: project.name,
      client_name: project.client_name?.trim() || '',
      agency_name: agency,
      customer_type: agency ? 'partner' : 'client',
      line_items: lineItems.length > 0 ? lineItems : [],
    }

    return { success: true, data: importData }
  } catch (error) {
    console.error('Error importing lead for SoW:', error)
    return { error: error instanceof Error ? error.message : 'Failed to import lead' }
  }
}
