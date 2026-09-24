-- Hosted websites tracked under Retainers → Hosting.
-- Separate from retainer_clients, which stays the design-retainer agreement.

create table if not exists public.hosting_sites (
  id uuid default uuid_generate_v4() primary key,
  client_name text not null,
  site_name text not null,
  domain text,
  platform text,
  started_on date,
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly', 'quarterly', 'yearly')),
  amount numeric(12, 2) not null default 0
    check (amount >= 0),
  currency text not null default 'GBP',
  payment_method text not null default 'invoice'
    check (payment_method in ('invoice', 'stripe', 'other')),
  stripe_reference text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'ended')),
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_hosting_sites_client_name on public.hosting_sites (client_name);
create index if not exists idx_hosting_sites_platform on public.hosting_sites (platform);
create index if not exists idx_hosting_sites_status on public.hosting_sites (status);

alter table public.hosting_sites enable row level security;

drop policy if exists "Authenticated users can read hosting sites" on public.hosting_sites;
create policy "Authenticated users can read hosting sites"
  on public.hosting_sites for select
  using (auth.role() = 'authenticated');

drop policy if exists "Admins can manage hosting sites" on public.hosting_sites;
create policy "Admins can manage hosting sites"
  on public.hosting_sites for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

drop trigger if exists update_hosting_sites_updated_at on public.hosting_sites;
create trigger update_hosting_sites_updated_at
  before update on public.hosting_sites
  for each row execute function update_updated_at_column();

comment on table public.hosting_sites is
  'Websites Salo hosts. Amount is charged once per billing cycle. Stripe reference is a record of an existing scheme, not a live charge.';
