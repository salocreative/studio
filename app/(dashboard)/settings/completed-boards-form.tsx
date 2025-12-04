'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getCompletedBoards, addCompletedBoard, removeCompletedBoard } from '@/app/actions/completed-boards'
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

interface CompletedBoard {
  id: string
  monday_board_id: string
  board_name: string | null
}

export function CompletedBoardsForm() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('')
  const [boards, setBoards] = useState<Board[]>([])
  const [completedBoards, setCompletedBoards] = useState<CompletedBoard[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Load workspaces
      const workspacesResult = await getMondayWorkspaces()
      if (workspacesResult.error) {
        toast.error('Error loading workspaces', { description: workspacesResult.error })
      } else if (workspacesResult.workspaces) {
        setWorkspaces(workspacesResult.workspaces)
      }

      // Load completed boards
      const completedResult = await getCompletedBoards()
      if (completedResult.error) {
        toast.error('Error loading completed boards', { description: completedResult.error })
      } else if (completedResult.boards) {
        setCompletedBoards(completedResult.boards)
      }
    } catch (error) {
      toast.error('Error loading data', {
        description: error instanceof Error ? error.message : 'Unknown error',
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
      } catch (error) {
        toast.error('Error loading boards', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        setBoards([])
      } finally {
        setLoadingBoards(false)
      }
    }

    loadBoardsForWorkspace()
  }, [selectedWorkspace])

  async function handleAddBoard(boardId: string) {
    const board = boards.find(b => b.id === boardId)
    if (!board) return

    // Check if already added
    if (completedBoards.some(cb => cb.monday_board_id === boardId)) {
      toast.error('Board already added', { description: 'This board is already in the completed boards list' })
      return
    }

    setSaving(true)
    try {
      const result = await addCompletedBoard(boardId, board.name)
      if (result.error) {
        toast.error('Error adding board', { description: result.error })
      } else {
        toast.success('Board added to completed boards')
        await loadData()
        setSelectedWorkspace('')
      }
    } catch (error) {
      toast.error('Error adding board', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveBoard(boardId: string) {
    setSaving(true)
    try {
      const result = await removeCompletedBoard(boardId)
      if (result.error) {
        toast.error('Error removing board', { description: result.error })
      } else {
        toast.success('Board removed from completed boards')
        await loadData()
      }
    } catch (error) {
      toast.error('Error removing board', {
        description: error instanceof Error ? error.message : 'Unknown error',
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
    board => !completedBoards.some(cb => cb.monday_board_id === board.id)
  )

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Select Workspace</label>
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
            <label className="text-sm font-medium mb-2 block">Select Board to Add</label>
            {loadingBoards ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading boards...</span>
              </div>
            ) : (
              <Select
                value=""
                onValueChange={handleAddBoard}
                disabled={saving || availableBoards.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={availableBoards.length === 0 ? "No available boards" : "Select a board"} />
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

      {completedBoards.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Completed Boards</label>
          <div className="space-y-2">
            {completedBoards.map((completedBoard) => (
              <div
                key={completedBoard.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <span className="font-medium">
                  {completedBoard.board_name || completedBoard.monday_board_id}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveBoard(completedBoard.monday_board_id)}
                  disabled={saving}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {completedBoards.length === 0 && !loading && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">No completed boards configured</p>
          <p className="text-xs mt-1">
            Select a workspace and board to mark as completed. Projects moved to completed boards will be archived instead of deleted.
          </p>
        </div>
      )}
    </div>
  )
}

