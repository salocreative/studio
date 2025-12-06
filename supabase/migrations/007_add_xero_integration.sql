-- Add table to store Xero OAuth connection and tokens
create table public.xero_connection (
  id uuid default uuid_generate_v4() primary key,
  tenant_id text unique not null,
  tenant_name text not null,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  connected_by uuid references public.users(id) on delete cascade,
  connected_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Add index for faster lookups
create index idx_xero_connection_tenant_id on public.xero_connection(tenant_id);
create index idx_xero_connection_connected_by on public.xero_connection(connected_by);

-- RLS Policy - only admins can manage Xero connections
alter table public.xero_connection enable row level security;

create policy "Admins can manage Xero connections"
  on public.xero_connection for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow all authenticated users to read Xero connection status (for UI display)
create policy "Authenticated users can read Xero connection status"
  on public.xero_connection for select
  using (auth.role() = 'authenticated');

-- Add trigger to update updated_at
create trigger update_xero_connection_updated_at
  before update on public.xero_connection
  for each row execute function update_updated_at_column();

-- Add table to cache financial data from Xero for forecasting
create table public.xero_financial_cache (
  id uuid default uuid_generate_v4() primary key,
  tenant_id text not null,
  period_start date not null,
  period_end date not null,
  revenue numeric(18, 2) default 0,
  expenses numeric(18, 2) default 0,
  profit numeric(18, 2) default 0,
  data jsonb,
  cached_at timestamptz default now() not null,
  unique(tenant_id, period_start, period_end)
);

-- Add indexes for faster lookups
create index idx_xero_financial_cache_tenant_period on public.xero_financial_cache(tenant_id, period_start, period_end);
create index idx_xero_financial_cache_period on public.xero_financial_cache(period_start, period_end);

-- RLS Policy - all authenticated users can read cached financial data
alter table public.xero_financial_cache enable row level security;

create policy "Authenticated users can read financial cache"
  on public.xero_financial_cache for select
  using (auth.role() = 'authenticated');

-- Only admins can write/update cache
create policy "Admins can manage financial cache"
  on public.xero_financial_cache for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

