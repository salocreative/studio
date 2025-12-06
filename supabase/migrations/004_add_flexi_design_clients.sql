-- Create table to track Flexi-Design client credits
create table public.flexi_design_clients (
  id uuid default uuid_generate_v4() primary key,
  client_name text unique not null,
  remaining_hours numeric(10, 2) default 0 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Add index for faster lookups
create index idx_flexi_design_clients_client_name on public.flexi_design_clients(client_name);

-- RLS Policy - only admins can manage Flexi-Design clients
alter table public.flexi_design_clients enable row level security;

create policy "Admins can manage Flexi-Design clients"
  on public.flexi_design_clients for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow all authenticated users to read Flexi-Design clients
create policy "Authenticated users can read Flexi-Design clients"
  on public.flexi_design_clients for select
  using (auth.role() = 'authenticated');

-- Add trigger to update updated_at
create trigger update_flexi_design_clients_updated_at 
  before update on public.flexi_design_clients
  for each row execute function update_updated_at_column();

