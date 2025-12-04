'use client'

import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { getMondayBoardsAndColumns, getColumnMappings, saveColumnMapping, deleteColumnMappings } from '@/app/actions/column-mappings'
import { Loader2, CheckCircle2, Edit2 } from 'lucide-react'
import { toast } from 'sonner'

interface Column {
  id: string
  title: string
  type: string
}

interface Board {
  id: string
  name: string
  columns: Column[]
  parentColumns?: Column[]
  subtaskColumns?: Column[]
}

interface Workspace {
  id: string
  name: string
  kind: string
}

export function ColumnMappingForm() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('')
  const [boards, setBoards] = useState<Board[]>([])
  const [selectedBoard, setSelectedBoard] = useState<string>('')
  const [parentColumns, setParentColumns] = useState<Column[]>([])
  const [subtaskColumns, setSubtaskColumns] = useState<Column[]>([])
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [saving, setSaving] = useState(false)

  // Initialize: Load workspaces and restore saved selections
  useEffect(() => {
    async function initialize() {
      setLoading(true)
      
      // Load workspaces
      try {
        const { getMondayWorkspaces } = await import('@/app/actions/column-mappings')
        const workspacesResult = await getMondayWorkspaces()
        
        if (workspacesResult.error) {
          toast.error('Error loading workspaces', { description: workspacesResult.error })
        } else if (workspacesResult.workspaces) {
          setWorkspaces(workspacesResult.workspaces)
        }
      } catch (error) {
        toast.error('Error loading workspaces', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
      
      // Restore saved workspace and board from localStorage
      if (typeof window !== 'undefined') {
        const savedWorkspace = localStorage.getItem('monday-mapping-workspace')
        const savedBoard = localStorage.getItem('monday-mapping-board')
        
        if (savedWorkspace) {
          setSelectedWorkspace(savedWorkspace)
        }
      }
      
      setLoading(false)
    }
    
    initialize()
  }, [])

  // Load boards when workspace is selected
  useEffect(() => {
    async function loadBoardsForWorkspace() {
      if (!selectedWorkspace) {
        setBoards([])
        setSelectedBoard('')
        setParentColumns([])
        setSubtaskColumns([])
        setMappings({})
        return
      }

      // Save workspace to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('monday-mapping-workspace', selectedWorkspace)
      }

      setLoadingBoards(true)
      
      try {
        const { getMondayBoardsAndColumns } = await import('@/app/actions/column-mappings')
        const boardsResult = await getMondayBoardsAndColumns(selectedWorkspace)

        if (boardsResult.error) {
          toast.error('Error loading boards', { description: boardsResult.error })
          setBoards([])
        } else if (boardsResult.boards) {
          setBoards(boardsResult.boards)
          
          // Restore saved board if it exists
          if (typeof window !== 'undefined') {
            const savedBoard = localStorage.getItem('monday-mapping-board')
            if (savedBoard && boardsResult.boards.some(b => b.id === savedBoard)) {
              setSelectedBoard(savedBoard)
            }
          }
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

  // Load columns and mappings when board is selected
  useEffect(() => {
    async function loadBoardData() {
      if (!selectedBoard || selectedBoard === 'all' || boards.length === 0) {
        setParentColumns([])
        setSubtaskColumns([])
        setMappings({})
        return
      }

      // Save board to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('monday-mapping-board', selectedBoard)
      }

      const board = boards.find((b) => b.id === selectedBoard)
      if (!board) return

      // Set columns
      const parentCols = board.parentColumns && board.parentColumns.length > 0 
        ? board.parentColumns 
        : board.columns
      
      const subtaskCols = board.subtaskColumns && board.subtaskColumns.length > 0
        ? board.subtaskColumns
        : board.columns
      
      setParentColumns(parentCols)
      setSubtaskColumns(subtaskCols)

      // Load mappings
      try {
        const { getColumnMappings } = await import('@/app/actions/column-mappings')
        const mappingsResult = await getColumnMappings(selectedBoard)

        if (mappingsResult.error) {
          setMappings({})
        } else if (mappingsResult.mappings && mappingsResult.mappings.length > 0) {
          const mappingObj: Record<string, string> = {}
          mappingsResult.mappings.forEach((m: any) => {
            mappingObj[m.column_type] = m.monday_column_id
          })
          setMappings(mappingObj)
        } else {
          setMappings({})
        }
      } catch (error) {
        setMappings({})
      }
    }

    loadBoardData()
  }, [selectedBoard, boards])

  async function handleSave(columnType: 'client' | 'quoted_hours' | 'timeline', columnId: string) {
    setSaving(true)
    try {
      const boardId = selectedBoard && selectedBoard !== 'all' ? selectedBoard : undefined
      const workspaceId = selectedWorkspace || undefined
      const result = await saveColumnMapping(columnType, columnId, boardId, workspaceId)
      
      if (result.error) {
        toast.error('Error saving mapping', { description: result.error })
      } else {
        setMappings((prev) => ({ ...prev, [columnType]: columnId }))
        toast.success('Column mapping saved')
      }
    } catch (error) {
      toast.error('Error saving mapping', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!confirm('Are you sure you want to reset all column mappings? This will delete all saved mappings.')) {
      return
    }

    const boardId = selectedBoard && selectedBoard !== 'all' ? selectedBoard : undefined
    
    // Delete mappings from database
    if (boardId) {
      const result = await deleteColumnMappings(boardId)
      if (result.error) {
        toast.error('Error deleting mappings', { description: result.error })
        return
      }
    }

    // Clear all state
    setSelectedWorkspace('')
    setSelectedBoard('')
    setMappings({})
    setParentColumns([])
    setSubtaskColumns([])
    setBoards([])

    // Clear localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('monday-mapping-workspace')
      localStorage.removeItem('monday-mapping-board')
    }

    toast.success('All mappings have been reset')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Check if all mappings are complete
  const allMappingsComplete = 
    mappings.client && 
    mappings.quoted_hours && 
    mappings.timeline && 
    selectedBoard && 
    selectedBoard !== 'all' &&
    boards.length > 0

  // If all mappings are complete, show summary
  if (allMappingsComplete) {
    const workspaceName = workspaces.find(w => w.id === selectedWorkspace)?.name || 'Unknown'
    const boardName = boards.find(b => b.id === selectedBoard)?.name || 'Unknown'
    const clientColumn = parentColumns.find(c => c.id === mappings.client)?.title || mappings.client
    const quotedHoursColumn = (subtaskColumns.find(c => c.id === mappings.quoted_hours) || 
      boards.flatMap(b => (b.subtaskColumns || b.columns || [])).find(c => c.id === mappings.quoted_hours))?.title || mappings.quoted_hours
    const timelineColumn = (subtaskColumns.find(c => c.id === mappings.timeline) || 
      boards.flatMap(b => (b.subtaskColumns || b.columns || [])).find(c => c.id === mappings.timeline))?.title || mappings.timeline

    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <h3 className="text-lg font-semibold text-green-900">Column Mappings Configured</h3>
            </div>
            <Button variant="outline" onClick={handleReset}>
              Reset Mappings
            </Button>
          </div>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-green-800 mb-1">Workspace</p>
              <p className="text-base text-green-900">{workspaceName}</p>
            </div>
            
            <div>
              <p className="text-sm font-medium text-green-800 mb-1">Board</p>
              <p className="text-base text-green-900">{boardName}</p>
            </div>
            
            <div className="pt-4 border-t border-green-200">
              <p className="text-sm font-medium text-green-800 mb-3">Column Mappings</p>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-green-700 mb-1">Client Column (from parent task)</p>
                  <p className="text-base font-medium text-green-900">{clientColumn}</p>
                </div>
                <div>
                  <p className="text-xs text-green-700 mb-1">Quoted Hours Column (from subtasks)</p>
                  <p className="text-base font-medium text-green-900">{quotedHoursColumn}</p>
                </div>
                <div>
                  <p className="text-xs text-green-700 mb-1">Timeline Column (from subtasks)</p>
                  <p className="text-base font-medium text-green-900">{timelineColumn}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show mapping form
  return (
    <div className="space-y-6">
      {/* Workspace Selection */}
      <div className="space-y-2">
        <Label htmlFor="workspace-select">Workspace *</Label>
        <Select 
          value={selectedWorkspace} 
          onValueChange={setSelectedWorkspace}
          disabled={loading}
        >
          <SelectTrigger id="workspace-select">
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
        <p className="text-xs text-muted-foreground">
          Select a workspace to view its boards.
        </p>
      </div>

      {/* Board Selection */}
      {selectedWorkspace && (
        <div className="space-y-2">
          <Label htmlFor="board-select">Board *</Label>
          {loadingBoards ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading boards...</span>
            </div>
          ) : (
            <Select 
              value={selectedBoard} 
              onValueChange={setSelectedBoard}
              disabled={loadingBoards || boards.length === 0}
            >
              <SelectTrigger id="board-select">
                <SelectValue placeholder={boards.length === 0 ? "No boards found" : "Select a board"} />
              </SelectTrigger>
              <SelectContent>
                {boards.map((board) => (
                  <SelectItem key={board.id} value={board.id}>
                    {board.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">
            Select a board to map columns.
          </p>
        </div>
      )}

      {/* Column Mappings */}
      {selectedBoard && selectedBoard !== 'all' && boards.length > 0 && (
        <>
          {/* Client Column */}
          <div className="space-y-2">
            <Label htmlFor="client-column">Client Column (from parent/main task)</Label>
            {mappings.client ? (
              <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <p className="font-medium text-green-900">
                    {parentColumns.find(c => c.id === mappings.client)?.title || mappings.client}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMappings(prev => ({ ...prev, client: '' }))}
                  disabled={saving}
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  Change
                </Button>
              </div>
            ) : (
              <Select
                value={mappings.client || ''}
                onValueChange={(value) => handleSave('client', value)}
                disabled={saving || parentColumns.length === 0}
              >
                <SelectTrigger id="client-column">
                  <SelectValue placeholder="Select Monday.com column" />
                </SelectTrigger>
                <SelectContent>
                  {parentColumns
                    .filter((col) => 
                      col.type === 'text' || 
                      col.type === 'text_with_label' || 
                      col.type === 'dropdown' || 
                      col.type === 'status'
                    )
                    .map((column) => (
                      <SelectItem key={column.id} value={column.id}>
                        {column.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Select a column from the main/parent task items (not subtasks)
            </p>
          </div>

          {/* Quoted Hours Column */}
          <div className="space-y-2">
            <Label htmlFor="quoted-hours-column">Quoted Hours Column (from subtasks)</Label>
            {mappings.quoted_hours ? (
              <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <p className="font-medium text-green-900">
                    {(subtaskColumns.find(c => c.id === mappings.quoted_hours) || 
                      boards.flatMap(b => (b.subtaskColumns || b.columns || [])).find(c => c.id === mappings.quoted_hours))?.title || mappings.quoted_hours}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMappings(prev => ({ ...prev, quoted_hours: '' }))}
                  disabled={saving}
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  Change
                </Button>
              </div>
            ) : (
              <Select
                value={mappings.quoted_hours || ''}
                onValueChange={(value) => handleSave('quoted_hours', value)}
                disabled={saving || subtaskColumns.length === 0}
              >
                <SelectTrigger id="quoted-hours-column">
                  <SelectValue placeholder="Select Monday.com column" />
                </SelectTrigger>
                <SelectContent>
                  {subtaskColumns
                    .filter((col) => 
                      col.type?.toLowerCase().includes('number') || 
                      col.type?.toLowerCase().includes('numeric') ||
                      col.type === 'numeric_rating' ||
                      col.type === 'formula' ||
                      col.type === 'rating' ||
                      col.type === 'hour' ||
                      col.type === 'duration' ||
                      col.id === 'estimated' ||
                      col.id.includes('estimat') ||
                      col.id.includes('hour')
                    )
                    .map((column) => {
                      if (!column.id || column.id.trim() === '') return null
                      return (
                        <SelectItem key={column.id} value={column.id}>
                          {column.title}
                        </SelectItem>
                      )
                    })
                    .filter(Boolean)}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Select a number column from subtask items (not parent tasks)
            </p>
          </div>

          {/* Timeline Column */}
          <div className="space-y-2">
            <Label htmlFor="timeline-column">Timeline Column (from subtasks)</Label>
            {mappings.timeline ? (
              <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <p className="font-medium text-green-900">
                    {(subtaskColumns.find(c => c.id === mappings.timeline) || 
                      boards.flatMap(b => (b.subtaskColumns || b.columns || [])).find(c => c.id === mappings.timeline))?.title || mappings.timeline}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMappings(prev => ({ ...prev, timeline: '' }))}
                  disabled={saving}
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  Change
                </Button>
              </div>
            ) : (
              <Select
                value={mappings.timeline || ''}
                onValueChange={(value) => handleSave('timeline', value)}
                disabled={saving || subtaskColumns.length === 0}
              >
                <SelectTrigger id="timeline-column">
                  <SelectValue placeholder="Select Monday.com column" />
                </SelectTrigger>
                <SelectContent>
                  {subtaskColumns
                    .filter((col) => 
                      col.type?.toLowerCase() === 'timeline' ||
                      col.type?.toLowerCase().includes('date') ||
                      col.type?.toLowerCase().includes('time') ||
                      col.type === 'date_range' ||
                      col.type === 'week' ||
                      col.type === 'datetime' ||
                      col.id === 'timerange_mky9t55j' ||
                      col.id.includes('timerange')
                    )
                    .map((column) => {
                      if (!column.id || column.id.trim() === '') return null
                      return (
                        <SelectItem key={column.id} value={column.id}>
                          {column.title}
                        </SelectItem>
                      )
                    })
                    .filter(Boolean)}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Select a timeline/date column from subtask items (not parent tasks)
            </p>
          </div>
        </>
      )}
    </div>
  )
}
