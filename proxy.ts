import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  try {
    let supabaseResponse = NextResponse.next({
      request,
    })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing Supabase environment variables in proxy')
      return supabaseResponse
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    // Refresh session if expired - required for Server Components
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    // Handle Supabase invitation/auth codes at root path
    // When Supabase verifies an invitation, it redirects to Site URL with a code parameter
    if (request.nextUrl.pathname === '/' || request.nextUrl.pathname === '') {
      const code = request.nextUrl.searchParams.get('code')
      const type = request.nextUrl.searchParams.get('type')
      
      if (code) {
        // Redirect to callback route to handle authentication
        const callbackUrl = new URL('/auth/callback', request.url)
        callbackUrl.searchParams.set('code', code)
        if (type) {
          callbackUrl.searchParams.set('type', type)
        } else {
          // If no type parameter, assume it might be an invitation
          // The callback route will detect invitations based on user creation time
          callbackUrl.searchParams.set('type', 'invite')
        }
        callbackUrl.searchParams.set('redirect', '/auth/reset-password')
        return NextResponse.redirect(callbackUrl)
      }
    }

    // Only check auth if there's no error
    if (!authError) {
      // Protect dashboard routes
      if (request.nextUrl.pathname.startsWith('/time-tracking') ||
          request.nextUrl.pathname.startsWith('/projects') ||
          request.nextUrl.pathname.startsWith('/flexi-design') ||
          request.nextUrl.pathname.startsWith('/performance') ||
          request.nextUrl.pathname.startsWith('/forecast') ||
          request.nextUrl.pathname.startsWith('/scorecard') ||
          request.nextUrl.pathname.startsWith('/customers') ||
          request.nextUrl.pathname.startsWith('/settings')) {
        if (!user) {
          const url = request.nextUrl.clone()
          url.pathname = '/auth/login'
          url.searchParams.set('redirect', request.nextUrl.pathname)
          return NextResponse.redirect(url)
        }
      }

      // Redirect authenticated users away from login
      if (request.nextUrl.pathname.startsWith('/auth/login') && user) {
        const url = request.nextUrl.clone()
        url.pathname = '/time-tracking'
        return NextResponse.redirect(url)
      }
    }

    return supabaseResponse
  } catch (error) {
    console.error('Proxy error:', error)
    // Return a response even on error to prevent 500
    return NextResponse.next({
      request,
    })
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

