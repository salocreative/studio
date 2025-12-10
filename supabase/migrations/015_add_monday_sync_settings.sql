-- Add table to store Monday.com automatic sync settings
-- This table should only ever have one row
create table public.monday_sync_settings (
  id uuid default '00000000-0000-0000-0000-000000000000'::uuid primary key,
  enabled boolean default false not null,
  interval_minutes integer default 60 not null check (interval_minutes > 0),
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Insert a single default record (enabled = false by default)
insert into public.monday_sync_settings (id, enabled, interval_minutes)
values ('00000000-0000-0000-0000-000000000000'::uuid, false, 60)
on conflict (id) do nothing;

-- Add index for faster lookups
create index idx_monday_sync_settings_enabled on public.monday_sync_settings(enabled);

-- RLS Policy - only admins can manage sync settings
alter table public.monday_sync_settings enable row level security;

create policy "Admins can manage sync settings"
  on public.monday_sync_settings for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow all authenticated users to read sync settings (for UI display)
create policy "Authenticated users can read sync settings"
  on public.monday_sync_settings for select
  using (auth.role() = 'authenticated');

-- Add trigger to update updated_at
create trigger update_monday_sync_settings_updated_at
  before update on public.monday_sync_settings
  for each row execute function update_updated_at_column();

