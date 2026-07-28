'use server'

import { createAdminClient } from '@/lib/supabase/server'

const FLEXI_BUCKET = 'flexi-design'

/**
 * Get Flexi-Design client data for public view (by client name)
 * This version uses admin client to bypass authentication
 */
export async function getFlexiDesignClientDataPublic(clientName: string) {
  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin client not available' }
  }

  try {
    // Resolve Flexi-Design board IDs using service role reads (public share views have no user session).
    const { data: mappings, error: mappingsError } = await adminClient
      .from('monday_column_mappings')
      .select('board_id')
      .not('board_id', 'is', null)

    if (mappingsError) throw mappingsError

    const allMappedBoardIds = Array.from(
      new Set((mappings || []).map((m: any) => m.board_id).filter(Boolean))
    ) as string[]

    const mondayApiToken = process.env.MONDAY_API_TOKEN
    if (!mondayApiToken) {
      return { error: 'Flexi-Design configuration unavailable (Missing MONDAY_API_TOKEN)' }
    }

    let flexiDesignBoardIds = new Set<string>()
    if (allMappedBoardIds.length > 0) {
      const MONDAY_API_URL = 'https://api.monday.com/v2'
      const query = `
        query($boardIds: [ID!]) {
          boards(ids: $boardIds) {
            id
            name
          }
        }
      `

      const response = await fetch(MONDAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: mondayApiToken,
        },
        body: JSON.stringify({ query, variables: { boardIds: allMappedBoardIds } }),
      })

      if (!response.ok) {
        return { error: 'Flexi-Design configuration unavailable (Unable to query Monday boards)' }
      }

      const result = await response.json()
      if (result.errors) {
        return { error: 'Flexi-Design configuration unavailable (Monday API error)' }
      }

      result.data?.boards?.forEach((board: { id: string; name: string }) => {
        if (board.name?.toLowerCase?.().includes('flexi')) {
          flexiDesignBoardIds.add(String(board.id))
        }
      })
    }

    const { data: completedBoardRow, error: completedBoardError } = await adminClient
      .from('flexi_design_completed_board')
      .select('monday_board_id')
      .maybeSingle()

    if (completedBoardError) throw completedBoardError
    const completedBoardId = completedBoardRow?.monday_board_id || null
    
    // Get client from database
    let clientData: any = null
    const { data, error: clientError } = await adminClient
      .from('flexi_design_clients')
      .select('*')
      .eq('client_name', clientName)
      .maybeSingle()

    if (clientError && !clientError.message.includes('does not exist')) {
      throw clientError
    }

    clientData = data

    if (flexiDesignBoardIds.size === 0) {
      return { error: 'No Flexi-Design boards configured' }
    }

    // Filter out completed board from active board IDs
    const activeBoardIds = Array.from(flexiDesignBoardIds).filter(
      (boardId) => !completedBoardId || boardId !== completedBoardId
    )

    // Get all active projects for this client, scoped to Flexi-Design boards only.
    let projectsQuery = adminClient
      .from('monday_projects')
      .select('id, name, status, created_at, quoted_hours')
      .eq('client_name', clientName)
      .in('status', ['active', 'archived', 'locked'])
      .order('created_at', { ascending: false })

    if (activeBoardIds.length > 0) {
      projectsQuery = projectsQuery.in('monday_board_id', activeBoardIds)
    } else {
      // Only completed board exists; no active boards → return no active projects
      projectsQuery = projectsQuery.in('monday_board_id', ['__none__'])
    }

    const { data: projects, error: projectsError } = await projectsQuery

    if (projectsError) throw projectsError

    // Calculate total quoted hours for active projects
    let totalQuotedHours = 0
    if (projects) {
      projects.forEach((project: any) => {
        const quotedHours = project.quoted_hours ? Number(project.quoted_hours) : 0
        totalQuotedHours += quotedHours
      })
    }

    // Get completed projects from the completed board
    let completedProjects: any[] = []
    let totalCompletedQuotedHours = 0
    
    if (completedBoardId) {
      const { data: completed, error: completedError } = await adminClient
        .from('monday_projects')
        .select('id, name, status, created_at, quoted_hours, completed_date')
        .eq('monday_board_id', completedBoardId)
        .eq('client_name', clientName)
        .in('status', ['active', 'archived', 'locked'])
        .order('completed_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (!completedError && completed) {
        completedProjects = completed
        completed.forEach((project: any) => {
          const quotedHours = project.quoted_hours ? Number(project.quoted_hours) : 0
          totalCompletedQuotedHours += quotedHours
        })
      }
    }

    // Get total deposited from credit transactions
    let totalDeposited = 0
    let creditTransactions: Array<{
      id: string
      hours: number
      transaction_date: string
      created_at: string
    }> = []
    if (clientData) {
      const { data: transactions } = await adminClient
        .from('flexi_design_credit_transactions')
        .select('id, hours, transaction_date, created_at')
        .eq('client_id', clientData.id)
        .order('transaction_date', { ascending: false })

      if (transactions) {
        totalDeposited = transactions.reduce((sum, tx: any) => sum + Number(tx.hours), 0)
        creditTransactions = transactions.map((tx: any) => ({
          id: tx.id,
          hours: Number(tx.hours),
          transaction_date: tx.transaction_date,
          created_at: tx.created_at,
        }))
      }
    }

    // Calculate remaining hours: total deposited - total quoted hours (active + completed)
    const totalEstimatedHours = totalQuotedHours + totalCompletedQuotedHours
    const remainingHours = totalDeposited - totalEstimatedHours

    // Calculate average hours per month
    // Use the first transaction date or first project date as start date
    let startDate: Date | null = null
    if (clientData) {
      const { data: firstTransaction } = await adminClient
        .from('flexi_design_credit_transactions')
        .select('transaction_date')
        .eq('client_id', clientData.id)
        .order('transaction_date', { ascending: true })
        .limit(1)
        .maybeSingle()
      
      if (firstTransaction?.transaction_date) {
        startDate = new Date(firstTransaction.transaction_date)
      }
    }
    
    // Fallback to first project date if no transactions
    if (!startDate && projects && projects.length > 0) {
      const firstProject = projects[projects.length - 1] // oldest project
      startDate = new Date(firstProject.created_at)
    }

    let avgHoursPerMonth = 0
    if (startDate && totalDeposited > 0) {
      const monthsSinceStart = Math.max(1, Math.ceil((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)))
      avgHoursPerMonth = totalDeposited / monthsSinceStart
    }

    return {
      success: true,
      client: {
        id: clientData?.id || '',
        client_name: clientName,
        remaining_hours: remainingHours,
        total_hours_used: totalEstimatedHours, // total quoted hours used (for credits)
        completed_projects_count: completedProjects.length,
        active_projects_count: projects?.length || 0,
        avg_hours_per_month: avgHoursPerMonth,
      },
      activeProjects: (projects || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        quoted_hours: p.quoted_hours ? Number(p.quoted_hours) : null,
        created_at: p.created_at,
      })),
      completedProjects: completedProjects.map((p: any) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        quoted_hours: p.quoted_hours ? Number(p.quoted_hours) : null,
        created_at: p.created_at,
        completed_date: p.completed_date,
      })),
      creditTransactions,
    }
  } catch (error) {
    console.error('Error fetching Flexi-Design client data:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch client data' }
  }
}

