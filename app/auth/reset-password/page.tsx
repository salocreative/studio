'use client'

import { useState, Suspense, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useRouter, useSearchParams } from 'next/navigation'
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react'

function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [expiredLink, setExpiredLink] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const type = searchParams.get('type') // 'recovery' or 'invite'

  const supabase = createClient()

  useEffect(() => {
    // Check for error parameters in URL hash (Supabase redirects errors in hash)
    if (typeof window !== 'undefined') {
      const hash = window.location.hash
      if (hash) {
        const hashParams = new URLSearchParams(hash.substring(1))
        const errorCode = hashParams.get('error_code')
        const errorDescription = hashParams.get('error_description')
        
        if (errorCode === 'otp_expired' || errorCode === 'token_expired') {
          setExpiredLink(true)
          setCheckingAuth(false)
          setError(
            errorDescription 
              ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
              : 'This invitation link has expired. Please contact your administrator for a new invitation.'
          )
          return
        } else if (hashParams.get('error')) {
          // Other error from Supabase
          setCheckingAuth(false)
          setError(
            errorDescription 
              ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
              : 'This link is invalid or has expired. Please contact your administrator for a new invitation.'
          )
          return
        }
      }
    }

    // Check if user is authenticated first
    supabase.auth.getUser().then(({ data: { user }, error: userError }) => {
      setIsAuthenticated(!!user)
      
      // For invitation flow (type=invite or authenticated user)
      if (type === 'invite' || user) {
        setCheckingAuth(false)
        if (!user && type === 'invite') {
          setError('You must be logged in to set your password. Please click the invitation link from your email.')
        }
        // User is authenticated, they can set password
        return
      }
      
      // For password reset flow (recovery), token is required
      if (!token) {
        setCheckingAuth(false)
        setError('Invalid or missing reset token. Please check your email link.')
      } else {
        setCheckingAuth(false)
      }
    })
  }, [token, type, supabase])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long')
      setLoading(false)
      return
    }

    try {
      // For invitation/password reset, we use updateUser
      const { data, error: updateError } = await supabase.auth.updateUser({
        password: password,
      })

      if (updateError) throw updateError

      if (data.user) {
        setSuccess(true)
        // Redirect to dashboard after a short delay (they're already authenticated)
        setTimeout(() => {
          router.push('/time-tracking')
          router.refresh()
        }, 1500)
      }
    } catch (error: any) {
      console.error('Error setting password:', error)
      setError(error.message || 'An error occurred while setting your password')
    } finally {
      setLoading(false)
    }
  }

  // Show loading while checking authentication
  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">Studio</CardTitle>
            <CardDescription>Loading...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  // Show error page for expired links or invalid links
  if (expiredLink || (!isAuthenticated && !token && error && !checkingAuth && type !== 'invite')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">
              {expiredLink ? 'Link Expired' : 'Invalid Link'}
            </CardTitle>
            <CardDescription>
              {error || (type === 'invite'
                ? 'This invitation link is invalid or has expired. Please contact your administrator for a new invitation.'
                : 'This password reset link is invalid or has expired. Please request a new password reset link.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/auth/login')} className="w-full">
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">Password Set Successfully</CardTitle>
            <CardDescription>Your password has been set. Redirecting...</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">
            {(type === 'invite' || isAuthenticated) ? 'Set Your Password' : 'Reset Your Password'}
          </CardTitle>
          <CardDescription>
            {(type === 'invite' || isAuthenticated)
              ? 'Welcome! Please set a password for your account.'
              : 'Enter your new password below.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  required
                  disabled={loading}
                  minLength={6}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-9"
                  required
                  disabled={loading}
                  minLength={6}
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Setting Password...' : (type === 'invite' || isAuthenticated) ? 'Set Password' : 'Reset Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold">Studio</CardTitle>
              <CardDescription>Loading...</CardDescription>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  )
}
