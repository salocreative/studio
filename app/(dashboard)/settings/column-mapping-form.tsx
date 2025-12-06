'use client'

import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getMondayBoardsAndColumns, getColumnMappings, saveColumnMapping, getAllBoardsWithMappings } from '@/app/actions/column-mappings'
import { Loader2, CheckCircle2, Edit2, Plus } from 'lucide-react'
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

interface BoardWithMappings {
  id: string
  name: string
  mappings: Record<string, string>
  isFlexiDesign: boolean
}

export function ColumnMappingForm() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('')
  const [boardsWithMappings, setBoardsWithMappings] = useState<BoardWithMappings[]>([])
  const [allBoards, setAllBoards] = useState<Board[]>([])
  const [editingBoard, setEditingBoard] = useState<string | null>(null)
  const [editingBoardColumns, setEditingBoardColumns] = useState<{ parentColumns: Column[]; subtaskColumns: Column[] } | null>(null)
  const [editingMappings, setEditingMappings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [saving, setSaving] = useState(false)

  // Initialize: Load workspaces and existing mappings
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
      
      // Load existing board mappings
      await loadBoardMappings()
      
      // Restore saved workspace from localStorage
      if (typeof window !== 'undefined') {
        const savedWorkspace = localStorage.getItem('monday-mapping-workspace')
        if (savedWorkspace) {
          setSelectedWorkspace(savedWorkspace)
        }
      }
      
      setLoading(false)
    }
    
    initialize()
  }, [])

  async function loadBoardMappings() {
    try {
      const { getAllBoardsWithMappings } = await import('@/app/actions/column-mappings')
      const result = await getAllBoardsWithMappings()
      
      if (result.error) {
        console.error('Error loading board mappings:', result.error)
      } else if (result.boards) {
        setBoardsWithMappings(result.boards)
      }
    } catch (error) {
      console.error('Error loading board mappings:', error)
    }
  }

  // Load boards when workspace is selected
  useEffect(() => {
    async function loadBoardsForWorkspace() {
      if (!selectedWorkspace) {
        setAllBoards([])
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
          setAllBoards([])
        } else if (boardsResult.boards) {
          setAllBoards(boardsResult.boards)
        } else {
          setAllBoards([])
        }
      } catch (error) {
        toast.error('Error loading boards', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        setAllBoards([])
      } finally {
        setLoadingBoards(false)
      }
    }

    loadBoardsForWorkspace()
  }, [selectedWorkspace])

  async function startEditing(boardId: string) {
    setEditingBoard(boardId)
    
    // Find the board in allBoards to get columns
    const board = allBoards.find(b => b.id === boardId)
    if (board) {
      const parentCols = board.parentColumns && board.parentColumns.length > 0 
        ? board.parentColumns 
        : board.columns
      
      const subtaskCols = board.subtaskColumns && board.subtaskColumns.length > 0
        ? board.subtaskColumns
        : []
      
      setEditingBoardColumns({
        parentColumns: parentCols,
        subtaskColumns: subtaskCols,
      })
    }

    // Load existing mappings
    try {
      const { getColumnMappings } = await import('@/app/actions/column-mappings')
      const mappingsResult = await getColumnMappings(boardId)

      if (mappingsResult.error) {
        setEditingMappings({})
      } else if (mappingsResult.mappings && mappingsResult.mappings.length > 0) {
        const mappingObj: Record<string, string> = {}
        mappingsResult.mappings.forEach((m: any) => {
          mappingObj[m.column_type] = m.monday_column_id
        })
        setEditingMappings(mappingObj)
      } else {
        setEditingMappings({})
      }
    } catch (error) {
      setEditingMappings({})
    }
  }

  function cancelEditing() {
    setEditingBoard(null)
    setEditingBoardColumns(null)
    setEditingMappings({})
  }

  async function handleSave(columnType: 'client' | 'quoted_hours' | 'timeline', columnId: string) {
    if (!editingBoard) return
    
    setSaving(true)
    try {
      const workspaceId = selectedWorkspace || undefined
      const result = await saveColumnMapping(columnType, columnId, editingBoard, workspaceId)
      
      if (result.error) {
        toast.error('Error saving mapping', { description: result.error })
      } else {
        setEditingMappings((prev) => ({ ...prev, [columnType]: columnId }))
        toast.success('Column mapping saved')
        // Reload board mappings to update the display
        await loadBoardMappings()
      }
    } catch (error) {
      toast.error('Error saving mapping', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  const mainProjectsBoards = boardsWithMappings.filter(b => !b.isFlexiDesign)
  const flexiDesignBoards = boardsWithMappings.filter(b => b.isFlexiDesign)
  // Filter out "Subitems of" boards and already configured boards
  const unconfiguredBoards = allBoards.filter(b => 
    !boardsWithMappings.some(bwm => bwm.id === b.id) &&
    !b.name.toLowerCase().startsWith('subitems of')
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Show editing form if a board is being edited
  if (editingBoard && editingBoardColumns) {
    const board = allBoards.find(b => b.id === editingBoard)
    const boardName = board?.name || boardsWithMappings.find(b => b.id === editingBoard)?.name || 'Unknown'

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Edit Column Mappings: {boardName}</h3>
            <p className="text-sm text-muted-foreground">Configure column mappings for this board</p>
          </div>
          <Button variant="outline" onClick={cancelEditing}>
            Cancel
          </Button>
        </div>

        <BoardMappingEditor
          boardName={boardName}
          parentColumns={editingBoardColumns.parentColumns}
          subtaskColumns={editingBoardColumns.subtaskColumns}
          mappings={editingMappings}
          onSave={handleSave}
          onMappingChange={setEditingMappings}
          saving={saving}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Workspace Selection */}
      <div className="space-y-2">
        <Label htmlFor="workspace-select">Workspace</Label>
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
          Select a workspace to configure new board mappings.
        </p>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Main Projects Column */}
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">Main Projects</h3>
            <p className="text-sm text-muted-foreground">
              Column mappings for main project boards
            </p>
          </div>

          {mainProjectsBoards.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <p className="text-sm text-muted-foreground mb-4">No main project boards configured</p>
                {selectedWorkspace && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      // Show board selector for main projects
                      const availableBoards = unconfiguredBoards.filter(b => 
                        !b.name.toLowerCase().includes('flexi')
                      )
                      if (availableBoards.length > 0) {
                        // For now, just show a message - we'll implement a dialog later
                        toast.info('Select a board from the workspace to configure mappings')
                      }
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Board Mapping
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            mainProjectsBoards.map((board) => (
              <BoardMappingCard
                key={board.id}
                board={board}
                allBoards={allBoards}
                onEdit={() => startEditing(board.id)}
              />
            ))
          )}

          {/* Show available boards to configure */}
          {selectedWorkspace && unconfiguredBoards.filter(b => !b.name.toLowerCase().includes('flexi')).length > 0 && (
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Available boards to configure:</p>
                  {unconfiguredBoards
                    .filter(b => !b.name.toLowerCase().includes('flexi'))
                    .map((board) => (
                      <Button
                        key={board.id}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => startEditing(board.id)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Configure {board.name}
                      </Button>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Flexi-Design Column */}
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">Flexi-Design</h3>
            <p className="text-sm text-muted-foreground">
              Column mappings for Flexi-Design boards
            </p>
          </div>

          {flexiDesignBoards.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <p className="text-sm text-muted-foreground mb-4">No Flexi-Design boards configured</p>
                {selectedWorkspace && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      toast.info('Select a Flexi-Design board from the workspace to configure mappings')
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Board Mapping
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            flexiDesignBoards.map((board) => (
              <BoardMappingCard
                key={board.id}
                board={board}
                allBoards={allBoards}
                onEdit={() => startEditing(board.id)}
              />
            ))
          )}

          {/* Show available Flexi-Design boards to configure */}
          {selectedWorkspace && unconfiguredBoards.filter(b => b.name.toLowerCase().includes('flexi')).length > 0 && (
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Available boards to configure:</p>
                  {unconfiguredBoards
                    .filter(b => b.name.toLowerCase().includes('flexi'))
                    .map((board) => (
                      <Button
                        key={board.id}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => startEditing(board.id)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Configure {board.name}
                      </Button>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function BoardMappingCard({
  board,
  allBoards,
  onEdit,
}: {
  board: BoardWithMappings
  allBoards: Board[]
  onEdit: () => void
}) {
  const hasAllMappings = board.mappings.client && board.mappings.quoted_hours && board.mappings.timeline
  
  // Get column titles from allBoards if available
  const boardDetails = allBoards.find(b => b.id === board.id)
  const getColumnTitle = (columnId: string, isSubtask: boolean = false) => {
    if (!boardDetails) return columnId
    
    if (isSubtask) {
      const col = boardDetails.subtaskColumns?.find(c => c.id === columnId) ||
                  boardDetails.columns.find(c => c.id === columnId)
      return col?.title || columnId
    } else {
      const col = boardDetails.parentColumns?.find(c => c.id === columnId) ||
                  boardDetails.columns.find(c => c.id === columnId)
      return col?.title || columnId
    }
  }

  return (
    <Card className={hasAllMappings ? 'border-green-200' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{board.name}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Edit2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasAllMappings ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-green-700">Fully configured</span>
            </div>
            <div className="space-y-2 pt-2 border-t">
              <div>
                <p className="text-xs text-muted-foreground">Client Column</p>
                <p className="text-sm font-medium">{getColumnTitle(board.mappings.client || '', false)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Quoted Hours Column</p>
                <p className="text-sm font-medium">{getColumnTitle(board.mappings.quoted_hours || '', true)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Timeline Column</p>
                <p className="text-sm font-medium">{getColumnTitle(board.mappings.timeline || '', true)}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Partially configured</p>
            <div className="space-y-1 text-xs">
              {board.mappings.client && (
                <p className="text-muted-foreground">
                  ✓ Client: {getColumnTitle(board.mappings.client, false)}
                </p>
              )}
              {board.mappings.quoted_hours && (
                <p className="text-muted-foreground">
                  ✓ Quoted Hours: {getColumnTitle(board.mappings.quoted_hours, true)}
                </p>
              )}
              {board.mappings.timeline && (
                <p className="text-muted-foreground">
                  ✓ Timeline: {getColumnTitle(board.mappings.timeline, true)}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BoardMappingEditor({
  boardName,
  parentColumns,
  subtaskColumns,
  mappings,
  onSave,
  onMappingChange,
  saving,
}: {
  boardName: string
  parentColumns: Column[]
  subtaskColumns: Column[]
  mappings: Record<string, string>
  onSave: (columnType: 'client' | 'quoted_hours' | 'timeline', columnId: string) => Promise<void>
  onMappingChange: (mappings: Record<string, string>) => void
  saving: boolean
}) {
  return (
    <div className="space-y-6">
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
              onClick={() => onMappingChange({ ...mappings, client: '' })}
              disabled={saving}
            >
              <Edit2 className="h-4 w-4 mr-1" />
              Change
            </Button>
          </div>
        ) : (
          <Select
            value={mappings.client || ''}
            onValueChange={(value) => onSave('client', value)}
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
                {subtaskColumns.find(c => c.id === mappings.quoted_hours)?.title || mappings.quoted_hours}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMappingChange({ ...mappings, quoted_hours: '' })}
              disabled={saving}
            >
              <Edit2 className="h-4 w-4 mr-1" />
              Change
            </Button>
          </div>
        ) : (
          <Select
            value={mappings.quoted_hours || ''}
            onValueChange={(value) => onSave('quoted_hours', value)}
            disabled={saving || subtaskColumns.length === 0}
          >
            <SelectTrigger id="quoted-hours-column">
              <SelectValue placeholder={subtaskColumns.length === 0 ? "No subtask columns found" : "Select Monday.com column"} />
            </SelectTrigger>
            {subtaskColumns.length > 0 && (
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
                        {column.title} ({column.type})
                      </SelectItem>
                    )
                  })
                  .filter(Boolean)}
              </SelectContent>
            )}
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          {subtaskColumns.length === 0 
            ? "⚠️ No subtask columns found. Make sure the board has items with subtasks."
            : "Select a number column from subtask items (not parent tasks)"}
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
                {subtaskColumns.find(c => c.id === mappings.timeline)?.title || mappings.timeline}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMappingChange({ ...mappings, timeline: '' })}
              disabled={saving}
            >
              <Edit2 className="h-4 w-4 mr-1" />
              Change
            </Button>
          </div>
        ) : (
          <Select
            value={mappings.timeline || ''}
            onValueChange={(value) => onSave('timeline', value)}
            disabled={saving || subtaskColumns.length === 0}
          >
            <SelectTrigger id="timeline-column">
              <SelectValue placeholder={subtaskColumns.length === 0 ? "No subtask columns found" : "Select Monday.com column"} />
            </SelectTrigger>
            {subtaskColumns.length > 0 && (
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
                        {column.title} ({column.type})
                      </SelectItem>
                    )
                  })
                  .filter(Boolean)}
              </SelectContent>
            )}
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          {subtaskColumns.length === 0 
            ? "⚠️ No subtask columns found. Make sure the board has items with subtasks."
            : "Select a timeline/date column from subtask items (not parent tasks)"}
        </p>
      </div>
    </div>
  )
}
