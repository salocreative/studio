import { LayoutWrapper } from '@/components/navigation/layout-wrapper'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from '@/components/ui/sonner'

// Force dynamic rendering since we use cookies for auth
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let supabase
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('Error creating Supabase client:', error)
    redirect('/auth/login')
    return null // Never reached, but satisfies TypeScript
  }

  if (!supabase) {
    redirect('/auth/login')
    return null // Never reached, but satisfies TypeScript
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    // Don't log AuthSessionMissingError - it's expected when users aren't authenticated
    // This happens when unauthenticated users try to access protected routes
    if (authError && !(authError as any)?.__isAuthError) {
      console.error('Auth error in layout:', authError)
    }
    redirect('/auth/login')
  }

  // Get user profile with role
  // Use .maybeSingle() instead of .single() to avoid errors if profile doesn't exist yet
  let userRole: 'admin' | 'designer' | 'manager' = 'manager'
  
  try {
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError && profileError.code !== 'PGRST116') {
      // PGRST116 is "not found" which is fine for new users
      console.error('Error fetching user profile:', profileError)
    } else if (userProfile?.role) {
      // Handle both 'employee' (legacy) and 'manager' (new) roles
      const role = userProfile.role as string
      if (role === 'employee') {
        userRole = 'manager' // Map legacy 'employee' to 'manager'
      } else {
        userRole = (role as 'admin' | 'designer' | 'manager') || 'manager'
      }
    }
  } catch (profileError) {
    console.error('Error fetching user profile:', profileError)
    // Continue with default role
  }

  return (
    <>
      <LayoutWrapper userRole={userRole}>{children}</LayoutWrapper>
      <Toaster />
    </>
  )
}

