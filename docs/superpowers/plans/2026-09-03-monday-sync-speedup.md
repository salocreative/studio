# Monday Sync Speed-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quick Sync from the Time Tracking page finish in seconds rather than minutes by removing per-project and per-task round trips in `syncMondayData`.

**Architecture:** All work is inside `lib/monday/api.ts`; the route, the cron and the page are untouched. The sync loop currently makes ~7 Supabase calls plus 1 Monday call per project and 2 Supabase calls per task, all sequential, and fully re-syncs locked (completed) projects every run. We (1) skip subitem sync for projects already locked, (2) load every lookup once before the loop, (3) replace select-then-insert/update pairs with `upsert` on the existing `monday_item_id` unique constraints and make orphan cleanup set-based, and (4) fetch subitems for 25 projects per Monday request instead of one.

**Tech Stack:** Next.js 16 route handler, `@supabase/supabase-js` admin client, Monday.com GraphQL v2 (`items(ids: [...])`).

**Spec:** No separate spec. The investigation summary in this plan's "Background" section is the source.

## Global Constraints

- Only `lib/monday/api.ts` changes. `app/api/sync/monday/route.ts`, `app/api/sync/cron/route.ts`, `app/actions/monday.ts` and the page keep working with the current `syncMondayData(accessToken, onProgress?, syncAllBoards?, avoidDeletion?)` signature and the current `SyncProgressEvent` shape.
- Behavioural invariants that must hold after every task:
  - Locked projects stay locked, and their `quoted_hours` / `quote_value` are never overwritten with null or 0 (the existing preservation rules).
  - Tasks with time entries are never deleted. Projects are never deleted when `avoidDeletion` is true.
  - A full sync (`syncAllBoards = true`) still refreshes tasks on locked projects.
- There is no test suite in this repo (see CLAUDE.md). Verification for each task is `npx tsc --noEmit` passing, `npx eslint lib/monday/api.ts` clean, and a focused self-review against the invariants above. The final manual check (Quick Sync in the running app) is done by the coordinator/user after Task 4.
- UK English in comments. Commit messages are one imperative sentence ending in a full stop.
- Do not run `npm run dev` or trigger a sync against the database from a subagent.

**User decisions (already made):**
- Implement all four improvements (skip locked, hoist lookups, upserts, batch Monday subitem fetch) in `lib/monday/api.ts` only. Concurrency across projects is out of scope.
- Work is delegated to Sonnet subagents; the coordinating session reviews each task.

---

## Background (for the implementer)

`syncMondayData` (`lib/monday/api.ts:1037`) does:

1. `getMondayProjects(...)` fetches active-board items (one request, paginated) and completed-board items by ID in batches of 100. This part is already efficient.
2. Archive/delete pass over projects no longer in Monday (skipped when `avoidDeletion` is true).
3. A `for` loop over every project (`lib/monday/api.ts:1170-1495`). Per project, sequentially:
   - `monday_projects` select by `monday_item_id`
   - `monday_column_mappings` select for `quote_value`
   - `monday_projects` update or insert
   - `monday_projects` select again to get `id, status`
   - `getMondayTasks(...)`: `monday_column_mappings` select, then one Monday GraphQL request for that item's subitems
   - `monday_tasks` select existing tasks for the project
   - per task: `monday_tasks` select, then update or insert
   - `monday_projects` update `quoted_hours`
   - per orphaned task: `time_entries` select, then `monday_tasks` delete

Both `monday_projects.monday_item_id` and `monday_tasks.monday_item_id` are `unique not null` (`supabase/migrations/001_initial_schema.sql:21,35`), so `upsert(..., { onConflict: 'monday_item_id' })` is safe.

`getMondayTasks` has no callers outside `lib/monday/api.ts`, so it may be reshaped freely.

`findMappingColumnId(mappings, columnType, boardId)` in `lib/monday/mapping-resolver.ts` resolves board-specific first, then global (`board_id null`), then first match.

---

### Task 1: Skip subitem sync for already-locked projects

**Goal:** Projects that are already `locked` in the database and remain locked this run get their project row updated but do not fetch or write tasks, unless `syncAllBoards` is true.

