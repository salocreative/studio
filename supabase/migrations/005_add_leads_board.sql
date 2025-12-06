-- Add table to track the leads board
-- Only one leads board can be configured at a time
create table public.monday_leads_board (
  id uuid default uuid_generate_v4() primary key,
  monday_board_id text unique,
  board_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Add index for faster lookups
create index idx_monday_leads_board_board_id on public.monday_leads_board(monday_board_id);

-- RLS Policy - only admins can manage leads board
alter table public.monday_leads_board enable row level security;

create policy "Admins can manage leads board"
  on public.monday_leads_board for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow all authenticated users to read leads board config
create policy "Authenticated users can read leads board"
  on public.monday_leads_board for select
  using (auth.role() = 'authenticated');

-- Add trigger to update updated_at
create trigger update_monday_leads_board_updated_at 
  before update on public.monday_leads_board
  for each row execute function update_updated_at_column();

