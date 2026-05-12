'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  listFlexiDesignBoards,
  addFlexiDesignBoard,
  removeFlexiDesignBoard,
  type FlexiDesignBoardRow,
} from '@/app/actions/flexi-design-boards'
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

export function FlexiDesignBoardsForm() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('')
  const [boards, setBoards] = useState<Board[]>([])
  const [configuredBoards, setConfiguredBoards] = useState<FlexiDesignBoardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadConfiguredBoards()
  }, [])

  async function loadConfiguredBoards() {
    setLoading(true)
    try {
      const listResult = await listFlexiDesignBoards()
      if (listResult.error) {
        toast.error('Could not load Flexi-Design boards', { description: listResult.error })
      } else if (listResult.boards) {
        setConfiguredBoards(listResult.boards)
      }

      const workspacesResult = await getMondayWorkspaces()
      if (workspacesResult.error) {
        toast.error('Error loading workspaces', { description: workspacesResult.error })
      } else if (workspacesResult.workspaces) {
        setWorkspaces(workspacesResult.workspaces)
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
    const board = boards.find((b) => b.id === boardId)
    if (!board) return

    setSaving(true)
    try {
      const result = await addFlexiDesignBoard(board.id, board.name)
      if (result.error) {
        toast.error('Could not add board', { description: result.error })
      } else {
        toast.success('Flexi-Design board added')
        await loadConfiguredBoards()
      }
    } catch (error) {
      toast.error('Could not add board', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(id: string) {
    setSaving(true)
    try {
      const result = await removeFlexiDesignBoard(id)
      if (result.error) {
        toast.error('Could not remove board', { description: result.error })
      } else {
        toast.success('Flexi-Design board removed')
        await loadConfiguredBoards()
      }
    } catch (error) {
      toast.error('Could not remove board', {
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

  const configuredIds = new Set(configuredBoards.map((b) => b.monday_board_id))
  const availableBoards = boards.filter((b) => !configuredIds.has(b.id))

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        <p>
          Monday boards listed here are treated as <strong>Flexi-Design</strong> for Time Tracking and reports (versus Main
          projects). Add every active Flexi board you use. The Flexi completed/archive board is still excluded from the
          active Flexi picker when configured under column mappings.
        </p>
        <p className="mt-2">
          When at least one board is configured here, Studio uses this list instead of detecting Flexi boards via Monday API
          names.
        </p>
      </div>

      {configuredBoards.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Configured Flexi-Design boards</label>
          <ul className="divide-y rounded-lg border bg-muted/30">
            {configuredBoards.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm font-medium">
                  {row.board_name || row.monday_board_id}
                  {row.board_name && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{row.monday_board_id}</span>
                  )}
                </span>
                <Button variant="ghost" size="icon" onClick={() => handleRemove(row.id)} disabled={saving}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Add board</label>
          <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
            <SelectTrigger>
              <SelectValue placeholder="Select a workspace" />
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
            <label className="text-sm font-medium mb-2 block">Monday board</label>
            {loadingBoards ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading boards...</span>
              </div>
            ) : (
              <Select value="" onValueChange={handleAddBoard} disabled={saving || availableBoards.length === 0}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      availableBoards.length === 0
                        ? configuredBoards.length > 0
                          ? 'All boards from this workspace are already added'
                          : 'No boards in workspace'
                        : 'Choose a board to add'
                    }
                  />
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

      {configuredBoards.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Until you add boards here, Flexi board detection falls back to the legacy Monday API method (board names containing
          &quot;flexi&quot;) when <code className="rounded bg-muted px-1">MONDAY_API_TOKEN</code> is set.
        </p>
      )}
    </div>
  )
}
