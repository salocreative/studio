-- Add due_date column to monday_projects for active projects
alter table public.monday_projects
  add column if not exists due_date date;

-- Add index for faster sorting and filtering by due date
create index if not exists idx_monday_projects_due_date 
  on public.monday_projects(due_date desc nulls last);

-- Update column_type check constraint to include new date column types
alter table public.monday_column_mappings
drop constraint if exists monday_column_mappings_column_type_check;

-- Add new column types: 'due_date' for active projects and 'completed_date' for completed projects
alter table public.monday_column_mappings
add constraint monday_column_mappings_column_type_check
check (column_type in ('client', 'time', 'quoted_hours', 'timeline', 'quote_value', 'due_date', 'completed_date'));

-- Add comments to explain the new column types
comment on constraint monday_column_mappings_column_type_check on public.monday_column_mappings is 
  'due_date: Column to store project due date for active projects (parent column).
   completed_date: Column to store project completion date for completed projects (parent column).';

