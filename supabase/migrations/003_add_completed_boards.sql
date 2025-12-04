-- Add table to track completed/archived boards
-- These are boards where completed projects are moved to
create table public.monday_completed_boards (
  id uuid default uuid_generate_v4() primary key,
  monday_board_id text unique not null,
  board_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Add index for faster lookups
create index idx_monday_completed_boards_board_id on public.monday_completed_boards(monday_board_id);

-- RLS Policy - only admins can manage completed boards
alter table public.monday_completed_boards enable row level security;

create policy "Admins can manage completed boards"
  on public.monday_completed_boards for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Add trigger to update updated_at
create trigger update_monday_completed_boards_updated_at 
  before update on public.monday_completed_boards
  for each row execute function update_updated_at_column();

