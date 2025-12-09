-- Add completed_date column to monday_projects table
-- This stores the date when a project was completed from Monday.com's "Completed" date column
alter table public.monday_projects
  add column if not exists completed_date date;

-- Add index for faster sorting and filtering by completed date
create index if not exists idx_monday_projects_completed_date 
  on public.monday_projects(completed_date desc nulls last);

