-- Add agency column to monday_projects table
-- This stores the agency name for projects (parent column from Monday.com)
alter table public.monday_projects
  add column if not exists agency text;

-- Add index for faster filtering by agency
create index if not exists idx_monday_projects_agency 
  on public.monday_projects(agency);

-- Update column_type check constraint to include 'agency'
alter table public.monday_column_mappings
drop constraint if exists monday_column_mappings_column_type_check;

-- Add 'agency' as a valid column type (parent column, like 'client')
alter table public.monday_column_mappings
add constraint monday_column_mappings_column_type_check
check (column_type in ('client', 'time', 'quoted_hours', 'timeline', 'quote_value', 'due_date', 'completed_date', 'status', 'agency'));

-- Add comment to explain the agency column type
comment on constraint monday_column_mappings_column_type_check on public.monday_column_mappings is 
  'agency: Parent column to store agency name (for projects worked on behalf of an agency).';

