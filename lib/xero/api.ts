'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Xero API base URL
 */
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'
const XERO_AUTH_BASE = 'https://login.xero.com/identity/connect'

/**
 * Get Xero connection from database
 */
export async function getXeroConnection() {
  const supabase = await createClient()
  
  try {
    const { data, error } = await supabase
      .from('xero_connection')
      .select('*')
      .maybeSingle()
    
    if (error) {
      // Check if table doesn't exist
      const errorMsg = error.message || ''
      const errorCode = error.code || ''
      
      if (
        errorCode === 'PGRST116' || 
        errorCode === '42P01' ||
        errorMsg.includes('does not exist') || 
        errorMsg.includes('relation') || 
        errorMsg.includes('table')
      ) {
        // Table doesn't exist yet - return null (no connection)
        console.warn('xero_connection table does not exist yet. Please run migration 007_add_xero_integration.sql')
        return { success: true, connection: null }
      }
      throw error
    }
    
    return { success: true, connection: data || null }
  } catch (error) {
    console.error('Error fetching Xero connection:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch Xero connection'
    
    // Provide more specific error messages
    if (errorMessage.includes('does not exist') || errorMessage.includes('relation') || errorMessage.includes('table')) {
      return { 
        error: 'Database table not found. Please run migration 007_add_xero_integration.sql in Supabase. See the migrations folder for details.' 
      }
    }
    
    return { error: errorMessage }
  }
}

/**
 * Get valid access token (refresh if needed)
 */
async function getValidAccessToken(connection: any): Promise<string | null> {
  if (!connection) {
    console.error('getValidAccessToken: No connection provided')
    return null
  }

  if (!connection.access_token) {
    console.error('getValidAccessToken: No access_token in connection')
    return null
  }

  const now = new Date()
  const expiresAt = new Date(connection.token_expires_at || connection.expires_at)
  
  // Check if expires_at is valid
  if (isNaN(expiresAt.getTime())) {
    console.error('getValidAccessToken: Invalid expires_at date:', connection.token_expires_at || connection.expires_at)
    // If we can't determine expiration, try to refresh
    if (connection.refresh_token) {
      const refreshed = await refreshXeroToken(connection.refresh_token, connection.tenant_id)
      if (refreshed.error || !refreshed.accessToken) {
        console.error('getValidAccessToken: Failed to refresh token:', refreshed.error)
        return null
      }
      return refreshed.accessToken
    }
    // If no refresh token and invalid expiration, use existing token (might fail)
    return connection.access_token
  }
  
  // If token is already expired or expires in less than 5 minutes, refresh it
  const timeUntilExpiry = expiresAt.getTime() - now.getTime()
  if (timeUntilExpiry < 5 * 60 * 1000) {
    console.log(`Token expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes, refreshing...`)
    
    if (!connection.refresh_token) {
      console.error('getValidAccessToken: Token expired but no refresh_token available')
      return null
    }
    
    const refreshed = await refreshXeroToken(connection.refresh_token, connection.tenant_id)
    if (refreshed.error || !refreshed.accessToken) {
      console.error('getValidAccessToken: Failed to refresh token:', refreshed.error)
      return null
    }
    return refreshed.accessToken
  }
  
  return connection.access_token
}

/**
 * Refresh Xero access token
 */
async function refreshXeroToken(refreshToken: string, tenantId: string) {
  const clientId = process.env.XERO_CLIENT_ID
  const clientSecret = process.env.XERO_CLIENT_SECRET
  
  if (!clientId || !clientSecret) {
    console.error('refreshXeroToken: Missing client credentials')
    return { error: 'Xero client credentials not configured' }
  }
  
  if (!refreshToken) {
    console.error('refreshXeroToken: No refresh token provided')
    return { error: 'No refresh token available' }
  }
  
  try {
    const response = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = 'Failed to refresh Xero token'
      try {
        const errorData = JSON.parse(errorText)
        errorMessage = errorData.error_description || errorData.error || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }
      console.error('Xero token refresh error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorMessage,
      })
      return { error: errorMessage }
    }
    
    const data = await response.json()
    
    if (!data.access_token) {
      console.error('refreshXeroToken: No access_token in refresh response')
      return { error: 'Invalid response from Xero: missing access_token' }
    }
    
    // Update token in database
    const supabase = await createClient()
    const expiresAt = new Date(Date.now() + (data.expires_in || 1800) * 1000)
    
    const updateData: any = {
      access_token: data.access_token,
      token_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }
    
    // Only update refresh_token if Xero provides a new one (they sometimes don't)
    if (data.refresh_token) {
      updateData.refresh_token = data.refresh_token
    }
    
    const { error: updateError } = await supabase
      .from('xero_connection')
      .update(updateData)
      .eq('tenant_id', tenantId)
    
    if (updateError) {
      console.error('refreshXeroToken: Failed to update token in database:', updateError)
      // Still return the token even if DB update fails
      return { 
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresIn: data.expires_in 
      }
    }
    
    console.log('Token refreshed successfully')
    return { 
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in 
    }
  } catch (error) {
    console.error('Error refreshing Xero token:', error)
    return { error: error instanceof Error ? error.message : 'Failed to refresh token' }
  }
}

