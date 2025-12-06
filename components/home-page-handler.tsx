'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function HomePageHandler() {
  const [isProcessing, setIsProcessing] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const handleInvitationTokens = async () => {
      if (typeof window === 'undefined') {
        setIsProcessing(false)
        router.push('/time-tracking')
        return
      }

      // Check for tokens in URL hash (Supabase puts them there)
      const hash = window.location.hash
      
      if (!hash) {
        // No hash, just redirect to time-tracking
        setIsProcessing(false)
        router.push('/time-tracking')
        return
      }

      const hashParams = new URLSearchParams(hash.substring(1))
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      const type = hashParams.get('type')
      const errorParam = hashParams.get('error')
      const errorDescription = hashParams.get('error_description')

      // Handle errors
      if (errorParam) {
        const errorMsg = errorDescription
          ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
          : 'Authentication failed. Please try again.'
        
        // Redirect to login with error
        window.history.replaceState({}, '', '/auth/login')
        router.push(`/auth/login?error=${encodeURIComponent(errorMsg)}`)
        return
      }

      // If we have an access token and it's an invitation, establish session
      if (accessToken && type === 'invite') {
        try {
          console.log('Processing invitation tokens from hash')
          
          // Set the session using the tokens from the hash
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          })

          if (sessionError) {
            console.error('Error setting session from invitation token:', sessionError)
            throw sessionError
          }

          if (data.session) {
            console.log('Session established, redirecting to password setup')
            // Clean up URL hash
            window.history.replaceState({}, '', '/auth/reset-password?type=invite')
            // Redirect to password setup page
            router.push('/auth/reset-password?type=invite')
            router.refresh()
          } else {
            throw new Error('Failed to establish session')
          }
        } catch (error: any) {
          console.error('Error processing invitation tokens:', error)
          // Redirect to login with error
          window.history.replaceState({}, '', '/auth/login')
          router.push(`/auth/login?error=${encodeURIComponent(error.message || 'Failed to authenticate. Please contact your administrator.')}`)
        }
      } else if (accessToken) {
        // Not an invitation, just set the session and redirect
        try {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          })
          // Clean up URL
          window.history.replaceState({}, '', '/time-tracking')
          router.push('/time-tracking')
          router.refresh()
        } catch (error: any) {
          console.error('Error setting session:', error)
          window.history.replaceState({}, '', '/auth/login')
          router.push('/auth/login?error=Failed to authenticate. Please try again.')
        }
      } else {
        // No tokens, just redirect
        setIsProcessing(false)
        router.push('/time-tracking')
      }
    }

    handleInvitationTokens()
  }, [router, supabase])

  // Show nothing while processing (or a minimal loading state)
  if (isProcessing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Setting up your account...</p>
        </div>
      </div>
    )
  }

  return null
}

