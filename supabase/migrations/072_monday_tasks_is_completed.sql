-- Persist task completion at sync time so the timesheet no longer has to read the raw
-- `monday_data` payload just to derive one boolean.
--
-- Selecting `monday_data` for every subtask was 680 KB on the wire per timesheet load
-- (136 KB without it) and 900+ JSON blobs parsed per request, all to compute `is_completed`.

-- Nullable on purpose: null means "this task has no status column", matching what
-- getTaskCompletionFromStatus() returns in that case, so callers can still fall back to
-- hours-based completion.
alter table public.monday_tasks
  add column if not exists is_completed boolean;

comment on column public.monday_tasks.is_completed is
  'Derived during sync from the subitem''s Monday status column(s). True if any status reads as done/complete/closed; false if a status column exists but does not; null if the task has no status column.';

-- Backfill from the payload already stored, so the timesheet is correct before the next sync
-- rather than after it. Mirrors lib/monday/task-completion.ts: a task counts as complete if
-- *any* of its status columns reads as done. From the next sync onward the value is written
-- by that TypeScript function, which is the canonical implementation.
with status_columns as (
  select
    t.id,
    c.value as column_payload
  from public.monday_tasks t
  cross join lateral jsonb_each(coalesce(t.monday_data, '{}'::jsonb)) as c(key, value)
  where jsonb_typeof(c.value) = 'object'
    and c.value ->> 'type' = 'status'
),
computed as (
  select
    id,
    bool_or(
      coalesce(column_payload ->> 'text', '') ~* '\y(done|complete|completed|closed)\y'
      or coalesce(column_payload -> 'value' ->> 'label', '') ~* '\y(done|complete|completed|closed)\y'
    ) as is_completed
  from status_columns
  group by id
)
update public.monday_tasks t
set is_completed = computed.is_completed
from computed
where t.id = computed.id
  and t.is_completed is distinct from computed.is_completed;
