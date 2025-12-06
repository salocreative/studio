import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const type = requestUrl.searchParams.get('type') // 'invite', 'recovery', etc.
  const redirect = requestUrl.searchParams.get('redirect') || '/time-tracking'
  const origin = requestUrl.origin

  // Log all URL parameters for debugging
  console.log('Auth callback - URL params:', {
    code: code ? 'present' : 'missing',
    type,
    redirect,
    fullUrl: requestUrl.toString(),
  })

  // Check for error parameters (Supabase may redirect with errors)
  const errorParam = requestUrl.searchParams.get('error')
  const errorCode = requestUrl.searchParams.get('error_code')
  const errorDescription = requestUrl.searchParams.get('error_description')

  if (errorParam || errorCode) {
    console.log('Auth callback - Error detected:', {
      error: errorParam,
      errorCode,
      errorDescription,
    })
    
    // If this is an invitation and there's an error, redirect to reset-password page
    // The error will be in the hash when Supabase redirects, so we let the reset-password page handle it
    if (type === 'invite') {
      // Redirect to reset-password, it will read errors from URL hash
      return NextResponse.redirect(`${origin}/auth/reset-password?type=invite`)
    }
    
    // For other errors, redirect to login
    return NextResponse.redirect(
      `${origin}/auth/login?error=${encodeURIComponent(errorDescription || 'Authentication failed')}`
    )
  }

  if (code) {
    const supabase = await createClient()
    
    // Exchange the code for a session
    const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (exchangeError) {
      console.error('Error exchanging code for session:', exchangeError)
      
      // If this is an invitation and the code exchange failed, redirect to reset-password
      // The reset-password page will show an appropriate error message
      if (type === 'invite') {
        return NextResponse.redirect(`${origin}/auth/reset-password?type=invite`)
      }
      
      return NextResponse.redirect(`${origin}/auth/login?error=Invalid or expired link`)
    }

    // Create user profile if it doesn't exist
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      console.log('Auth callback - User info:', {
        userId: user.id,
        email: user.email,
        createdAt: user.created_at,
        emailConfirmed: user.email_confirmed_at,
        metadata: user.user_metadata,
      })

      const { data: existingProfile } = await supabase
        .from('users')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      if (!existingProfile) {
        // Create user profile with default role (or use metadata from invitation)
        const role = user.user_metadata?.role || 'employee'
        const { error: insertError } = await supabase.from('users').insert({
          id: user.id,
          email: user.email!,
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
          role: role,
        })
        
        if (insertError) {
          console.error('Error creating user profile:', insertError)
        }
      }

      // Check if this is an invitation flow
      // Invited users are newly created and need to set a password
      // We can detect this by:
      // 1. type=invite parameter in URL
      // 2. User was just created (last 15 minutes)
      // 3. User doesn't have email_confirmed_at (invited users may not have this set initially)
      const userCreatedAt = user.created_at ? new Date(user.created_at).getTime() : 0
      const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000
      const isNewUser = userCreatedAt > fifteenMinutesAgo
      const isInvitation = type === 'invite' || isNewUser || !user.email_confirmed_at
      
      console.log('Auth callback - Invitation check:', {
        typeFromUrl: type,
        isNewUser,
        emailConfirmed: !!user.email_confirmed_at,
        isInvitation,
      })
      
      if (isInvitation) {
        console.log('Redirecting to password setup page')
        // Redirect to password setup page for invited users
        return NextResponse.redirect(`${origin}/auth/reset-password?type=invite`)
      }
    }
  }

  // If no code, check if user is already authenticated (invitation links might set cookies directly)
  if (!code) {
    console.log('Auth callback - No code present, checking for existing session')
    
    const supabase = await createClient()
    
    // Check if user is already authenticated (Supabase might have set session cookies during verification)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    
    if (user && !userError) {
      console.log('Auth callback - User already authenticated via cookies:', {
        userId: user.id,
        email: user.email,
      })
      
      // Create user profile if it doesn't exist
      const { data: existingProfile } = await supabase
        .from('users')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      if (!existingProfile) {
        const role = user.user_metadata?.role || 'employee'
        const { error: insertError } = await supabase.from('users').insert({
          id: user.id,
          email: user.email!,
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
          role: role,
        })
        
        if (insertError) {
          console.error('Error creating user profile:', insertError)
        }
      }
      
      // If this is an invitation, redirect to password setup
      if (type === 'invite') {
        console.log('Auth callback - Redirecting to password setup page (session already established)')
        return NextResponse.redirect(`${origin}/auth/reset-password?type=invite`)
      }
    } else {
      console.log('Auth callback - No code and no authenticated user, redirecting to:', redirect)
      
      // If this was supposed to be an invitation, redirect to reset-password
      // The reset-password page will handle showing an appropriate error if needed
      if (type === 'invite') {
        return NextResponse.redirect(`${origin}/auth/reset-password?type=invite`)
      }
    }
  }

  return NextResponse.redirect(`${origin}${redirect}`)
}