export interface FlexiDesignPublicGalleryItem {
  id: string
  title: string | null
  caption: string | null
  storage_path: string
  mime_type: string | null
  url: string
}

/**
 * Public gallery for a Flexi-Design share link.
 * Validates the token, then returns signed image URLs (no auth session required).
 */
export async function getFlexiDesignGalleryByShareToken(shareToken: string) {
  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin client not available' }
  }

  try {
    const { data: link, error: linkError } = await adminClient
      .from('flexi_design_share_links')
      .select('id, expires_at, is_active, flexi_design_client_id')
      .eq('share_token', shareToken)
      .eq('is_active', true)
      .maybeSingle()

    if (linkError) throw linkError
    if (!link) return { error: 'Share link not found or inactive' }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return { error: 'Share link has expired' }
    }

    const clientId = link.flexi_design_client_id as string
    const { data: items, error: itemsError } = await adminClient
      .from('flexi_design_gallery_items')
      .select('id, title, caption, storage_path, mime_type')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (itemsError) throw itemsError

    const rows = items || []
    if (rows.length === 0) {
      return { success: true, items: [] as FlexiDesignPublicGalleryItem[] }
    }

    const paths = rows.map((r) => r.storage_path).filter(Boolean)
    const { data: signed, error: signedError } = await adminClient.storage
      .from(FLEXI_BUCKET)
      .createSignedUrls(paths, 60 * 60) // 1 hour

    if (signedError) throw signedError

    const urlByPath = new Map<string, string>()
    for (const row of signed || []) {
      if (row?.path && row?.signedUrl) urlByPath.set(row.path, row.signedUrl)
    }

    const publicItems: FlexiDesignPublicGalleryItem[] = rows
      .map((item) => {
        const url = urlByPath.get(item.storage_path)
        if (!url) return null
        return {
          id: item.id,
          title: item.title,
          caption: item.caption,
          storage_path: item.storage_path,
          mime_type: item.mime_type,
          url,
        }
      })
      .filter(Boolean) as FlexiDesignPublicGalleryItem[]

    return { success: true, items: publicItems }
  } catch (error) {
    console.error('Error fetching public Flexi-Design gallery:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch gallery' }
  }
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/**
 * Random gallery sample across all Flexi-Design clients for the public Inspo tab.
 * Validates the share token, then returns up to `limit` signed image URLs.
 */
