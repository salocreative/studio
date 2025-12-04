'use server'

import { createClient } from '@/lib/supabase/server'

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
      .single()

    if (existingProfile) {
      return { error: 'User already exists' }
    }

    // Create new user via Supabase Admin API
    // Note: This requires service role key, which should be in server-only code
    // For server-side admin operations, you may need to use a separate admin client
    // with the service role key (SUPABASE_SERVICE_ROLE_KEY)
    
    // Try to use admin API if available (requires service role in server environment)
    try {
      const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
        email,
        {
          data: {
            full_name: fullName,
            role,
          },
        }
      )

      if (inviteError) {
        // If admin API not available, provide instructions
        return {
          error: 'Admin API not available. Please create users manually via Supabase Dashboard or configure SUPABASE_SERVICE_ROLE_KEY. See docs/AUTH_SETUP.md for details.',
        }
      }

      // Create user profile
      if (inviteData?.user) {
        await supabase.from('users').insert({
          id: inviteData.user.id,
          email,
          full_name: fullName || null,
          role,
        })
      }
    } catch (adminError: any) {
      // Admin API might not be available with anon key
      return {
        error: 'Unable to create user via Admin API. Please configure SUPABASE_SERVICE_ROLE_KEY for user management, or create users manually via Supabase Dashboard. See docs/AUTH_SETUP.md',
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

    // Delete auth user via admin API
    await supabase.auth.admin.deleteUser(userId)

    return { success: true }
  } catch (error) {
    console.error('Error deleting user:', error)
    return { error: error instanceof Error ? error.message : 'Failed to delete user' }
  }
}

