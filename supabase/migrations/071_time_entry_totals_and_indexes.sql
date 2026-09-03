-- Time tracking performance: aggregate logged hours in Postgres, and add the composite
-- indexes the timesheet queries actually want.

-- Logged-hours totals for a set of projects, rolled up per project and per task.
--
-- Rows with a null task_id are the project total; rows with both are the task total.
-- SECURITY INVOKER so the caller's RLS still applies, matching the previous behaviour of
-- selecting the rows and summing them in the application.
create or replace function public.time_entry_totals(p_project_ids uuid[])
returns table (
  project_id uuid,
  task_id uuid,
  total_hours numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    te.project_id,
    te.task_id,
    sum(te.hours)::numeric as total_hours
  from public.time_entries te
  where te.project_id = any(p_project_ids)
  group by grouping sets ((te.project_id), (te.project_id, te.task_id))
$$;

grant execute on function public.time_entry_totals(uuid[]) to authenticated;

-- getTimeEntries filters on user_id plus a date range; the existing single-column indexes
-- on user_id and date can't serve that as one lookup.
create index if not exists idx_time_entries_user_date
  on public.time_entries (user_id, date);

-- time_entry_totals groups by project_id and task_id after filtering on project_id.
create index if not exists idx_time_entries_project_task
  on public.time_entries (project_id, task_id);

-- The timesheet only ever wants subtasks for a set of projects.
create index if not exists idx_monday_tasks_project_subtask
  on public.monday_tasks (project_id, is_subtask);

-- Active projects filtered by board.
create index if not exists idx_monday_projects_status_board
  on public.monday_projects (status, monday_board_id);
