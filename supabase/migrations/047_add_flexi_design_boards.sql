-- Canonical Flexi-Design Monday board IDs for Main vs Flexi filtering (time tracking, reports).
-- When this table has at least one row, Studio uses it instead of inferring boards via Monday API names.

create table public.flexi_design_boards (
  id uuid default uuid_generate_v4() primary key,
  monday_board_id text unique not null,
  board_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_flexi_design_boards_monday_board_id on public.flexi_design_boards(monday_board_id);

alter table public.flexi_design_boards enable row level security;

create policy "Authenticated users can read flexi design boards"
  on public.flexi_design_boards for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage flexi design boards"
  on public.flexi_design_boards for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

create trigger update_flexi_design_boards_updated_at
  before update on public.flexi_design_boards
  for each row execute function update_updated_at_column();
