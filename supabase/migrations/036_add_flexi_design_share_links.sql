-- Create table to store public share links for Flexi-Design clients
create table if not exists public.flexi_design_share_links (
  id uuid default uuid_generate_v4() primary key,
  flexi_design_client_id uuid references public.flexi_design_clients(id) on delete cascade not null,
  share_token text not null unique, -- Unique token for the public URL
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  expires_at timestamptz, -- Optional expiry date
  is_active boolean not null default true
);

-- Indexes for performance
create index if not exists idx_flexi_design_share_links_token on public.flexi_design_share_links(share_token);
create index if not exists idx_flexi_design_share_links_client_id on public.flexi_design_share_links(flexi_design_client_id);
create index if not exists idx_flexi_design_share_links_active on public.flexi_design_share_links(is_active, expires_at) where is_active = true;

-- RLS Policies
alter table public.flexi_design_share_links enable row level security;

-- Admins can manage share links
create policy "Admins can manage flexi design share links"
  on public.flexi_design_share_links for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- Allow all authenticated users to read share links (for listing)
create policy "Authenticated users can read flexi design share links"
  on public.flexi_design_share_links for select
  using (auth.role() = 'authenticated');
