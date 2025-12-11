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
 * Legacy method: Fetch financial data from invoices and bills
 * Kept as fallback if Reports API is unavailable
 */
async function fetchXeroFinancialDataLegacy(
  connection: any,
  accessToken: string,
  startDate: string,
  endDate: string,
  tenant_id: string
) {
  try {
    // Fetch invoices
    const invoicesUrl = `${XERO_API_BASE}/Invoices`
    
    const invoicesResponse = await fetch(invoicesUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Xero-tenant-id': tenant_id,
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
    } else {
      const invoicesData = await invoicesResponse.json()
      const invoices = invoicesData.Invoices || []
      
      console.log(`Found ${invoices.length} invoices from Xero`)
      
      invoices.forEach((invoice: any) => {
        const invoiceDateStr = invoice.DateString || invoice.Date
        if (!invoiceDateStr) return
        
        const invoiceDate = new Date(invoiceDateStr)
        if (isNaN(invoiceDate.getTime())) return
        
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        
        if (invoiceDate >= start && invoiceDate <= end) {
          const status = invoice.Status?.toUpperCase()
          if (status === 'PAID' || status === 'AUTHORISED') {
            // Use SubTotal to exclude VAT (matching quote values)
            const total = parseFloat(invoice.SubTotal || invoice.Total || invoice.AmountDue || '0')
            if (total > 0) {
              revenue += total
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
        'Xero-tenant-id': tenant_id,
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
    } else {
      const billsData = await billsResponse.json()
      const bills = billsData.Bills || []
      
      console.log(`Found ${bills.length} bills from Xero`)
      
      bills.forEach((bill: any) => {
        const billDateStr = bill.DateString || bill.Date
        if (!billDateStr) return
        
        const billDate = new Date(billDateStr)
        if (isNaN(billDate.getTime())) return
        
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        
        if (billDate >= start && billDate <= end) {
          const status = bill.Status?.toUpperCase()
          if (status === 'PAID' || status === 'AUTHORISED') {
            // Use SubTotal to exclude VAT
            const total = parseFloat(bill.SubTotal || bill.Total || bill.AmountDue || '0')
            if (total > 0) {
              expenses += total
            }
          }
        }
      })
    }
    
    const profit = revenue - expenses
    
    await saveFinancialDataToCache(tenant_id, startDate, endDate, revenue, expenses, profit)
    
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
    console.error('Error in legacy financial data fetch:', error)
    throw error
  }
}

/**
 * Fetch financial data from Xero API using Reports API (Profit & Loss report)
 * This matches exactly what you see in Xero's P&L report:
 * - Revenue excludes VAT (matching quote values)
 * - Includes all expense categories (Administrative Costs, Salaries, etc.)
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
    // Use Xero Reports API to fetch Profit & Loss report
    // This matches exactly what you see in Xero's P&L report
    // - Revenue excludes VAT (matching quote values)
    // - Includes all expense categories (Administrative Costs, Salaries, etc.)
    
    console.log(`Fetching Xero Profit & Loss report from ${startDate} to ${endDate}`)
    
    // Format dates for Xero API (YYYY-MM-DD format)
    const fromDate = startDate.split('T')[0]
    const toDate = endDate.split('T')[0]
    
    // Fetch Profit & Loss report from Xero Reports API
    const pnlUrl = `${XERO_API_BASE}/Reports/ProfitAndLoss?fromDate=${fromDate}&toDate=${toDate}&periods=1&standardLayout=true`
    
    const pnlResponse = await fetch(pnlUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Xero-tenant-id': connection.tenant_id,
        'Accept': 'application/json',
      },
    })
    
    let revenue = 0
    let expenses = 0
    
    if (!pnlResponse.ok) {
      const errorText = await pnlResponse.text()
      console.error('Failed to fetch Profit & Loss report from Xero:', {
        status: pnlResponse.status,
        statusText: pnlResponse.statusText,
        error: errorText,
        url: pnlUrl
      })
      
      // Fallback: try the old method if Reports API fails
      console.log('Falling back to invoices/bills method...')
      return await fetchXeroFinancialDataLegacy(connection, accessToken, startDate, endDate, connection.tenant_id)
    }
    
    const pnlData = await pnlResponse.json()
    const reports = pnlData.Reports || []
    
    if (reports.length === 0) {
      console.warn('No Profit & Loss report data returned from Xero')
      return {
        success: true,
        revenue: 0,
        expenses: 0,
        profit: 0,
        period: {
          start: startDate,
          end: endDate,
        },
        fromCache: false,
      }
    }
    
    const report = reports[0]
    const rows = report.Rows || []
    
    console.log(`Processing Profit & Loss report with ${rows.length} row groups`)
    
    // Process report rows to extract revenue and expenses
    // Xero P&L structure: Rows contain RowType (Header, Section, SummaryRow) and Cells with values
    rows.forEach((row: any) => {
      if (row.RowType === 'Section') {
        const rowType = row.RowsType || ''
        const cells = row.Cells || []
        
        // Get the value from the first period column (index 0 is usually the label/account name)
        // The actual value is typically in cells[1] for a single period report
        if (cells.length > 1) {
          const value = parseFloat(cells[1]?.Value || '0')
          
          if (!isNaN(value)) {
            // Income/Sales accounts are positive, Expenses are negative in Xero
            // We need to check the section type or account type
            const accountType = row.RowsType || ''
            const accountName = cells[0]?.Value || ''
            
            // Revenue/Sales sections (typically positive values or negative values that represent income)
            // In Xero, Income accounts show as positive, Expenses show as negative
            if (accountType === 'Income' || accountName.toLowerCase().includes('revenue') || accountName.toLowerCase().includes('sales') || accountName.toLowerCase().includes('income')) {
              revenue += Math.abs(value)
            } else {
              // Expenses (Administrative Costs, etc.) - Xero shows these as negative values
              expenses += Math.abs(value)
            }
            
            console.log(`Row: ${accountName}, Type: ${accountType}, Value: ${value}, Revenue: ${revenue}, Expenses: ${expenses}`)
          }
        }
        
        // Also check nested rows (sub-accounts)
        if (row.Rows && Array.isArray(row.Rows)) {
          row.Rows.forEach((subRow: any) => {
            if (subRow.RowType === 'Row') {
              const subCells = subRow.Cells || []
              if (subCells.length > 1) {
                const subValue = parseFloat(subCells[1]?.Value || '0')
                if (!isNaN(subValue)) {
                  const accountName = subCells[0]?.Value || ''
                  const accountType = subRow.ReportRowType || row.RowsType || ''
                  
                  if (accountType === 'Income' || accountName.toLowerCase().includes('revenue') || accountName.toLowerCase().includes('sales') || accountName.toLowerCase().includes('income')) {
                    revenue += Math.abs(subValue)
                  } else {
                    expenses += Math.abs(subValue)
                  }
                }
              }
            }
          })
        }
      } else if (row.RowType === 'SummaryRow') {
        // Summary rows (like Total Income, Total Expenses, Net Profit)
        const cells = row.Cells || []
        if (cells.length > 1) {
          const label = cells[0]?.Value || ''
          const value = parseFloat(cells[1]?.Value || '0')
          
          if (!isNaN(value)) {
            // Check if this is a revenue summary or expense summary
            const labelLower = label.toLowerCase()
            if (labelLower.includes('total income') || labelLower.includes('total revenue') || labelLower.includes('total sales')) {
              revenue = Math.abs(value) // Use the summary total
            } else if (labelLower.includes('total expenses') || labelLower.includes('total costs')) {
              expenses = Math.abs(value) // Use the summary total
            }
          }
        }
      }
    })
    
    // Alternative: Use SummaryRow values if available (more reliable)
    // Look for "Total Income" or "Total Revenue" row
    const totalIncomeRow = rows.find((r: any) => {
      if (r.RowType === 'SummaryRow') {
        const label = r.Cells?.[0]?.Value || ''
        return label.toLowerCase().includes('total income') || label.toLowerCase().includes('total revenue') || label.toLowerCase().includes('total sales')
      }
      return false
    })
    
    if (totalIncomeRow && totalIncomeRow.Cells && totalIncomeRow.Cells.length > 1) {
      const totalIncome = parseFloat(totalIncomeRow.Cells[1]?.Value || '0')
      if (!isNaN(totalIncome) && totalIncome > 0) {
        revenue = Math.abs(totalIncome)
        console.log(`Using Total Income from summary: ${revenue}`)
      }
    }
    
    // Look for "Total Expenses" row
    const totalExpensesRow = rows.find((r: any) => {
      if (r.RowType === 'SummaryRow') {
        const label = r.Cells?.[0]?.Value || ''
        return label.toLowerCase().includes('total expenses') || label.toLowerCase().includes('total costs')
      }
      return false
    })
    
    if (totalExpensesRow && totalExpensesRow.Cells && totalExpensesRow.Cells.length > 1) {
      const totalExpenses = parseFloat(totalExpensesRow.Cells[1]?.Value || '0')
      if (!isNaN(totalExpenses) && totalExpenses > 0) {
        expenses = Math.abs(totalExpenses)
        console.log(`Using Total Expenses from summary: ${expenses}`)
      }
    }
    
    const profit = revenue - expenses
    
    console.log(`Financial summary from P&L report: Revenue=${revenue}, Expenses=${expenses}, Profit=${profit}`)
    
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

