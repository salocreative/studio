-- Add table to track the completed Flexi-Design board
-- This board contains all completed Flexi-Design projects
create table public.flexi_design_completed_board (
  id uuid default uuid_generate_v4() primary key,
  monday_board_id text unique not null,
  board_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Add index for faster lookups
create index idx_flexi_design_completed_board_board_id on public.flexi_design_completed_board(monday_board_id);

-- RLS Policy - only admins can manage the completed board
alter table public.flexi_design_completed_board enable row level security;

create policy "Admins can manage flexi design completed board"
  on public.flexi_design_completed_board for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow all authenticated users to read the completed board
create policy "Authenticated users can read flexi design completed board"
  on public.flexi_design_completed_board for select
  using (auth.role() = 'authenticated');

-- Add trigger to update updated_at
create trigger update_flexi_design_completed_board_updated_at 
  before update on public.flexi_design_completed_board
  for each row execute function update_updated_at_column();