/**
 * Get cached financial data
 */
async function getCachedFinancialData(tenantId: string, startDate: string, endDate: string) {
  const supabase = await createClient()
  
  try {
    const { data, error } = await supabase
      .from('xero_financial_cache')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('period_start', startDate)
      .eq('period_end', endDate)
      .maybeSingle()
    
    if (error) {
      console.error('Error fetching cached financial data:', error)
      return null
    }
    
    return data
  } catch (error) {
    console.error('Error in getCachedFinancialData:', error)
    return null
  }
}

/**
 * Save financial data to cache
 */
async function saveFinancialDataToCache(
  tenantId: string,
  startDate: string,
  endDate: string,
  revenue: number,
  expenses: number,
  profit: number
) {
  const supabase = await createClient()
  
  // Check if user is admin (required for cache write)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    console.warn('Cannot save to cache: user not authenticated')
    return
  }
  
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  
  if (userProfile?.role !== 'admin') {
    console.warn('Cannot save to cache: user is not admin')
    return
  }
  
  try {
    const { error } = await supabase
      .from('xero_financial_cache')
      .upsert({
        tenant_id: tenantId,
        period_start: startDate,
        period_end: endDate,
        revenue,
        expenses,
        profit,
        cached_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,period_start,period_end'
      })
    
    if (error) {
      console.error('Error saving to cache:', error)
    } else {
      console.log('Financial data saved to cache')
    }
  } catch (error) {
    console.error('Error in saveFinancialDataToCache:', error)
  }
}

/**
 * Fetch financial data from Xero API (simplified version)
 * For now, we'll fetch invoices and bills to calculate revenue and expenses
 */
