'use server'

import { createClient } from '@/lib/supabase/server'

export interface FlexiDesignService {
  id: string
  category: string
  title: string
  description: string
  credit_estimate: number
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type FlexiDesignServiceInput = {
  category: string
  title: string
  description: string
  credit_estimate: number
  sort_order?: number
  is_active?: boolean
}

async function requireTeamMember() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const, supabase: null, role: null }

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
    return { error: 'Unauthorized' as const, supabase: null, role: null }
  }

  return {
    supabase,
    role: profile.role as 'admin' | 'designer' | 'manager',
    error: null as null,
  }
}

function validateInput(input: FlexiDesignServiceInput): string | null {
  if (!input.category.trim()) return 'Category is required'
  if (!input.title.trim()) return 'Title is required'
  const credits = Number(input.credit_estimate)
  if (Number.isNaN(credits) || credits < 0) return 'Credit estimate must be zero or greater'
  return null
}

function toDbRow(input: FlexiDesignServiceInput) {
  return {
    category: input.category.trim(),
    title: input.title.trim(),
    description: input.description.trim(),
    credit_estimate: Math.round(Number(input.credit_estimate) * 100) / 100,
    sort_order:
      input.sort_order === undefined || input.sort_order === null
        ? 0
        : Math.max(0, Math.floor(Number(input.sort_order))),
    is_active: input.is_active ?? true,
  }
}

export async function listFlexiDesignServices(options?: { includeInactive?: boolean }) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }

  const includeInactive = options?.includeInactive === true && auth.role === 'admin'

  try {
    let query = auth.supabase
      .from('flexi_design_services')
      .select('*')

    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query
    if (error) throw error

    const services = ((data || []) as FlexiDesignService[])
      .map((service) => ({
        ...service,
        credit_estimate: Number(service.credit_estimate),
        sort_order: Number(service.sort_order),
      }))
      .sort((a, b) => {
        const categoryCompare = a.category.localeCompare(b.category)
        if (categoryCompare !== 0) return categoryCompare
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
        return a.title.localeCompare(b.title)
      })

    return {
      success: true,
      services,
      canManage: auth.role === 'admin',
    }
  } catch (error) {
    console.error('Error listing Flexi-Design services:', error)
    return {
      error:
        error instanceof Error ? error.message : 'Failed to list Flexi-Design services',
    }
  }
}

export async function createFlexiDesignService(input: FlexiDesignServiceInput) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }
  if (auth.role !== 'admin') return { error: 'Only admins can manage services' }

  const validationError = validateInput(input)
  if (validationError) return { error: validationError }

  try {
    const row = toDbRow({
      ...input,
      sort_order: input.sort_order ?? undefined,
    })

    if (input.sort_order === undefined || input.sort_order === null) {
      const { data: existing } = await auth.supabase
        .from('flexi_design_services')
        .select('sort_order')
        .eq('category', row.category)
        .order('sort_order', { ascending: false })
        .limit(1)

      row.sort_order = (existing?.[0]?.sort_order ?? 0) + 1
    }

    const { data, error } = await auth.supabase
      .from('flexi_design_services')
      .insert(row)
      .select()
      .single()

    if (error) throw error
    return { success: true, service: data as FlexiDesignService }
  } catch (error) {
    console.error('Error creating Flexi-Design service:', error)
    return {
      error:
        error instanceof Error ? error.message : 'Failed to create Flexi-Design service',
    }
  }
}

export async function updateFlexiDesignService(id: string, input: FlexiDesignServiceInput) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }
  if (auth.role !== 'admin') return { error: 'Only admins can manage services' }
  if (!id) return { error: 'Service id is required' }

  const validationError = validateInput(input)
  if (validationError) return { error: validationError }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_services')
      .update(toDbRow(input))
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return { success: true, service: data as FlexiDesignService }
  } catch (error) {
    console.error('Error updating Flexi-Design service:', error)
    return {
      error:
        error instanceof Error ? error.message : 'Failed to update Flexi-Design service',
    }
  }
}

export async function setFlexiDesignServiceActive(id: string, isActive: boolean) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }
  if (auth.role !== 'admin') return { error: 'Only admins can manage services' }
  if (!id) return { error: 'Service id is required' }

  try {
    const { data, error } = await auth.supabase
      .from('flexi_design_services')
      .update({ is_active: isActive })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return { success: true, service: data as FlexiDesignService }
  } catch (error) {
    console.error('Error updating Flexi-Design service active status:', error)
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Failed to update Flexi-Design service status',
    }
  }
}

export async function reorderFlexiDesignServices(category: string, orderedIds: string[]) {
  const auth = await requireTeamMember()
  if (auth.error || !auth.supabase) return { error: auth.error ?? 'Not authenticated' }
  if (auth.role !== 'admin') return { error: 'Only admins can manage services' }

  const trimmedCategory = category.trim()
  if (!trimmedCategory) return { error: 'Category is required' }
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { error: 'Ordered service ids are required' }
  }

  try {
    const updates = orderedIds.map((id, index) =>
      auth.supabase!
        .from('flexi_design_services')
        .update({ sort_order: index + 1 })
        .eq('id', id)
        .eq('category', trimmedCategory)
    )

    const results = await Promise.all(updates)
    const failed = results.find((result) => result.error)
    if (failed?.error) throw failed.error

    return { success: true }
  } catch (error) {
    console.error('Error reordering Flexi-Design services:', error)
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Failed to reorder Flexi-Design services',
    }
  }
}