**Files:**
- Modify: `lib/monday/api.ts:1370-1495` (the `if (projectRecord) { ... }` block inside the project loop)

**Acceptance Criteria:**
- [ ] When `existing?.status === 'locked'`, `finalStatus === 'locked'` and `syncAllBoards === false`, the loop does not call `getMondayTasks` and does not touch `monday_tasks` or `quoted_hours` for that project.
- [ ] When `syncAllBoards === true`, locked projects are processed exactly as before.
- [ ] Newly locked projects (existing status not `locked`, `finalStatus === 'locked'`) still sync tasks this run so their hours are captured once.
- [ ] `npx tsc --noEmit` passes and `npx eslint lib/monday/api.ts` reports no errors.

**Verify:** `npx tsc --noEmit && npx eslint lib/monday/api.ts` → no output / exit 0

**Steps:**

- [ ] **Step 1: Add the skip condition**

Immediately after `const { data: projectRecord } = await supabase.from('monday_projects').select('id, status')...` and before `if (projectRecord) {`, add:

```ts
      // Locked (completed) projects rarely change. Skip the per-project subitem fetch and task
      // writes unless this is a full resync, or the project has only just become locked this run.
      const wasAlreadyLocked = existing?.status === 'locked'
      const skipTaskSync = wasAlreadyLocked && finalStatus === 'locked' && !syncAllBoards
```

Change the guard to:

```ts
      if (projectRecord && !skipTaskSync) {
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib/monday/api.ts`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add lib/monday/api.ts
git commit -m "Skip subitem sync for already-locked projects during quick sync."
```

---

### Task 2: Load all lookups once before the project loop

**Goal:** Remove the per-project `monday_projects` existence select, the per-project `quote_value` mapping select, the post-write `monday_projects` re-select, and the per-project mapping select inside `getMondayTasks`, by loading each once before the loop.

**Files:**
- Modify: `lib/monday/api.ts:1105-1112` (existing projects query), `lib/monday/api.ts:1165-1170` (forecast mappings query), `lib/monday/api.ts:1203-1265` (existing lookup and quote_value mapping), `lib/monday/api.ts:1360-1378` (write and re-select), `lib/monday/api.ts:815-870` (`getMondayTasks` mapping load)

**Acceptance Criteria:**
- [ ] Exactly one `monday_column_mappings` query runs in `syncMondayData` (selecting `monday_column_id, board_id, column_type`) and it is reused for status, likelihood, quote_value and, via a new parameter, by `getMondayTasks`.
- [ ] Exactly one `monday_projects` select runs before the loop, selecting `id, monday_item_id, status, monday_board_id, quoted_hours, quote_value, monday_status, likelihood, monday_data`; the loop reads `existing` from a `Map` keyed by `monday_item_id`.
- [ ] Exactly one `monday_tasks` select runs before the loop, selecting `id, monday_item_id, project_id, quoted_hours`, grouped into a `Map<projectId, rows[]>`; the loop reads `existingTasks` from it.
- [ ] After the project write, `projectRecord` comes from `.select('id, status').single()` chained on the update/insert, not from a separate select.
- [ ] `getMondayTasks` accepts an optional pre-loaded `mappings` argument and only queries `monday_column_mappings` when it is not supplied.
- [ ] Preservation logic (`preserveQuotedHours`, `finalQuoteValue` fallbacks, `finalStatus` transitions) is unchanged in behaviour.
- [ ] `npx tsc --noEmit` passes and `npx eslint lib/monday/api.ts` reports no errors.

**Verify:** `npx tsc --noEmit && npx eslint lib/monday/api.ts` → exit 0

**Steps:**

- [ ] **Step 1: Widen the existing-projects query and build a map**

Replace the query at `lib/monday/api.ts:1105-1112`:

```ts
    // Get all existing projects from Supabase (one query; reused by the archive pass and the sync loop)
    type ExistingProjectRow = {
      id: string
      monday_item_id: string
      status: string
      monday_board_id: string | null
      quoted_hours: number | null
      quote_value: number | null
      monday_status: string | null
      likelihood: number | null
      monday_data: Record<string, any> | null
    }
    const { data: existingProjects } = await supabase
      .from('monday_projects')
      .select('id, monday_item_id, status, monday_board_id, quoted_hours, quote_value, monday_status, likelihood, monday_data')
    const existingByItemId = new Map<string, ExistingProjectRow>(
      ((existingProjects || []) as ExistingProjectRow[]).map((p) => [p.monday_item_id, p])
    )
