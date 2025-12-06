'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'

/**
 * Get all users
 */
export async function getUsers() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return { success: true, users: data || [] }
  } catch (error) {
    console.error('Error fetching users:', error)
    return { error: error instanceof Error ? error.message : 'Failed to fetch users' }
  }
}

/**
 * Create a new user (admin only)
 * This sends an invitation email via Supabase Auth
 */
export async function createUser(
  email: string,
  fullName?: string,
  role: 'admin' | 'designer' | 'employee' = 'employee'
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  try {
    // Check if user already exists in our users table
    const { data: existingProfile } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle()

    if (existingProfile) {
      return { error: 'User already exists in the system' }
    }

    // Create new user via Supabase Admin API
    // This requires the service role key (SUPABASE_SERVICE_ROLE_KEY)
    const adminClient = await createAdminClient()
    
    if (!adminClient) {
      // Log diagnostic information for debugging (server-side only)
      const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL
      const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
      const urlLength = process.env.NEXT_PUBLIC_SUPABASE_URL?.length || 0
      const keyLength = process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0
      const envKeys = Object.keys(process.env).filter(k => k.includes('SUPABASE'))
      
      console.error('createAdminClient failed:', {
        hasUrl,
        hasServiceKey,
        urlLength,
        keyLength,
        envKeys,
        // Don't log actual values for security
      })
      
      // Provide more helpful error message based on what's missing
      if (!hasUrl) {
        return {
          error: 'Missing NEXT_PUBLIC_SUPABASE_URL environment variable. Please configure it in Vercel Settings → Environment Variables.',
        }
      }
      
      if (!hasServiceKey) {
        return {
          error: 'Missing SUPABASE_SERVICE_ROLE_KEY environment variable. Please add it in Vercel Settings → Environment Variables and ensure it\'s enabled for Production. After adding, redeploy your application.',
        }
      }
      
      return {
        error: 'Admin API not available. Please create users manually via Supabase Dashboard or configure SUPABASE_SERVICE_ROLE_KEY. See docs/AUTH_SETUP.md for details.',
      }
    }

    try {
      // Get the site URL for redirect
      // IMPORTANT: Supabase invitation links should redirect to Site URL (root), not callback route
      // Supabase will add a code parameter, and our middleware will intercept it
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
      
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        {
          // Redirect to Site URL root - Supabase will add code parameter
          // Middleware will intercept and redirect to callback route with code
          redirectTo: siteUrl,
          data: {
            full_name: fullName,
            role,
          },
        }
      )

      if (inviteError) {
        console.error('Error inviting user:', inviteError)
        return {
          error: inviteError.message || 'Failed to invite user. Please check Supabase settings.',
        }
      }

      // Create user profile using admin client to bypass RLS
      if (inviteData?.user) {
        const { error: profileError } = await adminClient.from('users').insert({
          id: inviteData.user.id,
          email,
          full_name: fullName || null,
          role,
        })

        if (profileError) {
          console.error('Error creating user profile:', {
            error: profileError,
            message: profileError.message,
            code: profileError.code,
            details: profileError.details,
            hint: profileError.hint,
            userId: inviteData.user.id,
            email: email,
          })
          // User was created in auth but profile failed - try to clean up
          try {
            await adminClient.auth.admin.deleteUser(inviteData.user.id)
          } catch (cleanupError) {
            console.error('Error cleaning up auth user:', cleanupError)
          }
          return {
            error: `Failed to create user profile: ${profileError.message || 'Unknown error'}. Error code: ${profileError.code || 'N/A'}. User may need to be created manually.`,
          }
        }
      } else {
        return {
          error: 'Failed to create user. No user data returned from invitation.',
        }
      }
    } catch (adminError: any) {
      console.error('Error creating user via Admin API:', adminError)
      return {
        error: adminError.message || 'Unable to create user via Admin API. Please configure SUPABASE_SERVICE_ROLE_KEY or create users manually via Supabase Dashboard. See docs/AUTH_SETUP.md',
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Error creating user:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create user' }
  }
}

/**
 * Update user role
 */
export async function updateUserRole(
  userId: string,
  role: 'admin' | 'designer' | 'employee'
) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  // Prevent removing the last admin
  if (role !== 'admin') {
    const { data: admins } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'admin')

    if (admins?.length === 1 && admins[0].id === userId) {
      return { error: 'Cannot remove the last admin user' }
    }
  }

  try {
    const { error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', userId)

    if (error) throw error

    return { success: true }
  } catch (error) {
    console.error('Error updating user role:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update user role' }
  }
}

/**
 * Delete user
 */
export async function deleteUser(userId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userProfile?.role !== 'admin') {
    return { error: 'Unauthorized: Admin access required' }
  }

  // Prevent deleting yourself
  if (user.id === userId) {
    return { error: 'Cannot delete your own account' }
  }

  // Prevent deleting the last admin
  const { data: admins } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'admin')

  if (admins?.length === 1 && admins[0].id === userId) {
    return { error: 'Cannot delete the last admin user' }
  }

  try {
    // Delete user profile (auth user will be deleted via cascade or manually)
    const { error } = await supabase.from('users').delete().eq('id', userId)

    if (error) throw error

    // Delete auth user via admin API (requires service role key)
    const adminClient = await createAdminClient()
    if (adminClient) {
      try {
        await adminClient.auth.admin.deleteUser(userId)
      } catch (deleteError) {
        console.error('Error deleting auth user:', deleteError)
        // Continue even if auth deletion fails - profile is already deleted
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Error deleting user:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete user' }
  }
}

