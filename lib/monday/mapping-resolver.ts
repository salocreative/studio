export type ColumnMappingRow = {
  monday_column_id: string
  board_id: string | null
  column_type: string
}

/**
 * Resolve a Monday column ID for a board: board-specific mapping first, then global (board_id null).
 */
export function findMappingColumnId(
  mappings: ColumnMappingRow[] | null | undefined,
  columnType: string,
  boardId: string | null | undefined
): string | null {
  const rows = mappings?.filter((m) => m.column_type === columnType) ?? []
  if (rows.length === 0) return null

  if (boardId) {
    const boardMapping = rows.find((m) => m.board_id === boardId)
    if (boardMapping) return boardMapping.monday_column_id
    const globalMapping = rows.find((m) => !m.board_id)
    if (globalMapping) return globalMapping.monday_column_id
  }

  return rows[0]?.monday_column_id ?? null
}
