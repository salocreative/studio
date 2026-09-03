import { cache } from 'react'
import { createClient } from './server'

/**
 * Request-scoped Supabase helpers.
 *
 * `supabase.auth.getUser()` is a network call to the Supabase auth server. Actions that
 * compose several other actions (the timesheet bootstrap, for example) would otherwise pay
 * for it once per sub-call. React's `cache` dedupes these for the lifetime of one request.
 */

export const getRequestClient = cache(async () => createClient())

export const getRequestUser = cache(async () => {
  const supabase = await getRequestClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ?? null
})

/** Non-redirecting admin check, deduped per request. */
export const isRequestUserAdmin = cache(async (): Promise<boolean> => {
  const user = await getRequestUser()
  if (!user) return false

  const supabase = await getRequestClient()
  const { data: userProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  return userProfile?.role === 'admin'
})
