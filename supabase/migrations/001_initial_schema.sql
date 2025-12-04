-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- Create enums
create type user_role as enum ('admin', 'designer', 'employee');
create type project_status as enum ('active', 'archived', 'locked');

-- Users table (extends Supabase auth.users)
create table public.users (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  role user_role default 'employee' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Monday Projects table
create table public.monday_projects (
  id uuid default uuid_generate_v4() primary key,
  monday_item_id text unique not null,
  monday_board_id text not null,
  name text not null,
  client_name text,
  status project_status default 'active' not null,
  quoted_hours numeric(10, 2),
  monday_data jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Monday Tasks table
create table public.monday_tasks (
  id uuid default uuid_generate_v4() primary key,
  monday_item_id text unique not null,
  project_id uuid references public.monday_projects(id) on delete cascade not null,
  name text not null,
  is_subtask boolean default false not null,
  parent_task_id uuid references public.monday_tasks(id) on delete set null,
  assigned_user_ids text[],
  quoted_hours numeric(10, 2),
  timeline_start timestamptz,
  timeline_end timestamptz,
  monday_data jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Time Entries table
create table public.time_entries (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  task_id uuid references public.monday_tasks(id) on delete restrict not null,
  project_id uuid references public.monday_projects(id) on delete restrict not null,
  date date not null,
  hours numeric(4, 2) not null check (hours > 0),
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(user_id, task_id, date)
);

-- Favorite Tasks table
create table public.favorite_tasks (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  task_id uuid references public.monday_tasks(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique(user_id, task_id)
);

-- Monday Column Mappings table (for admin settings)
create table public.monday_column_mappings (
  id uuid default uuid_generate_v4() primary key,
  monday_column_id text not null,
  column_type text not null check (column_type in ('client', 'time', 'quoted_hours', 'timeline')),
  board_id text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(column_type, board_id)
);

-- Indexes for performance
create index idx_monday_projects_board_id on public.monday_projects(monday_board_id);
create index idx_monday_projects_status on public.monday_projects(status);
create index idx_monday_tasks_project_id on public.monday_tasks(project_id);
create index idx_monday_tasks_assigned_users on public.monday_tasks using gin(assigned_user_ids);
create index idx_time_entries_user_id on public.time_entries(user_id);
create index idx_time_entries_date on public.time_entries(date);
create index idx_time_entries_project_id on public.time_entries(project_id);
create index idx_favorite_tasks_user_id on public.favorite_tasks(user_id);

-- RLS Policies
alter table public.users enable row level security;
alter table public.monday_projects enable row level security;
alter table public.monday_tasks enable row level security;
alter table public.time_entries enable row level security;
alter table public.favorite_tasks enable row level security;
alter table public.monday_column_mappings enable row level security;

-- Users can read their own data
create policy "Users can view own profile"
  on public.users for select
  using (auth.uid() = id);

-- Users can update their own data
create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id);

-- All authenticated users can view projects
create policy "Authenticated users can view projects"
  on public.monday_projects for select
  using (auth.role() = 'authenticated');

-- Only admins can insert/update/delete projects
create policy "Admins can manage projects"
  on public.monday_projects for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- All authenticated users can view tasks
create policy "Authenticated users can view tasks"
  on public.monday_tasks for select
  using (auth.role() = 'authenticated');

-- Only admins can insert/update/delete tasks
create policy "Admins can manage tasks"
  on public.monday_tasks for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Users can view all time entries (for reporting)
create policy "Authenticated users can view time entries"
  on public.time_entries for select
  using (auth.role() = 'authenticated');

-- Users can insert their own time entries (unless project is locked)
create policy "Users can create own time entries"
  on public.time_entries for insert
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.monday_projects
      where id = project_id and status = 'locked'
    )
  );

-- Users can update their own time entries
create policy "Users can update own time entries"
  on public.time_entries for update
  using (auth.uid() = user_id);

-- Users can delete their own time entries
create policy "Users can delete own time entries"
  on public.time_entries for delete
  using (auth.uid() = user_id);

-- Users can manage their own favorites
create policy "Users can manage own favorites"
  on public.favorite_tasks for all
  using (auth.uid() = user_id);

-- Only admins can view/manage column mappings
create policy "Admins can manage column mappings"
  on public.monday_column_mappings for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Function to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Triggers to automatically update updated_at
create trigger update_users_updated_at before update on public.users
  for each row execute function update_updated_at_column();

create trigger update_monday_projects_updated_at before update on public.monday_projects
  for each row execute function update_updated_at_column();

create trigger update_monday_tasks_updated_at before update on public.monday_tasks
  for each row execute function update_updated_at_column();

create trigger update_time_entries_updated_at before update on public.time_entries
  for each row execute function update_updated_at_column();

create trigger update_monday_column_mappings_updated_at before update on public.monday_column_mappings
  for each row execute function update_updated_at_column();