```

The archive pass below it keeps iterating `existingProjects` unchanged.

- [ ] **Step 2: Load all column mappings and all existing tasks once**

Replace the `forecastMappings` query at `lib/monday/api.ts:1165-1170` with:

```ts
    // All column mappings, loaded once. Used for status, likelihood, quote_value and subitem columns.
    const { data: allColumnMappings } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, board_id, column_type')
    const columnMappings: ColumnMappingRow[] = (allColumnMappings || []) as ColumnMappingRow[]

    // All existing tasks, loaded once and grouped by project.
    type ExistingTaskRow = { id: string; monday_item_id: string; project_id: string; quoted_hours: number | null }
    const { data: allExistingTasks } = await supabase
      .from('monday_tasks')
      .select('id, monday_item_id, project_id, quoted_hours')
    const existingTasksByProjectId = new Map<string, ExistingTaskRow[]>()
    for (const row of (allExistingTasks || []) as ExistingTaskRow[]) {
      const list = existingTasksByProjectId.get(row.project_id)
      if (list) list.push(row)
      else existingTasksByProjectId.set(row.project_id, [row])
    }
```

Import the type at the top of the file:

```ts
import { findMappingColumnId, type ColumnMappingRow } from '@/lib/monday/mapping-resolver'
```

Replace every later use of `forecastMappings` with `columnMappings` (the two `findMappingColumnId(forecastMappings, ...)` calls for status and likelihood).

- [ ] **Step 3: Replace the per-project existence select**

Replace the block at `lib/monday/api.ts:1203-1208` (`const { data: existing } = await supabase.from('monday_projects').select(...).eq(...).single()`) with:

```ts
      const existing = existingByItemId.get(project.id) ?? null
```

- [ ] **Step 4: Replace the per-project quote_value mapping select**

Replace the block at `lib/monday/api.ts:1255-1264` (the `quoteValueMapping` query and `quoteValueColumnId` line) with:

```ts
      const quoteValueColumnId = findMappingColumnId(columnMappings, 'quote_value', project.board_id)
```

- [ ] **Step 5: Chain the select on the write and drop the re-select**

Replace `lib/monday/api.ts:1360-1378` (update/insert branches plus the `projectRecord` select) with:

```ts
      let projectRecord: { id: string; status: string } | null = null
      if (existing) {
        const { data } = await supabase
          .from('monday_projects')
          .update(projectData)
          .eq('monday_item_id', project.id)
          .select('id, status')
          .single()
        projectRecord = data
      } else {
        const { data } = await supabase
          .from('monday_projects')
          .insert(projectData)
          .select('id, status')
          .single()
        projectRecord = data
      }