export async function fetchXeroFinancialData(startDate: string, endDate: string) {
  const connectionResult = await getXeroConnection()
  
  // If no connection, try to get any cached data (we don't know tenant_id)
  if (connectionResult.error || !connectionResult.connection) {
    // Try to find any cached data for this period (query without tenant_id filter)
    const supabase = await createClient()
    try {
      const { data: cached } = await supabase
        .from('xero_financial_cache')
        .select('*')
        .eq('period_start', startDate)
        .eq('period_end', endDate)
        .order('cached_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      if (cached) {
        console.log('Returning cached financial data (no active connection)')
        return {
          success: true,
          revenue: Number(cached.revenue || 0),
          expenses: Number(cached.expenses || 0),
          profit: Number(cached.profit || 0),
          period: {
            start: startDate,
            end: endDate,
          },
          fromCache: true,
        }
      }
    } catch (error) {
      console.error('Error checking cache without connection:', error)
    }
    
    return { error: 'Xero not connected. Please connect in Settings.' }
  }
  
  const connection = connectionResult.connection
  
  // Check cache first (if data is less than 24 hours old, use it)
  const cached = await getCachedFinancialData(connection.tenant_id, startDate, endDate)
  if (cached) {
    const cacheAge = Date.now() - new Date(cached.cached_at).getTime()
    const oneDayInMs = 24 * 60 * 60 * 1000
    
    if (cacheAge < oneDayInMs) {
      console.log('Returning cached financial data (less than 24 hours old)')
      return {
        success: true,
        revenue: Number(cached.revenue || 0),
        expenses: Number(cached.expenses || 0),
        profit: Number(cached.profit || 0),
        period: {
          start: startDate,
          end: endDate,
        },
        fromCache: true,
      }
    }
  }
  
  console.log('Xero connection details:', {
    hasAccessToken: !!connection.access_token,
    hasRefreshToken: !!connection.refresh_token,
    expiresAt: connection.token_expires_at || connection.expires_at,
    tenantId: connection.tenant_id,
  })
  
  const accessToken = await getValidAccessToken(connection)
  
  // If token refresh fails, try to return cached data
  if (!accessToken) {
    console.error('Failed to get valid access token. Trying cached data...')
    
    if (cached) {
      console.log('Returning cached financial data (token expired)')
      return {
        success: true,
        revenue: Number(cached.revenue || 0),
        expenses: Number(cached.expenses || 0),
        profit: Number(cached.profit || 0),
        period: {
          start: startDate,
          end: endDate,
        },
        fromCache: true,
      }
    }
    
    return { 
      error: 'Failed to get valid Xero access token. The token may have expired. Please reconnect Xero in Settings.' 
    }
  }
  
  try {
    // Fetch invoices and bills from Xero
    // Note: Xero API uses a different date format and filtering approach
    // We'll fetch all invoices and filter by date in code for now
    
    console.log(`Fetching Xero financial data from ${startDate} to ${endDate}`)
    
    // Fetch invoices - Xero doesn't support complex where clauses easily, so we'll fetch and filter
    const invoicesUrl = `${XERO_API_BASE}/Invoices`
    
    const invoicesResponse = await fetch(invoicesUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Xero-tenant-id': connection.tenant_id,
        'Accept': 'application/json',
      },
    })
    
    let revenue = 0
    let expenses = 0
    
    if (!invoicesResponse.ok) {
      const errorText = await invoicesResponse.text()
      console.error('Failed to fetch invoices from Xero:', {
        status: invoicesResponse.status,
        statusText: invoicesResponse.statusText,
        error: errorText,
        url: invoicesUrl
      })
      // Continue even if invoices fail - we'll just have 0 revenue
    } else {
      const invoicesData = await invoicesResponse.json()
      const invoices = invoicesData.Invoices || []
      
      console.log(`Found ${invoices.length} invoices from Xero`)
      
      // Filter invoices by date and sum revenue
      invoices.forEach((invoice: any) => {
        // Xero uses DateString or Date field - check both
        const invoiceDateStr = invoice.DateString || invoice.Date
        if (!invoiceDateStr) {
          console.log(`Skipping invoice ${invoice.InvoiceNumber || 'unknown'}: no date field`)
          return
        }
        
        const invoiceDate = new Date(invoiceDateStr)
        if (isNaN(invoiceDate.getTime())) {
          console.log(`Skipping invoice ${invoice.InvoiceNumber || 'unknown'}: invalid date ${invoiceDateStr}`)
          return
        }
        
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999) // Include entire end date
        
        // Check if invoice is in date range
        if (invoiceDate >= start && invoiceDate <= end) {
          // Sum paid and authorized invoices as revenue
          // Also include VOIDED invoices that were paid (they still count as revenue)
          const status = invoice.Status?.toUpperCase()
          if (status === 'PAID' || status === 'AUTHORISED') {
            const total = parseFloat(invoice.Total || invoice.AmountDue || '0')
            if (total > 0) {
              revenue += total
              console.log(`Adding invoice ${invoice.InvoiceNumber}: £${total.toFixed(2)} (Status: ${status}, Date: ${invoiceDateStr})`)
            }
          }
        }
      })
    }
    
    // Fetch bills for expenses
    const billsUrl = `${XERO_API_BASE}/Bills`
    
    const billsResponse = await fetch(billsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Xero-tenant-id': connection.tenant_id,
        'Accept': 'application/json',
      },
    })
    
    if (!billsResponse.ok) {
      const errorText = await billsResponse.text()
      console.error('Failed to fetch bills from Xero:', {
        status: billsResponse.status,
        statusText: billsResponse.statusText,
        error: errorText,
        url: billsUrl
      })
      // Continue even if bills fail - we'll just have 0 expenses
    } else {
      const billsData = await billsResponse.json()
      const bills = billsData.Bills || []
      
      console.log(`Found ${bills.length} bills from Xero`)
      
      // Filter bills by date and sum expenses
      bills.forEach((bill: any) => {
        // Xero uses DateString or Date field - check both
        const billDateStr = bill.DateString || bill.Date
        if (!billDateStr) {
          console.log(`Skipping bill ${bill.BillNumber || 'unknown'}: no date field`)
          return
        }
        
        const billDate = new Date(billDateStr)
        if (isNaN(billDate.getTime())) {
          console.log(`Skipping bill ${bill.BillNumber || 'unknown'}: invalid date ${billDateStr}`)
          return
        }
        
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999) // Include entire end date
        
        // Check if bill is in date range
        if (billDate >= start && billDate <= end) {
          // Sum paid and authorized bills as expenses
          const status = bill.Status?.toUpperCase()
          if (status === 'PAID' || status === 'AUTHORISED') {
            const total = parseFloat(bill.Total || bill.AmountDue || '0')
            if (total > 0) {
              expenses += total
              console.log(`Adding bill ${bill.BillNumber}: £${total.toFixed(2)} (Status: ${status}, Date: ${billDateStr})`)
            }
          }
        }
      })
    }
    
    const profit = revenue - expenses
    
    console.log(`Financial summary: Revenue=${revenue}, Expenses=${expenses}, Profit=${profit}`)
    
    // Save to cache
    await saveFinancialDataToCache(
      connection.tenant_id,
      startDate,
      endDate,
      revenue,
      expenses,
      profit
    )
    
    return {
      success: true,
      revenue,
      expenses,
      profit,
      period: {
        start: startDate,
        end: endDate,
      },
      fromCache: false,
    }
  } catch (error) {
    console.error('Error fetching Xero financial data:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch financial data' }
  }
}

/**
 * Generate Xero OAuth authorization URL
 */
export async function getXeroAuthUrl() {
  const clientId = process.env.XERO_CLIENT_ID
  const redirectUri = process.env.XERO_REDIRECT_URI || 'http://localhost:3000/api/xero/callback'
  
  if (!clientId) {
    return { error: 'Xero client ID not configured' }
  }
  
  const scopes = [
    'offline_access', // Required for refresh_token
    'accounting.transactions',
    'accounting.reports.read',
    'accounting.contacts',
    'accounting.settings',
  ].join(' ')
  
  const state = Math.random().toString(36).substring(7) // Simple state for CSRF protection
  
  const authUrl = `${XERO_AUTH_BASE}/authorize?` + new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  }).toString()
  
  return { success: true, authUrl, state }
}