export async function getFlexiDesignInspoGalleryByShareToken(
  shareToken: string,
  limit = 16
) {
  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin client not available' }
  }

  const take = Math.min(Math.max(Math.floor(limit) || 16, 1), 16)

  try {
    const { data: link, error: linkError } = await adminClient
      .from('flexi_design_share_links')
      .select('id, expires_at, is_active')
      .eq('share_token', shareToken)
      .eq('is_active', true)
      .maybeSingle()

    if (linkError) throw linkError
    if (!link) return { error: 'Share link not found or inactive' }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return { error: 'Share link has expired' }
    }

    const { data: rows, error: itemsError } = await adminClient
      .from('flexi_design_gallery_items')
      .select('id, title, caption, storage_path, mime_type')

    if (itemsError) throw itemsError

    const pool = rows || []
    if (pool.length === 0) {
      return { success: true, items: [] as FlexiDesignPublicGalleryItem[] }
    }

    const picked = shuffleInPlace([...pool]).slice(0, take)
    const paths = picked.map((row) => row.storage_path).filter(Boolean)
    const { data: signed, error: signedError } = await adminClient.storage
      .from(FLEXI_BUCKET)
      .createSignedUrls(paths, 60 * 60)

    if (signedError) throw signedError

    const urlByPath = new Map<string, string>()
    for (const row of signed || []) {
      if (row?.path && row?.signedUrl) urlByPath.set(row.path, row.signedUrl)
    }

    const publicItems: FlexiDesignPublicGalleryItem[] = picked
      .map((item) => {
        const url = urlByPath.get(item.storage_path)
        if (!url) return null
        return {
          id: item.id,
          title: item.title,
          caption: item.caption,
          storage_path: item.storage_path,
          mime_type: item.mime_type,
          url,
        }
      })
      .filter(Boolean) as FlexiDesignPublicGalleryItem[]

    return { success: true, items: publicItems }
  } catch (error) {
    console.error('Error fetching public Flexi-Design inspo gallery:', error)
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : error instanceof Error
          ? error.message
          : 'Failed to fetch inspo gallery'
    return { error: message }
  }
}

export interface FlexiDesignPublicService {
  id: string
  category: string
  title: string
  description: string
  credit_estimate: number
  sort_order: number
}

/**
 * Public services catalog for a Flexi-Design share link.
 * Validates the token, then returns active deliverables (no auth session required).
 */
export async function getFlexiDesignServicesByShareToken(shareToken: string) {
  const adminClient = await createAdminClient()
  if (!adminClient) {
    return { error: 'Admin client not available' }
  }

  try {
    const { data: link, error: linkError } = await adminClient
      .from('flexi_design_share_links')
      .select('id, expires_at, is_active')
      .eq('share_token', shareToken)
      .eq('is_active', true)
      .maybeSingle()

    if (linkError) throw linkError
    if (!link) return { error: 'Share link not found or inactive' }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return { error: 'Share link has expired' }
    }

    const { data, error } = await adminClient
      .from('flexi_design_services')
      .select('id, category, title, description, credit_estimate, sort_order')
      .eq('is_active', true)

    if (error) throw error

    const services = ((data || []) as FlexiDesignPublicService[])
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
    }
  } catch (error) {
    console.error('Error fetching public Flexi-Design services:', error)
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : error instanceof Error
          ? error.message
          : 'Failed to fetch services'
    return { error: message }
  }
}
