import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const type = requestUrl.searchParams.get('type') // 'invite', 'recovery', etc.
  const redirect = requestUrl.searchParams.get('redirect') || '/time-tracking'
  const origin = requestUrl.origin

  if (code) {
    const supabase = await createClient()
    
    // Exchange the code for a session
    const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (exchangeError) {
      console.error('Error exchanging code for session:', exchangeError)
      return NextResponse.redirect(`${origin}/auth/login?error=Invalid or expired link`)
    }

    // Create user profile if it doesn't exist
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
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
    }

    // If this is an invitation (type=invite), always redirect to password setup
    // Invited users need to set their password before they can use the app
    if (type === 'invite') {
      return NextResponse.redirect(`${origin}/auth/reset-password?type=invite`)
    }
    
    // Also check if this is a newly created user (likely from invitation)
    // If user was just created in the last 5 minutes, redirect to password setup
    if (user && user.created_at) {
      const userCreatedAt = new Date(user.created_at).getTime()
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
      
      if (userCreatedAt > fiveMinutesAgo) {
        // This is a newly created user, likely from invitation
        // Check if they have a password by trying to verify their session
        // If session exists but they can't log in, they need to set password
        return NextResponse.redirect(`${origin}/auth/reset-password?type=invite`)
      }
    }
  }

  return NextResponse.redirect(`${origin}${redirect}`)
}

