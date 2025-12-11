'use client'

import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getMondayBoardsAndColumns, getColumnMappings, saveColumnMapping, getMondayWorkspaces } from '@/app/actions/column-mappings'
import { getCompletedBoards, addCompletedBoard } from '@/app/actions/completed-boards'
import { getLeadsBoard, setLeadsBoard } from '@/app/actions/leads-board'
import { getFlexiDesignCompletedBoard, setFlexiDesignCompletedBoard } from '@/app/actions/flexi-design-completed-board'
import { Loader2, CheckCircle2, Edit2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'

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

interface BoardConfig {
  boardId: string | null
  boardName: string | null
  workspaceId: string | null
  workspaceName: string | null
  mappings: Record<string, string>
  isConfigured: boolean
}

type BoardType = 'main' | 'completed' | 'flexi-design' | 'flexi-design-completed' | 'leads'

interface BoardTypeConfig {
  type: BoardType
  title: string
  description: string
  requiredParentColumns: string[]
  requiredSubitemColumns: string[]
  config: BoardConfig
}

export function ColumnMappingForm() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('')
  const [allBoards, setAllBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Board configurations for each type
  const [boardConfigs, setBoardConfigs] = useState<Record<BoardType, BoardConfig>>({
    main: { boardId: null, boardName: null, workspaceId: null, workspaceName: null, mappings: {}, isConfigured: false },
    completed: { boardId: null, boardName: null, workspaceId: null, workspaceName: null, mappings: {}, isConfigured: false },
    'flexi-design': { boardId: null, boardName: null, workspaceId: null, workspaceName: null, mappings: {}, isConfigured: false },
    'flexi-design-completed': { boardId: null, boardName: null, workspaceId: null, workspaceName: null, mappings: {}, isConfigured: false },
    leads: { boardId: null, boardName: null, workspaceId: null, workspaceName: null, mappings: {}, isConfigured: false },
  })

  const [editingBoardType, setEditingBoardType] = useState<BoardType | null>(null)
  const [editingBoardColumns, setEditingBoardColumns] = useState<{ parentColumns: Column[]; subtaskColumns: Column[] } | null>(null)
  const [editingMappings, setEditingMappings] = useState<Record<string, string>>({})

  // Initialize: Load workspaces and board configurations
  useEffect(() => {
    async function initialize() {
      setLoading(true)
      
      try {
        // Load workspaces
        const workspacesResult = await getMondayWorkspaces()
        if (workspacesResult.error) {
          toast.error('Error loading workspaces', { description: workspacesResult.error })
        } else if (workspacesResult.workspaces) {
          setWorkspaces(workspacesResult.workspaces)
        }

        // Load all board configurations
        await loadAllBoardConfigs()
      } catch (error) {
        toast.error('Error initializing', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        setLoading(false)
      }
    }
    
    initialize()
  }, [])

  async function loadAllBoardConfigs() {
    try {
      // Load all configured boards
      const completedResult = await getCompletedBoards()
      const leadsResult = await getLeadsBoard()
      const flexiCompletedResult = await getFlexiDesignCompletedBoard()
      
      // Get all boards with mappings to identify main and flexi-design active boards
      const { getAllBoardsWithMappings } = await import('@/app/actions/column-mappings')
      const mappingsResult = await getAllBoardsWithMappings()
      
      if (mappingsResult.boards) {
        const allBoardIds = new Set(mappingsResult.boards.map(b => b.id))
        
        // Get configured board IDs to exclude
        const completedBoardIds = new Set((completedResult.boards || []).map(b => b.monday_board_id))
        const leadsBoardId = leadsResult.board?.monday_board_id || null
        const flexiCompletedBoardId = flexiCompletedResult.board?.monday_board_id || null

        const mainBoards = mappingsResult.boards.filter(b => 
          !b.isFlexiDesign && 
          !completedBoardIds.has(b.id) && 
          b.id !== leadsBoardId
        )
        const flexiBoards = mappingsResult.boards.filter(b => 
          b.isFlexiDesign && 
          b.id !== flexiCompletedBoardId
        )

        // Main projects: first active main board
        if (mainBoards.length > 0) {
          const mainBoard = mainBoards[0]
          const mappings = await loadMappingsForBoard(mainBoard.id)
          setBoardConfigs(prev => ({
            ...prev,
            main: {
              boardId: mainBoard.id,
              boardName: mainBoard.name,
              workspaceId: null,
              workspaceName: null,
              mappings,
              isConfigured: Object.keys(mappings).length > 0,
            }
          }))
        }

        // Completed projects: first completed board
        if (completedResult.boards && completedResult.boards.length > 0) {
          const completedBoard = completedResult.boards[0]
          const mappings = await loadMappingsForBoard(completedBoard.monday_board_id)
          setBoardConfigs(prev => ({
            ...prev,
            completed: {
              boardId: completedBoard.monday_board_id,
              boardName: completedBoard.board_name || 'Completed Projects',
              workspaceId: null,
              workspaceName: null,
              mappings,
              isConfigured: Object.keys(mappings).length > 0,
            }
          }))
        }

        // Flexi-Design projects: first active flexi board
        if (flexiBoards.length > 0) {
          const flexiBoard = flexiBoards[0]
          const mappings = await loadMappingsForBoard(flexiBoard.id)
          setBoardConfigs(prev => ({
            ...prev,
            'flexi-design': {
              boardId: flexiBoard.id,
              boardName: flexiBoard.name,
              workspaceId: null,
              workspaceName: null,
              mappings,
              isConfigured: Object.keys(mappings).length > 0,
            }
          }))
        }

        // Flexi-Design completed
        if (flexiCompletedResult.board) {
          const mappings = await loadMappingsForBoard(flexiCompletedResult.board.monday_board_id)
          setBoardConfigs(prev => ({
            ...prev,
            'flexi-design-completed': {
              boardId: flexiCompletedResult.board!.monday_board_id,
              boardName: flexiCompletedResult.board!.board_name || 'Flexi-Design Completed',
              workspaceId: null,
              workspaceName: null,
              mappings,
              isConfigured: Object.keys(mappings).length > 0,
            }
          }))
        }

        // Leads
        if (leadsResult.board) {
          const mappings = await loadMappingsForBoard(leadsResult.board.monday_board_id)
          setBoardConfigs(prev => ({
            ...prev,
            leads: {
              boardId: leadsResult.board!.monday_board_id,
              boardName: leadsResult.board!.board_name || 'Leads',
              workspaceId: null,
              workspaceName: null,
              mappings,
              isConfigured: Object.keys(mappings).length > 0,
            }
          }))
        }
      }
    } catch (error) {
      console.error('Error loading board configs:', error)
    }
  }

  async function loadMappingsForBoard(boardId: string) {
    try {
      const mappingsResult = await getColumnMappings(boardId)
      if (mappingsResult.mappings) {
        const mappingObj: Record<string, string> = {}
        mappingsResult.mappings.forEach((m: any) => {
          mappingObj[m.column_type] = m.monday_column_id
        })
        return mappingObj
      }
    } catch (error) {
      console.error('Error loading mappings:', error)
    }
    return {}
  }

  async function configureBoardForType(boardType: BoardType, boardId: string, boardName: string) {
    try {
      switch (boardType) {
        case 'completed':
          const addResult = await addCompletedBoard(boardId, boardName)
          if (addResult.error) {
            toast.error('Error configuring completed board', { description: addResult.error })
          } else {
            toast.success('Completed board configured')
          }
          break
        case 'leads':
          const leadsResult = await setLeadsBoard(boardId, boardName)
          if (leadsResult.error) {
            toast.error('Error configuring leads board', { description: leadsResult.error })
          } else {
            toast.success('Leads board configured')
          }
          break
        case 'flexi-design-completed':
          const flexiResult = await setFlexiDesignCompletedBoard(boardId, boardName)
          if (flexiResult.error) {
            toast.error('Error configuring Flexi-Design completed board', { description: flexiResult.error })
          } else {
            toast.success('Flexi-Design completed board configured')
          }
          break
        case 'main':
        case 'flexi-design':
          // These don't need special configuration - they're identified by having column mappings
          // and not being in the other tables
          break
      }
    } catch (error) {
      console.error('Error configuring board:', error)
      toast.error('Error configuring board', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // Load boards when workspace is selected
  useEffect(() => {
    async function loadBoardsForWorkspace() {
      if (!selectedWorkspace) {
        setAllBoards([])
        return
      }

      setLoadingBoards(true)
      
      try {
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

  async function startEditing(boardType: BoardType) {
    const config = boardConfigs[boardType]
    
    if (!config.boardId) {
      toast.error('Please select a board first')
      return
    }

    setEditingBoardType(boardType)
    
    // Find the board in allBoards to get columns
    const board = allBoards.find(b => b.id === config.boardId)
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
    } else {
      // Need to load board columns - trigger workspace/board selection
      toast.info('Please select the workspace and board first')
      return
    }

    // Load existing mappings
    setEditingMappings(config.mappings)
  }

  function cancelEditing() {
    setEditingBoardType(null)
    setEditingBoardColumns(null)
    setEditingMappings({})
  }

  async function handleSave(columnType: 'client' | 'quoted_hours' | 'timeline' | 'quote_value', columnId: string) {
    if (!editingBoardType) return
    
    const config = boardConfigs[editingBoardType]
    if (!config.boardId) return
    
    setSaving(true)
    try {
      const workspaceId = config.workspaceId || selectedWorkspace || undefined
      const result = await saveColumnMapping(columnType, columnId, config.boardId, workspaceId)
      
      if (result.error) {
        toast.error('Error saving mapping', { description: result.error })
      } else {
        setEditingMappings((prev) => ({ ...prev, [columnType]: columnId }))
        toast.success('Column mapping saved')
        
        // Update board config
        setBoardConfigs(prev => ({
          ...prev,
          [editingBoardType]: {
            ...prev[editingBoardType],
            mappings: { ...prev[editingBoardType].mappings, [columnType]: columnId },
            isConfigured: true,
          }
        }))
        
        // Reload all configs to ensure consistency
        await loadAllBoardConfigs()
      }
    } catch (error) {
      toast.error('Error saving mapping', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  const boardTypeConfigs: BoardTypeConfig[] = [
    {
      type: 'main',
      title: 'Main Projects',
      description: 'Active project boards for ongoing work',
      requiredParentColumns: ['client', 'quote_value'],
      requiredSubitemColumns: ['quoted_hours', 'timeline'],
      config: boardConfigs.main,
    },
    {
      type: 'completed',
      title: 'Completed Projects',
      description: 'Boards where completed projects are archived',
      requiredParentColumns: ['client', 'quote_value'],
      requiredSubitemColumns: ['quoted_hours', 'timeline'],
      config: boardConfigs.completed,
    },
    {
      type: 'flexi-design',
      title: 'Flexi-Design Projects',
      description: 'Active Flexi-Design project boards',
      requiredParentColumns: ['client'],
      requiredSubitemColumns: ['quoted_hours', 'timeline'],
      config: boardConfigs['flexi-design'],
    },
    {
      type: 'flexi-design-completed',
      title: 'Flexi-Design Completed Projects',
      description: 'Board where completed Flexi-Design projects are archived',
      requiredParentColumns: ['client'],
      requiredSubitemColumns: ['quoted_hours', 'timeline'],
      config: boardConfigs['flexi-design-completed'],
    },
    {
      type: 'leads',
      title: 'Leads',
      description: 'Board for potential projects and leads',
      requiredParentColumns: ['client', 'quote_value'],
      requiredSubitemColumns: ['quoted_hours', 'timeline'],
      config: boardConfigs.leads,
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Show editing form if a board is being edited
  if (editingBoardType && editingBoardColumns) {
    const boardTypeConfig = boardTypeConfigs.find(btc => btc.type === editingBoardType)
    const config = boardConfigs[editingBoardType]

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Edit Column Mappings: {boardTypeConfig?.title}</h3>
            <p className="text-sm text-muted-foreground">{config.boardName || 'Select a board'}</p>
          </div>
          <Button variant="outline" onClick={cancelEditing}>
            Back
          </Button>
        </div>

        <BoardMappingEditor
          boardName={config.boardName || 'Unknown'}
          parentColumns={editingBoardColumns.parentColumns}
          subtaskColumns={editingBoardColumns.subtaskColumns}
          mappings={editingMappings}
          onSave={handleSave}
          onMappingChange={setEditingMappings}
          saving={saving}
          requiredParentColumns={boardTypeConfig?.requiredParentColumns || []}
          requiredSubitemColumns={boardTypeConfig?.requiredSubitemColumns || []}
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
            <SelectValue placeholder="Select a workspace to configure boards" />
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

      {/* Board Type Sections */}
      <div className="space-y-6">
        {boardTypeConfigs.map((boardTypeConfig) => {
          const config = boardTypeConfig.config
          const hasAllRequired = boardTypeConfig.requiredParentColumns.every(col => config.mappings[col]) &&
                                 boardTypeConfig.requiredSubitemColumns.every(col => config.mappings[col])
          
          return (
            <Card key={boardTypeConfig.type} className={hasAllRequired ? 'border-green-200' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      {boardTypeConfig.title}
                      {hasAllRequired && <CheckCircle2 className="h-5 w-5 text-green-600" />}
                    </CardTitle>
                    <CardDescription>{boardTypeConfig.description}</CardDescription>
                  </div>
                  {config.boardId && (
                    <Button variant="outline" size="sm" onClick={() => startEditing(boardTypeConfig.type)}>
                      <Edit2 className="h-4 w-4 mr-2" />
                      Configure
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Board Selection */}
                <div className="space-y-2">
                  <Label>Board</Label>
                  {config.boardId ? (
                    <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
                      <div>
                        <p className="font-medium">{config.boardName}</p>
                        <p className="text-xs text-muted-foreground">Board ID: {config.boardId}</p>
                      </div>
                      <Badge variant={hasAllRequired ? 'default' : 'secondary'}>
                        {hasAllRequired ? 'Configured' : 'Partial'}
                      </Badge>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-center">
                      <p className="text-sm text-muted-foreground mb-2">No board selected</p>
                      {selectedWorkspace ? (
                        <Select
                          value=""
                          onValueChange={async (value) => {
                            const board = allBoards.find(b => b.id === value)
                            if (board) {
                              // First, configure the board in the appropriate table
                              await configureBoardForType(boardTypeConfig.type, board.id, board.name)
                              
                              // Update local state
                              setBoardConfigs(prev => ({
                                ...prev,
                                [boardTypeConfig.type]: {
                                  ...prev[boardTypeConfig.type],
                                  boardId: board.id,
                                  boardName: board.name,
                                  workspaceId: selectedWorkspace,
                                  workspaceName: workspaces.find(w => w.id === selectedWorkspace)?.name || null,
                                }
                              }))
                              
                              // Reload board configs to get updated state
                              await loadAllBoardConfigs()
                              
                              // Auto-start editing after selection
                              setTimeout(() => startEditing(boardTypeConfig.type), 300)
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a board..." />
                          </SelectTrigger>
                          <SelectContent>
                            {allBoards
                              .filter(b => !b.name.toLowerCase().startsWith('subitems of'))
                              .map((board) => (
                                <SelectItem key={board.id} value={board.id}>
                                  {board.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-xs text-muted-foreground">Please select a workspace above</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Required Columns Status */}
                {config.boardId && (
                  <div className="space-y-3 pt-2 border-t">
                    <div>
                      <Label className="text-xs font-semibold mb-2 block">Parent Columns (Main Task)</Label>
                      <div className="space-y-1">
                        {boardTypeConfig.requiredParentColumns.map((colType) => {
                          const isConfigured = !!config.mappings[colType]
                          return (
                            <div key={colType} className="flex items-center justify-between text-sm">
                              <span className={isConfigured ? 'text-foreground' : 'text-muted-foreground'}>
                                {colType === 'client' ? 'Client' : colType === 'quote_value' ? 'Quote Value' : colType}
                              </span>
                              {isConfigured ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-amber-500" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold mb-2 block">Subitem Columns (Subtasks)</Label>
                      <div className="space-y-1">
                        {boardTypeConfig.requiredSubitemColumns.map((colType) => {
                          const isConfigured = !!config.mappings[colType]
                          return (
                            <div key={colType} className="flex items-center justify-between text-sm">
                              <span className={isConfigured ? 'text-foreground' : 'text-muted-foreground'}>
                                {colType === 'quoted_hours' ? 'Quoted Hours' : colType === 'timeline' ? 'Timeline' : colType}
                              </span>
                              {isConfigured ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-amber-500" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
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
  requiredParentColumns,
  requiredSubitemColumns,
}: {
  boardName: string
  parentColumns: Column[]
  subtaskColumns: Column[]
  mappings: Record<string, string>
  onSave: (columnType: 'client' | 'quoted_hours' | 'timeline' | 'quote_value', columnId: string) => Promise<void>
  onMappingChange: (mappings: Record<string, string>) => void
  saving: boolean
  requiredParentColumns: string[]
  requiredSubitemColumns: string[]
}) {
  
  const renderColumnMapping = (
    columnType: 'client' | 'quoted_hours' | 'timeline' | 'quote_value',
    label: string,
    description: string,
    columns: Column[],
    filterFn?: (col: Column) => boolean,
    isRequired: boolean = false
  ) => {
    const isParent = columnType === 'client' || columnType === 'quote_value'
    const isConfigured = !!mappings[columnType]
    
    return (
      <div className="space-y-2">
        <Label htmlFor={`${columnType}-column`} className={isRequired ? 'font-semibold' : ''}>
          {label} {isRequired && <span className="text-destructive">*</span>}
        </Label>
        {isConfigured ? (
          <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <p className="font-medium text-green-900">
                {columns.find(c => c.id === mappings[columnType])?.title || mappings[columnType]}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMappingChange({ ...mappings, [columnType]: '' })}
              disabled={saving}
            >
              <Edit2 className="h-4 w-4 mr-1" />
              Change
            </Button>
          </div>
        ) : (
          <Select
            value={mappings[columnType] || ''}
            onValueChange={(value) => onSave(columnType, value)}
            disabled={saving || columns.length === 0}
          >
            <SelectTrigger id={`${columnType}-column`}>
              <SelectValue placeholder={`Select ${label.toLowerCase()}...`} />
            </SelectTrigger>
            <SelectContent>
              {(filterFn ? columns.filter(filterFn) : columns).map((column) => (
                <SelectItem key={column.id} value={column.id}>
                  {column.title} {column.type && `(${column.type})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Parent Columns */}
      <div className="space-y-4">
        <div>
          <h4 className="font-semibold mb-1">Parent Columns (Main Task Items)</h4>
          <p className="text-sm text-muted-foreground">
            These columns are from the main/parent task items, not subtasks.
          </p>
        </div>

        {requiredParentColumns.includes('client') && renderColumnMapping(
          'client',
          'Client Column',
          'Select the column that contains the client name',
          parentColumns,
          (col) => ['text', 'text_with_label', 'dropdown', 'status'].includes(col.type),
          true
        )}

        {requiredParentColumns.includes('quote_value') && renderColumnMapping(
          'quote_value',
          'Quote Value Column',
          'Select the number/currency column that stores project values',
          parentColumns,
          (col) => 
            col.type?.toLowerCase().includes('number') || 
            col.type?.toLowerCase().includes('numeric') ||
            col.type === 'numeric_rating' ||
            col.type === 'formula' ||
            col.type === 'currency' ||
            col.type === 'rating' ||
            col.id?.toLowerCase().includes('value') ||
            col.title?.toLowerCase().includes('value'),
          true
        )}
      </div>

      {/* Subitem Columns */}
      <div className="space-y-4">
        <div>
          <h4 className="font-semibold mb-1">Subitem Columns (Subtasks)</h4>
          <p className="text-sm text-muted-foreground">
            These columns are from subtask items, not parent tasks.
          </p>
        </div>

        {requiredSubitemColumns.includes('quoted_hours') && renderColumnMapping(
          'quoted_hours',
          'Quoted Hours Column',
          'Select the number column that stores estimated hours for subtasks',
          subtaskColumns,
          (col) => 
            col.type?.toLowerCase().includes('number') || 
            col.type?.toLowerCase().includes('numeric') ||
            col.type === 'numeric_rating' ||
            col.type === 'formula' ||
            col.type === 'rating' ||
            col.type === 'hour' ||
            col.type === 'duration' ||
            col.id === 'estimated' ||
            col.id.includes('estimat') ||
            col.id.includes('hour'),
          true
        )}

        {requiredSubitemColumns.includes('timeline') && renderColumnMapping(
          'timeline',
          'Timeline Column',
          'Select the timeline/date column that stores task timelines',
          subtaskColumns,
          (col) => 
            col.type?.toLowerCase() === 'timeline' ||
            col.type?.toLowerCase().includes('date') ||
            col.type?.toLowerCase().includes('time') ||
            col.type === 'date_range' ||
            col.type === 'week' ||
            col.type === 'datetime' ||
            col.id === 'timerange_mky9t55j' ||
            col.id.includes('timerange'),
          true
        )}
      </div>
    </div>
  )
}
