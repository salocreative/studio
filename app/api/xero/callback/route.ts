import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const state = requestUrl.searchParams.get('state')
  const origin = requestUrl.origin

  // Handle OAuth errors
  if (error) {
    return NextResponse.redirect(`${origin}/settings?xero_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/settings?xero_error=missing_code`)
  }

  const supabase = await createClient()
  
  // Check if user is authenticated and is admin
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/auth/login?redirect=${encodeURIComponent('/settings')}`)
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return NextResponse.redirect(`${origin}/settings?xero_error=unauthorized`)
  }

  try {
    // Exchange authorization code for tokens
    const clientId = process.env.XERO_CLIENT_ID
    const clientSecret = process.env.XERO_CLIENT_SECRET
    const redirectUri = process.env.XERO_REDIRECT_URI || `${origin}/api/xero/callback`

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${origin}/settings?xero_error=config_missing`)
    }

    const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Xero token exchange error:', errorText)
      return NextResponse.redirect(`${origin}/settings?xero_error=token_exchange_failed`)
    }

    const tokenData = await tokenResponse.json()

    // Validate that we have required tokens
    if (!tokenData.access_token) {
      console.error('Missing access_token in Xero response')
      return NextResponse.redirect(`${origin}/settings?xero_error=missing_access_token`)
    }

    if (!tokenData.refresh_token) {
      console.error('Missing refresh_token in Xero response. Ensure offline_access scope is included.')
      return NextResponse.redirect(`${origin}/settings?xero_error=missing_refresh_token`)
    }

    // Get tenant/organization information
    const tenantResponse = await fetch('https://api.xero.com/connections', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json',
      },
    })

    if (!tenantResponse.ok) {
      const tenantErrorText = await tenantResponse.text()
      console.error('Failed to fetch tenants:', tenantErrorText)
      return NextResponse.redirect(`${origin}/settings?xero_error=tenant_fetch_failed`)
    }

    const connections = await tenantResponse.json()
    
    if (!connections || connections.length === 0) {
      return NextResponse.redirect(`${origin}/settings?xero_error=no_tenants`)
    }

    // For simplicity, use the first tenant
    // In production, you might want to let users choose
    const tenant = connections[0]
    
    if (!tenant.tenantId) {
      console.error('Missing tenantId in tenant response:', tenant)
      return NextResponse.redirect(`${origin}/settings?xero_error=invalid_tenant`)
    }
    
    // Calculate token expiration
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 1800) * 1000)

    // Check if connection already exists
    const { data: existing } = await supabase
      .from('xero_connection')
      .select('id')
      .eq('tenant_id', tenant.tenantId)
      .maybeSingle()

    const connectionData = {
      tenant_id: tenant.tenantId,
      tenant_name: tenant.tenantName || 'Xero Organization',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt.toISOString(),
      connected_by: user.id,
    }

    if (existing) {
      // Update existing connection
      const { data: updateData, error: updateError } = await supabase
        .from('xero_connection')
        .update(connectionData)
        .eq('id', existing.id)
        .select()
      
      if (updateError) {
        console.error('Error updating Xero connection:', updateError.message)
        return NextResponse.redirect(`${origin}/settings?xero_error=update_failed&details=${encodeURIComponent(updateError.message)}`)
      }
    } else {
      // Create new connection
      const { data: insertData, error: insertError } = await supabase
        .from('xero_connection')
        .insert(connectionData)
        .select()
      
      if (insertError) {
        console.error('Error inserting Xero connection:', insertError.message)
        return NextResponse.redirect(`${origin}/settings?xero_error=insert_failed&details=${encodeURIComponent(insertError.message)}`)
      }
    }

    return NextResponse.redirect(`${origin}/settings?xero_connected=true`)
  } catch (error) {
    console.error('Xero callback error:', error)
    return NextResponse.redirect(`${origin}/settings?xero_error=unknown`)
  }
}

