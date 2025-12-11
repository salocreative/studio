-- Add 'status' column type to monday_column_mappings for Leads board
alter table public.monday_column_mappings
drop constraint if exists monday_column_mappings_column_type_check;

alter table public.monday_column_mappings
add constraint monday_column_mappings_column_type_check
check (column_type in ('client', 'time', 'quoted_hours', 'timeline', 'quote_value', 'due_date', 'completed_date', 'status'));

-- Create table to store which statuses should be included for leads in Monthly Summary
create table if not exists public.leads_status_config (
  id uuid default uuid_generate_v4() primary key,
  included_statuses text[] default array[]::text[],
  excluded_statuses text[] default array[]::text[],
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Only allow one config row
create unique index if not exists leads_status_config_single_row on public.leads_status_config ((1));

-- Enable RLS
alter table public.leads_status_config enable row level security;

-- Only admins can view and modify
create policy "Admins can view leads status config"
  on public.leads_status_config
  for select
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid()
      and users.role = 'admin'
    )
  );

create policy "Admins can update leads status config"
  on public.leads_status_config
  for update
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid()
      and users.role = 'admin'
    )
  );

create policy "Admins can insert leads status config"
  on public.leads_status_config
  for insert
  with check (
    exists (
      select 1 from public.users
      where users.id = auth.uid()
      and users.role = 'admin'
    )
  );

-- Add comment
comment on table public.leads_status_config is 'Configuration for which statuses to include/exclude when showing leads in Monthly Summary';