```

(Task 3 collapses this into a single upsert; keep the two branches for now so this task stays reviewable on its own.)

- [ ] **Step 6: Pass pre-loaded mappings into `getMondayTasks`**

Change the signature at `lib/monday/api.ts:815-822` to:

```ts
export async function getMondayTasks(
  accessToken: string,
  projectId: string,
  boardId?: string,
  boardName?: string,
  /** Service-role client for sync (bypasses RLS); defaults to user-scoped client */
  dbClient?: SupabaseClient,
  /** Pre-loaded column mappings; when supplied, no database query is made */
  preloadedMappings?: ColumnMappingRow[]
): Promise<MondayTask[]> {
  let allMappings: ColumnMappingRow[]
  if (preloadedMappings) {
    allMappings = preloadedMappings.filter((m) => m.column_type === 'quoted_hours' || m.column_type === 'timeline')
  } else {
    const supabase = dbClient ?? (await createClient())
    const { data } = await supabase
      .from('monday_column_mappings')
      .select('monday_column_id, column_type, board_id')
      .in('column_type', ['quoted_hours', 'timeline'])
    allMappings = (data || []) as ColumnMappingRow[]
  }
```

Then remove the old `const supabase = ...` and `const { data: allMappings } = ...` lines that followed. The rest of the function already treats `allMappings` as possibly-empty; change any `allMappings || []` to `allMappings`.

Update the call in the loop to:

```ts
        const mondayTasks = await getMondayTasks(
          accessToken,
          project.id,
          project.board_id,
          project.board_name,
          admin,
          columnMappings
        )
```

- [ ] **Step 7: Read existing tasks from the map**

Replace the `existingTasks` query (`const { data: existingTasks } = await supabase.from('monday_tasks').select('id, monday_item_id, quoted_hours').eq('project_id', projectRecord.id)`) with:

```ts
        const existingTasks = existingTasksByProjectId.get(projectRecord.id) ?? []
```

Adjust the two later uses: `existingTasks?.find(...)` becomes `existingTasks.find(...)`, and `if (existingTasks) { for (const dbTask of existingTasks) ...` drops the `if`.

- [ ] **Step 8: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib/monday/api.ts`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add lib/monday/api.ts
git commit -m "Load Monday sync lookups once instead of per project."
```

---

### Task 3: Upsert projects and tasks, set-based orphan cleanup

**Goal:** Replace select-then-insert/update pairs with single `upsert` calls and replace the per-orphan select/delete with one query and one delete.

**Files:**
- Modify: `lib/monday/api.ts` project write (the two-branch block from Task 2 Step 5), the per-task loop, and the orphan cleanup block

**Acceptance Criteria:**
- [ ] Project write is a single `upsert(projectData, { onConflict: 'monday_item_id' }).select('id, status').single()`.
- [ ] Tasks for a project are written with one `upsert(taskRows, { onConflict: 'monday_item_id' })` call (skipped when `taskRows` is empty). No per-task select.
- [ ] Orphan cleanup: at most one `time_entries` select (`.select('task_id').in('task_id', orphanIds)`) and at most one `monday_tasks.delete().in('id', deletableIds)` per project. Tasks with time entries are kept.
- [ ] `totalTaskQuotedHours` and the `shouldUpdateQuotedHours` logic are unchanged.
- [ ] `npx tsc --noEmit` passes and `npx eslint lib/monday/api.ts` reports no errors.

**Verify:** `npx tsc --noEmit && npx eslint lib/monday/api.ts` → exit 0

**Steps:**

- [ ] **Step 1: Upsert the project row**

Replace the two-branch write from Task 2 with:

```ts
      const { data: projectRecord } = await supabase
        .from('monday_projects')
        .upsert(projectData, { onConflict: 'monday_item_id' })
        .select('id, status')
        .single()
```

- [ ] **Step 2: Build task rows and upsert once**

Replace the `for (const task of mondayTasks) { ... }` loop (which computes `finalTaskQuotedHours`, builds `taskData`, then selects and updates/inserts) with:

```ts
        const nowIso = new Date().toISOString()
        const taskRows = mondayTasks.map((task) => {
          // For locked projects, preserve existing quoted_hours if Monday doesn't provide it
          const existingTask = existingTasks.find((t) => t.monday_item_id === task.id)
          const preserveTaskQuotedHours = isProjectLocked && existingTask && (!task.quoted_hours || task.quoted_hours === 0)
          const finalTaskQuotedHours = preserveTaskQuotedHours
            ? (existingTask.quoted_hours || task.quoted_hours || null)
            : (task.quoted_hours || null)

          if (finalTaskQuotedHours) {
            totalTaskQuotedHours += finalTaskQuotedHours
          }

          return {
            monday_item_id: task.id,
            project_id: projectRecord.id,
            name: task.name,
            is_subtask: true,
            parent_task_id: null,
            assigned_user_ids: task.assigned_user_ids || null,
            quoted_hours: finalTaskQuotedHours,
            timeline_start: task.timeline_start || null,
            timeline_end: task.timeline_end || null,
            monday_data: task.column_values,
            updated_at: nowIso,
          }
        })

        if (taskRows.length > 0) {
          await supabase
            .from('monday_tasks')
            .upsert(taskRows, { onConflict: 'monday_item_id' })
        }
```

`let totalTaskQuotedHours = 0` must be declared before this block (it already is).

- [ ] **Step 3: Set-based orphan cleanup**

Replace the orphan cleanup block (`const syncedMondayTaskIds = ...` through the end of its `for` loop) with:

```ts
        // Clean up orphaned tasks (in DB but no longer in Monday), keeping any that have time entries.
        const syncedMondayTaskIds = new Set(mondayTasks.map((t) => t.id))
        const orphanTaskIds = existingTasks
          .filter((t) => !syncedMondayTaskIds.has(t.monday_item_id))
          .map((t) => t.id)

        if (orphanTaskIds.length > 0) {
          const { data: referenced } = await supabase
            .from('time_entries')
            .select('task_id')
            .in('task_id', orphanTaskIds)
          const referencedIds = new Set((referenced || []).map((r: { task_id: string }) => r.task_id))
          const deletableIds = orphanTaskIds.filter((id) => !referencedIds.has(id))
          if (deletableIds.length > 0) {
            await supabase.from('monday_tasks').delete().in('id', deletableIds)
          }
        }
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib/monday/api.ts`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/monday/api.ts
git commit -m "Upsert Monday projects and tasks in bulk during sync."
```

---

### Task 4: Fetch subitems for 25 projects per Monday request

**Goal:** Replace the one-Monday-request-per-project subitem fetch with a batched fetch, processing the project list in chunks of 25 so progress reporting keeps working.

**Files:**
- Modify: `lib/monday/api.ts:815-1020` (`getMondayTasks` becomes `getMondayTasksForItems`), and the project loop in `syncMondayData`

**Acceptance Criteria:**
- [ ] A new function `getMondayTasksForItems(accessToken, items: Array<{ id: string; board_id: string; board_name?: string }>, mappings: ColumnMappingRow[]): Promise<Map<string, MondayTask[]>>` issues one Monday request per 25 items using `items(ids: $itemIds) { id board { id } subitems { ... } }` and returns tasks keyed by parent item id. Items with no subitems map to `[]`.
- [ ] Subitem parsing (quoted_hours, timeline, people, `column_values`) is identical to the current `getMondayTasks` body. Extract it into a pure helper `parseSubitemsForItem(item, boardId, boardName, mappings): MondayTask[]` shared by the batch function.
- [ ] `getMondayTasks` (single-item) is removed. Confirm no callers remain with `grep -rn "getMondayTasks" app lib`.
- [ ] `syncMondayData` processes `mondayProjects` in chunks of 25: for each chunk it computes which projects need tasks (not `skipTaskSync`), calls `getMondayTasksForItems` once for those, then runs the existing per-project DB work reading tasks from the returned map. Progress events keep the same shape and `projectIndex` still counts 1..totalProjects.
- [ ] `skipTaskSync` from Task 1 is computed before the batch fetch (it depends only on `existing`, `finalStatus` and `syncAllBoards`, all known before any write).
- [ ] `npx tsc --noEmit` passes and `npx eslint lib/monday/api.ts` reports no errors.

**Verify:** `npx tsc --noEmit && npx eslint lib/monday/api.ts && ! grep -rn "getMondayTasks(" app lib` → exit 0

**Steps:**

- [ ] **Step 1: Extract the subitem parser**

Above the current `getMondayTasks`, add a type for the raw item and the parser. Move the body of the existing `for (const item of data.items || [])` loop into it verbatim, adjusting variable names:

```ts
type MondaySubitemsItem = {
  id: string
  name: string
  board: { id: string }
  subitems: Array<{
    id: string
    name: string
    column_values: Array<{ id: string; text?: string; value?: string; type: string }>
  }>
}

/** Resolve quoted_hours and timeline column IDs for a board, with Flexi inheritance and global fallback. */
function resolveSubitemColumnIds(
  mappings: ColumnMappingRow[],
  boardId: string | undefined,
  boardName: string | undefined
): { quotedHoursColumnId?: string; timelineColumnId?: string } {
  const relevant = mappings.filter((m) => m.column_type === 'quoted_hours' || m.column_type === 'timeline')
  let quotedHoursColumnId: string | undefined
  let timelineColumnId: string | undefined

  if (boardId) {
    const boardMappings = relevant.filter((m) => m.board_id === boardId)
    quotedHoursColumnId = boardMappings.find((m) => m.column_type === 'quoted_hours')?.monday_column_id
    timelineColumnId = boardMappings.find((m) => m.column_type === 'timeline')?.monday_column_id
  }

  if ((!quotedHoursColumnId || !timelineColumnId) && boardName?.toLowerCase().includes('flexi')) {
    for (const mapping of relevant) {
      if (mapping.board_id && mapping.board_id !== boardId) {
        if (!quotedHoursColumnId && mapping.column_type === 'quoted_hours') quotedHoursColumnId = mapping.monday_column_id
        if (!timelineColumnId && mapping.column_type === 'timeline') timelineColumnId = mapping.monday_column_id
        if (quotedHoursColumnId && timelineColumnId) break
      }
    }
  }

  if (!quotedHoursColumnId || !timelineColumnId) {
    const globalMappings = relevant.filter((m) => !m.board_id)
    if (!quotedHoursColumnId) quotedHoursColumnId = globalMappings.find((m) => m.column_type === 'quoted_hours')?.monday_column_id
    if (!timelineColumnId) timelineColumnId = globalMappings.find((m) => m.column_type === 'timeline')?.monday_column_id
  }

  return { quotedHoursColumnId, timelineColumnId }
}

/** Parse one Monday item's subitems into MondayTask rows. Pure; no I/O. */
function parseSubitemsForItem(
  item: MondaySubitemsItem,
  boardId: string | undefined,
  boardName: string | undefined,
  mappings: ColumnMappingRow[]
): MondayTask[] {
  const itemBoardId = item.board?.id || boardId
  const { quotedHoursColumnId, timelineColumnId } = resolveSubitemColumnIds(mappings, itemBoardId, boardName)
  const tasks: MondayTask[] = []

  for (const subitem of item.subitems || []) {
    // ... existing per-subitem body from getMondayTasks, unchanged, using
    //     quotedHoursColumnId / timelineColumnId and parent_item_id: item.id
  }

  return tasks
}
```

The per-subitem body is the existing code from `let quoted_hours: number | undefined` down to `tasks.push({...})`; copy it in unchanged, replacing `taskQuotedHoursColumnId` with `quotedHoursColumnId`, `taskTimelineColumnId` with `timelineColumnId`, and `parent_item_id: projectId` with `parent_item_id: item.id`.

- [ ] **Step 2: Add the batched fetch and remove `getMondayTasks`**

```ts
const SUBITEM_FETCH_BATCH_SIZE = 25

/**
 * Fetch subitems for many parent items in batches. Returns tasks keyed by parent item id;
 * every requested id is present in the map (empty array when the item has no subitems).
 */
export async function getMondayTasksForItems(
  accessToken: string,
  items: Array<{ id: string; board_id: string; board_name?: string }>,
  mappings: ColumnMappingRow[]
): Promise<Map<string, MondayTask[]>> {
  const result = new Map<string, MondayTask[]>()
  if (items.length === 0) return result
  for (const it of items) result.set(it.id, [])
  const byId = new Map(items.map((it) => [it.id, it]))

  const query = `
    query($itemIds: [ID!]) {
      items(ids: $itemIds) {
        id
        name
        board { id }
        subitems {
          id
          name
          column_values { id text value type }
        }
      }
    }
  `

  for (let i = 0; i < items.length; i += SUBITEM_FETCH_BATCH_SIZE) {
    const batch = items.slice(i, i + SUBITEM_FETCH_BATCH_SIZE)
    const data = await mondayRequest<{ items: MondaySubitemsItem[] }>(accessToken, query, {
      itemIds: batch.map((b) => b.id),
    })
    for (const item of data.items || []) {
      const requested = byId.get(item.id)
      result.set(item.id, parseSubitemsForItem(item, requested?.board_id, requested?.board_name, mappings))
    }
  }

  return result
}
```

Delete the old `getMondayTasks` function entirely.

- [ ] **Step 3: Chunk the sync loop**

Restructure the loop in `syncMondayData`. The per-project body is split into two phases: a pure "decide" phase (status, preservation, `projectData`, `skipTaskSync`) and a "write" phase. Replace `for (let i = 0; i < mondayProjects.length; i++) { const project = mondayProjects[i]; ... }` with:

```ts
    for (let chunkStart = 0; chunkStart < mondayProjects.length; chunkStart += SUBITEM_FETCH_BATCH_SIZE) {
      const chunk = mondayProjects.slice(chunkStart, chunkStart + SUBITEM_FETCH_BATCH_SIZE)

      // Phase 1: decide what to write for each project in the chunk (no I/O).
      const prepared = chunk.map((project, offset) => {
        const i = chunkStart + offset
        // ... existing code from `const isActive = ...` through building `projectData`,
        //     plus `const existing = existingByItemId.get(project.id) ?? null` at the top.
        const wasAlreadyLocked = existing?.status === 'locked'
        const skipTaskSync = wasAlreadyLocked && finalStatus === 'locked' && !syncAllBoards
        return { i, project, existing, projectData, skipTaskSync }
      })

      // Phase 2: one Monday request (per 25) for the subitems we actually need.
      const tasksByItemId = await getMondayTasksForItems(
        accessToken,
        prepared
          .filter((p) => !p.skipTaskSync)
          .map((p) => ({ id: p.project.id, board_id: p.project.board_id, board_name: p.project.board_name })),
        columnMappings
      )

      // Phase 3: write each project and its tasks.
      for (const { i, project, existing, projectData, skipTaskSync } of prepared) {
        const progress = 0.1 + 0.85 * (i / Math.max(1, totalProjects))
        report({
          phase: 'syncing',
          message: `Syncing ${project.name}`,
          projectIndex: i + 1,
          totalProjects,
          projectName: project.name,
          progress,
        })

        const { data: projectRecord } = await supabase
          .from('monday_projects')
          .upsert(projectData, { onConflict: 'monday_item_id' })
          .select('id, status')
          .single()

        if (!projectRecord || skipTaskSync) continue

        const isProjectLocked = projectRecord.status === 'locked'
        const mondayTasks = tasksByItemId.get(project.id) ?? []
        const existingTasks = existingTasksByProjectId.get(projectRecord.id) ?? []
        // ... existing task upsert, quoted_hours update and orphan cleanup from Task 3, unchanged.
      }
    }
```

Note: `progress` and the `report(...)` call move from the top of the old loop body into Phase 3 so the modal still advances per project. `extractQuoteValue` (a closure defined inside the loop today) should be hoisted above the loop; it does not depend on per-project state.

- [ ] **Step 4: Type-check, lint, confirm no stale callers**

Run: `npx tsc --noEmit && npx eslint lib/monday/api.ts && ! grep -rn "getMondayTasks(" app lib`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/monday/api.ts
git commit -m "Batch Monday subitem fetches during sync."
```

---

## After all tasks: manual verification (coordinator/user)

1. Note counts: `select count(*) from monday_projects; select count(*) from monday_tasks;`
2. `npm run build` passes.
3. In the running app, Time Tracking → Quick Sync. Expect completion in well under a minute, a `Synced N projects` toast where N matches the previous behaviour, and unchanged row counts (within any real Monday changes).
4. Spot-check one locked project: `quoted_hours` and `quote_value` unchanged.
5. Settings → Sync all boards still completes.

## Notes

- `app/api/sync/monday/route.ts` has no `maxDuration` export. After this plan the sync should sit well inside Vercel's default limit; if it still gets cut off, that is the next lever, not more work here.
- Concurrency across projects was deliberately left out. Revisit only if the chunked version is still slow.
