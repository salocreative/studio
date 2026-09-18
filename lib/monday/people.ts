/**
 * Monday people columns are stored as `{ personsAndTeams: [{ id, kind }] }`.
 * Older payloads used `{ personIds: [] }` or a raw array. Sync used to read only
 * `personIds`, so `assigned_user_ids` is often empty even when someone is assigned.
 */
export function parseMondayPersonIds(value: unknown): string[] {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []

  if (Array.isArray(parsed)) {
    return uniqueIds(parsed.map((entry) => personIdFromUnknown(entry)))
  }

  const record = parsed as {
    personIds?: unknown
    personsAndTeams?: Array<{ id?: number | string; kind?: string }>
  }

  if (Array.isArray(record.personsAndTeams)) {
    return uniqueIds(
      record.personsAndTeams
        .filter((entry) => entry?.id != null && entry.kind !== 'team')
        .map((entry) => String(entry.id))
    )
  }

  if (Array.isArray(record.personIds)) {
    return uniqueIds(record.personIds.map((id) => String(id)))
  }

  return []
}

export function parseMondayPeopleNames(text: string | null | undefined): string[] {
  if (!text?.trim()) return []
  return text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

export function normalisePersonName(name: string | null | undefined) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** People IDs and display names from the stored `monday_data` column dump. */
export function peopleFromMondayData(mondayData: Record<string, unknown> | null | undefined): {
  ids: string[]
  names: string[]
} {
  const ids: string[] = []
  const names: string[] = []
  if (!mondayData || typeof mondayData !== 'object') return { ids, names }

  for (const column of Object.values(mondayData)) {
    if (!column || typeof column !== 'object') continue
    const entry = column as { type?: unknown; value?: unknown; text?: unknown }
    if (entry.type !== 'people') continue
    ids.push(...parseMondayPersonIds(entry.value))
    if (typeof entry.text === 'string') {
      names.push(...parseMondayPeopleNames(entry.text))
    }
  }

  return { ids: uniqueIds(ids), names: [...new Set(names)] }
}

/** How many people Monday lists on the item; used to split quoted hours on shared subitems. */
export function mondayAssigneeCount(
  mondayData: Record<string, unknown> | null | undefined,
  assignedUserIds?: string[] | null
): number {
  const fromData = peopleFromMondayData(mondayData)
  const storedIds = (assignedUserIds || []).map(String).filter(Boolean)
  const mondayIds = fromData.ids.length > 0 ? fromData.ids : storedIds
  return Math.max(mondayIds.length, fromData.names.length, 1)
}

function personIdFromUnknown(entry: unknown): string | null {
  if (entry == null) return null
  if (typeof entry === 'string' || typeof entry === 'number') return String(entry)
  if (typeof entry === 'object') {
    const record = entry as { personId?: unknown; id?: unknown }
    const id = record.personId ?? record.id
    if (id != null) return String(id)
  }
  return null
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))]
}
