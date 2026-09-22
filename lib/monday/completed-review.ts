import { mondayRequest } from '@/lib/monday/api'

/** Monday caps `items(ids:)` at this limit; ids beyond it are dropped, not paged. */
const MONDAY_ITEMS_BY_ID_LIMIT = 100
const ITEMS_PAGE_LIMIT = 500

export type MondayItemLite = {
  id: string
  name: string
  boardId: string
  boardName: string
}

type BoardPage = {
  id: string
  name: string
  items_page: {
    cursor?: string | null
    items: Array<{ id: string; name: string }>
  }
}

/**
 * Scan completed boards for item id + name only. Much cheaper than a full sync: no column
 * values, no subitems. Used to diff Studio's locked jobs against what is actually on Monday.
 */
export async function fetchMondayBoardItemsLite(
  accessToken: string,
  boardIds: string[]
): Promise<MondayItemLite[]> {
  if (boardIds.length === 0) return []

  const data = await mondayRequest<{ boards: BoardPage[] }>(
    accessToken,
    `query($boardIds: [ID!]) {
      boards(ids: $boardIds) {
        id
        name
        items_page(limit: ${ITEMS_PAGE_LIMIT}) {
          cursor
          items { id name }
        }
      }
    }`,
    { boardIds }
  )

  const items: MondayItemLite[] = []
  const cursorQueue: Array<{ boardId: string; boardName: string; cursor: string }> = []

  for (const board of data.boards || []) {
    const boardId = String(board.id)
    const boardName = board.name || ''
    for (const item of board.items_page?.items || []) {
      items.push({
        id: String(item.id),
        name: item.name || '',
        boardId,
        boardName,
      })
    }
    if (board.items_page?.cursor) {
      cursorQueue.push({ boardId, boardName, cursor: board.items_page.cursor })
    }
  }

  while (cursorQueue.length > 0) {
    const { boardId, boardName, cursor } = cursorQueue.shift()!
    const next = await mondayRequest<{
      next_items_page: { cursor?: string | null; items: Array<{ id: string; name: string }> }
    }>(
      accessToken,
      `query($cursor: String!) {
        next_items_page(cursor: $cursor) {
          cursor
          items { id name }
        }
      }`,
      { cursor }
    )

    const page = next.next_items_page
    for (const item of page?.items || []) {
      items.push({
        id: String(item.id),
        name: item.name || '',
        boardId,
        boardName,
      })
    }
    if (page?.cursor) {
      cursorQueue.push({ boardId, boardName, cursor: page.cursor })
    }
  }

  return items
}

/**
 * Look up items by ID across any board. Deleted Monday items are omitted from the response.
 */
export async function fetchMondayItemsById(
  accessToken: string,
  itemIds: string[]
): Promise<MondayItemLite[]> {
  const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)))
  if (uniqueIds.length === 0) return []

  const found: MondayItemLite[] = []
  for (let i = 0; i < uniqueIds.length; i += MONDAY_ITEMS_BY_ID_LIMIT) {
    const batch = uniqueIds.slice(i, i + MONDAY_ITEMS_BY_ID_LIMIT)
    const data = await mondayRequest<{
      items: Array<{
        id: string
        name: string
        board?: { id: string; name?: string } | null
      }>
    }>(
      accessToken,
      `query($itemIds: [ID!], $limit: Int!) {
        items(ids: $itemIds, limit: $limit) {
          id
          name
          board { id name }
        }
      }`,
      { itemIds: batch, limit: MONDAY_ITEMS_BY_ID_LIMIT }
    )

    for (const item of data.items || []) {
      found.push({
        id: String(item.id),
        name: item.name || '',
        boardId: item.board?.id != null ? String(item.board.id) : '',
        boardName: item.board?.name || '',
      })
    }
  }

  return found
}

export function namesDiffer(a: string, b: string) {
  return a.trim() !== b.trim()
}
