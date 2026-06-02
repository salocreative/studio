-- Forecast pipeline: materialise Monday status label and lead likelihood on projects

alter table public.monday_projects
  add column if not exists monday_status text,
  add column if not exists likelihood numeric(5, 2);

comment on column public.monday_projects.monday_status is
  'Monday workflow status label (e.g. Scoping, Ongoing). Distinct from lifecycle status column.';

comment on column public.monday_projects.likelihood is
  'Lead win likelihood percentage (0–100) from the mapped Monday column.';

create index if not exists idx_monday_projects_monday_status
  on public.monday_projects(monday_status);

create index if not exists idx_monday_projects_likelihood
  on public.monday_projects(likelihood desc nulls last);

alter table public.monday_column_mappings
  drop constraint if exists monday_column_mappings_column_type_check;

alter table public.monday_column_mappings
  add constraint monday_column_mappings_column_type_check
  check (column_type in (
    'client', 'time', 'quoted_hours', 'timeline', 'quote_value',
    'due_date', 'completed_date', 'status', 'agency', 'likelihood'
  ));

comment on constraint monday_column_mappings_column_type_check on public.monday_column_mappings is
  'likelihood: Lead win probability % column on the leads board.';
