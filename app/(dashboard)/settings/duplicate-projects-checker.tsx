'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { checkDuplicateFlexiDesignProjects } from '@/app/actions/check-duplicate-projects'
import { fixDuplicateFlexiDesignProjects } from '@/app/actions/fix-duplicate-projects'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type DuplicateResult = {
  success: boolean
  duplicates?: Array<{
    name: string
    client_name: string | null
    monday_item_id: string
    activeProject: {
      id: string
      monday_board_id: string
      status: string
      monday_item_id: string
    }
    completedProject: {
      id: string
      monday_board_id: string
      status: string
      monday_item_id: string
    }
  }>
  duplicateItemIds?: string[]
  duplicateItemIdsInDb?: string[]
  stats?: {
    activeProjectsCount: number
    completedProjectsCount: number
    duplicatesByNameCount: number
    duplicatesByItemIdCount: number
    duplicatesByItemIdInDbCount: number
  }
  message?: string
  error?: string
}

export function DuplicateProjectsChecker() {
  const [loading, setLoading] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [result, setResult] = useState<DuplicateResult | null>(null)

  async function handleCheck() {
    setLoading(true)
    setResult(null)
    try {
      const checkResult = await checkDuplicateFlexiDesignProjects() as DuplicateResult
      setResult(checkResult)
      
      if ('error' in checkResult && checkResult.error) {
        toast.error(checkResult.error)
      } else if ('success' in checkResult && checkResult.success) {
        const stats = checkResult.stats
        if (stats && (stats.duplicatesByNameCount > 0 || stats.duplicatesByItemIdCount > 0 || stats.duplicatesByItemIdInDbCount > 0)) {
          toast.warning(`Found ${stats.duplicatesByNameCount + stats.duplicatesByItemIdCount + stats.duplicatesByItemIdInDbCount} duplicate(s)`)
        } else {
          toast.success('No duplicates found')
        }
      }
    } catch (error) {
      console.error('Error checking duplicates:', error)
      toast.error('Failed to check for duplicates')
    } finally {
      setLoading(false)
    }
  }

  async function handleFix() {
    if (!result || ('error' in result && result.error)) return
    
    setFixing(true)
    try {
      const fixResult = await fixDuplicateFlexiDesignProjects()
      
      if ('error' in fixResult && fixResult.error) {
        toast.error(fixResult.error)
      } else if ('success' in fixResult) {
        const message = fixResult.message || 'Duplicates fixed successfully'
        if (fixResult.success) {
          toast.success(message)
        } else {
          toast.warning(message)
          if ('errors' in fixResult && fixResult.errors && fixResult.errors.length > 0) {
            console.error('Fix errors:', fixResult.errors)
          }
        }
        // Re-check after fixing
        await handleCheck()
      }
    } catch (error) {
      console.error('Error fixing duplicates:', error)
      toast.error('Failed to fix duplicates')
    } finally {
      setFixing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Duplicate Projects Checker</CardTitle>
        <CardDescription>
          Check for duplicate Flexi-Design projects that appear in both active and completed boards.
          Projects with the same monday_item_id in both boards should not exist - the sync process should
          update the project's board_id when it moves. When fixing duplicates, time entries and tasks will
          be automatically transferred from the active project to the completed project before deletion.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button onClick={handleCheck} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Check for Duplicates
          </Button>
          
          {'success' in result && result.success && result.stats && 
           (result.stats.duplicatesByItemIdCount > 0 || result.stats.duplicatesByNameCount > 0) && (
            <Button onClick={handleFix} disabled={fixing} variant="destructive">
              {fixing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Fix Duplicates
            </Button>
          )}
        </div>

        {'error' in result && result.error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div>
                <p className="font-semibold text-destructive">Error</p>
                <p className="text-sm text-muted-foreground">{result.error}</p>
              </div>
            </div>
          </div>
        )}

        {'success' in result && result.success && result.stats && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4">
              <h3 className="font-semibold mb-2">Statistics</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Active Projects</p>
                  <p className="font-semibold">{result.stats.activeProjectsCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Completed Projects</p>
                  <p className="font-semibold">{result.stats.completedProjectsCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Duplicates (by name/client)</p>
                  <p className={`font-semibold ${result.stats.duplicatesByNameCount > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {result.stats.duplicatesByNameCount}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Duplicates (same monday_item_id)</p>
                  <p className={`font-semibold ${result.stats.duplicatesByItemIdCount > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {result.stats.duplicatesByItemIdCount}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Database duplicates</p>
                  <p className={`font-semibold ${result.stats.duplicatesByItemIdInDbCount > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {result.stats.duplicatesByItemIdInDbCount}
                  </p>
                </div>
              </div>
            </div>

            {result.stats.duplicatesByItemIdCount === 0 && 
             result.stats.duplicatesByNameCount === 0 && 
             result.stats.duplicatesByItemIdInDbCount === 0 && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-5 w-5" />
                  <p className="font-semibold">No duplicates found</p>
                </div>
              </div>
            )}

            {result.duplicates && result.duplicates.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Duplicate Projects</h3>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Monday Item ID</TableHead>
                        <TableHead>Active Board</TableHead>
                        <TableHead>Completed Board</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.duplicates.map((dup, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{dup.name}</TableCell>
                          <TableCell>{dup.client_name || '-'}</TableCell>
                          <TableCell className="font-mono text-xs">{dup.monday_item_id}</TableCell>
                          <TableCell className="font-mono text-xs">{dup.activeProject.monday_board_id}</TableCell>
                          <TableCell className="font-mono text-xs">{dup.completedProject.monday_board_id}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

