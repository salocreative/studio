'use client'

import { Button } from '@/components/ui/button'
import { syncMondayProjects } from '@/app/actions/monday'
import { useState } from 'react'

export function SyncButton() {
  const [isLoading, setIsLoading] = useState(false)

  async function handleSync() {
    setIsLoading(true)
    try {
      const result = await syncMondayProjects()
      if (result.error) {
        alert(`Error: ${result.error}`)
        console.error(result.error)
      } else if (result.success) {
        alert(result.message || 'Sync completed successfully!')
        // Refresh the page to show updated projects
        window.location.reload()
      }
    } catch (error) {
      console.error('Sync error:', error)
      alert('An unexpected error occurred during sync')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button onClick={handleSync} disabled={isLoading}>
      {isLoading ? 'Syncing...' : 'Sync Now'}
    </Button>
  )
}

