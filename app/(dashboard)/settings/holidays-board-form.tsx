'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getHolidaysBoard, setHolidaysBoard, removeHolidaysBoard } from '@/app/actions/holidays-board'
import { getMondayWorkspaces, getMondayBoardsAndColumns } from '@/app/actions/column-mappings'

interface Workspace {
  id: string
  name: string
  kind: string
}

interface Board {
  id: string
  name: string
}

interface HolidaysBoard {
  id: string
  monday_board_id: string
  board_name: string | null
}

export function HolidaysBoardForm() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('')
  const [boards, setBoards] = useState<Board[]>([])
  const [holidaysBoard, setHolidaysBoardState] = useState<HolidaysBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const workspacesResult = await getMondayWorkspaces()
      if (workspacesResult.error) {
        toast.error('Error loading workspaces', { description: workspacesResult.error })
      } else if (workspacesResult.workspaces) {
        setWorkspaces(workspacesResult.workspaces)
      }

      const holidaysResult = await getHolidaysBoard()
      if (holidaysResult.error) {
        setError(holidaysResult.error)
        if (holidaysResult.error.includes('table not found') || holidaysResult.error.includes('migration')) {
          toast.error('Database Setup Required', {
            description: 'Please run migration 073_holiday_leave.sql in Supabase Dashboard → SQL Editor.',
            duration: 10000,
          })
        } else {
          toast.error('Error loading holidays board', { description: holidaysResult.error })
        }
      } else {
        setError(null)
        if (holidaysResult.board) {
          setHolidaysBoardState(holidaysResult.board)
        } else {
          setHolidaysBoardState(null)
        }
      }
    } catch (loadError) {
      toast.error('Error loading data', {
        description: loadError instanceof Error ? loadError.message : 'Unknown error',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function loadBoardsForWorkspace() {
      if (!selectedWorkspace) {
        setBoards([])
        return
      }

      setLoadingBoards(true)
      try {
        const boardsResult = await getMondayBoardsAndColumns(selectedWorkspace)
        if (boardsResult.error) {
          toast.error('Error loading boards', { description: boardsResult.error })
          setBoards([])
        } else if (boardsResult.boards) {
          setBoards(boardsResult.boards)
        } else {
          setBoards([])
        }
      } catch (loadError) {
        toast.error('Error loading boards', {
          description: loadError instanceof Error ? loadError.message : 'Unknown error',
        })
        setBoards([])
      } finally {
        setLoadingBoards(false)
      }
    }

    loadBoardsForWorkspace()
  }, [selectedWorkspace])

  async function handleSetBoard(boardId: string) {
    const board = boards.find((b) => b.id === boardId)
    if (!board) return

    setSaving(true)
    try {
      const result = await setHolidaysBoard(boardId, board.name)
      if (result.error) {
        if (result.error.includes('table not found') || result.error.includes('migration')) {
          setError(result.error)
        }
        toast.error('Error setting holidays board', { description: result.error })
      } else {
        setError(null)
        toast.success('Holidays board configured')
        await loadData()
        setSelectedWorkspace('')
      }
    } catch (saveError) {
      toast.error('Error setting holidays board', {
        description: saveError instanceof Error ? saveError.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveBoard() {
    setSaving(true)
    try {
      const result = await removeHolidaysBoard()
      if (result.error) {
        toast.error('Error removing holidays board', { description: result.error })
      } else {
        toast.success('Holidays board removed')
        await loadData()
      }
    } catch (removeError) {
      toast.error('Error removing holidays board', {
        description: removeError instanceof Error ? removeError.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const availableBoards = boards.filter(
    (board) => !holidaysBoard || board.id !== holidaysBoard.monday_board_id
  )

  if (error && (error.includes('table not found') || error.includes('migration'))) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Database Setup Required</CardTitle>
          <CardDescription>
            The holidays board table has not been created yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p className="mb-2">To enable holiday sync, run the database migration:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Open your Supabase Dashboard</li>
              <li>Go to SQL Editor</li>
              <li>Run <code className="bg-muted px-1 py-0.5 rounded">supabase/migrations/073_holiday_leave.sql</code></li>
              <li>Refresh this page</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {holidaysBoard && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Current holidays board</label>
          <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
            <div>
              <span className="font-medium">
                {holidaysBoard.board_name || holidaysBoard.monday_board_id}
              </span>
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {holidaysBoard.monday_board_id}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRemoveBoard}
              disabled={saving}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">
            {holidaysBoard ? 'Change holidays board' : 'Select workspace'}
          </label>
          <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
            <SelectTrigger>
              <SelectValue placeholder="Select a workspace to view boards" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedWorkspace && (
          <div>
            <label className="text-sm font-medium mb-2 block">Select board</label>
            {loadingBoards ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading boards...</span>
              </div>
            ) : (
              <Select
                value=""
                onValueChange={handleSetBoard}
                disabled={saving || availableBoards.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={availableBoards.length === 0 ? 'No available boards' : 'Select a board'} />
                </SelectTrigger>
                <SelectContent>
                  {availableBoards.map((board) => (
                    <SelectItem key={board.id} value={board.id}>
                      {board.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      {!holidaysBoard && !loading && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">No holidays board configured</p>
          <p className="text-xs mt-1">
            Select the Monday Annual Leave board. Requests sync with projects and reduce available hours on Performance.
          </p>
        </div>
      )}
    </div>
  )
}
