-- Create retainers feature tables
-- This allows tracking retainer clients and sharing their project data with public links

-- Table to store which clients are retainers
create table if not exists public.retainer_clients (
  id uuid default uuid_generate_v4() primary key,
  client_name text not null unique,
  display_order integer not null default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Table to store public share links for retainer clients
create table if not exists public.retainer_share_links (
  id uuid default uuid_generate_v4() primary key,
  retainer_client_id uuid references public.retainer_clients(id) on delete cascade not null,
  share_token text not null unique, -- Unique token for the public URL
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  expires_at timestamptz, -- Optional expiry date
  is_active boolean not null default true
);

-- Indexes for performance
create index if not exists idx_retainer_clients_display_order on public.retainer_clients(display_order);
create index if not exists idx_retainer_clients_client_name on public.retainer_clients(client_name);
create index if not exists idx_retainer_share_links_token on public.retainer_share_links(share_token);
create index if not exists idx_retainer_share_links_retainer_client_id on public.retainer_share_links(retainer_client_id);
create index if not exists idx_retainer_share_links_active on public.retainer_share_links(is_active, expires_at) where is_active = true;

-- RLS Policies
alter table public.retainer_clients enable row level security;
alter table public.retainer_share_links enable row level security;

-- Retainer clients: All authenticated users can read, only admins can manage
create policy "Authenticated users can read retainer clients"
  on public.retainer_clients for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage retainer clients"
  on public.retainer_clients for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- Share links: Admins can manage, public can read active non-expired links
create policy "Admins can manage retainer share links"
  on public.retainer_share_links for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- Public access to active, non-expired share links (no auth required)
create policy "Public can read active retainer share links"
  on public.retainer_share_links for select
  using (
    is_active = true 
    AND (expires_at IS NULL OR expires_at > now())
  );

-- Triggers
create trigger update_retainer_clients_updated_at 
  before update on public.retainer_clients
  for each row execute function update_updated_at_column();

