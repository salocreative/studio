'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * Check if the current user is an admin
 * Returns user role or redirects if not authenticated
 */
export async function requireAdmin() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  // Get user profile with role
  let userRole: 'admin' | 'designer' | 'manager' = 'manager'
  
  try {
    const { data: userProfile } = await supabase
      .from('users')
      .select('role, deleted_at')
      .eq('id', user.id)
      .is('deleted_at', null) // Exclude soft-deleted users
      .maybeSingle()
    
    // If user is soft-deleted, redirect to login
    if (userProfile?.deleted_at) {
      redirect('/auth/login')
    }

    if (userProfile?.role) {
      const role = userProfile.role as string
      if (role === 'employee') {
        userRole = 'manager' // Map legacy 'employee' to 'manager'
      } else {
        userRole = (role as 'admin' | 'designer' | 'manager') || 'manager'
      }
    }
  } catch (error) {
    console.error('Error fetching user profile:', error)
  }

  if (userRole !== 'admin') {
    redirect('/') // Redirect to home/dashboard if not admin
  }

  return userRole
}

/**
 * Require authentication but allow all roles
 * Returns user or redirects if not authenticated
 */
export async function requireAuth() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  // Check if user is soft-deleted
  const { data: userProfile } = await supabase
    .from('users')
    .select('deleted_at')
    .eq('id', user.id)
    .maybeSingle()

  if (userProfile?.deleted_at) {
    redirect('/auth/login')
  }

  return user
}

/**
 * Check if current user is admin (non-redirecting version)
 */
export async function checkIsAdmin() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { isAdmin: false }
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  return { isAdmin: userProfile?.role === 'admin' }
}

