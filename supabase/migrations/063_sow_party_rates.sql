-- Per-agency and per-client day rates for SoW quoted rate auto-fill

create table if not exists public.sow_party_rates (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  party_type text not null check (party_type in ('agency', 'client')),
  day_rate_gbp numeric(10, 2) not null check (day_rate_gbp > 0),
  currency text not null default 'GBP' check (currency in ('GBP', 'USD')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (party_type, name)
);

create index if not exists idx_sow_party_rates_party_type
  on public.sow_party_rates(party_type);

comment on table public.sow_party_rates is
  'Optional day rates for agencies or end clients; used to auto-fill SoW quoted day rate overrides.';
comment on column public.sow_party_rates.day_rate_gbp is
  'Quoted day rate in GBP (studio pricing is always GBP-first).';
comment on column public.sow_party_rates.currency is
  'Default share-view currency when this party is selected on a SoW.';

alter table public.sow_party_rates enable row level security;

drop policy if exists "Admins can manage sow party rates" on public.sow_party_rates;
drop policy if exists "Team can read sow party rates" on public.sow_party_rates;

create policy "Admins can manage sow party rates"
  on public.sow_party_rates for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role = 'admin'
        and deleted_at is null
    )
  );

create policy "Team can read sow party rates"
  on public.sow_party_rates for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

drop trigger if exists update_sow_party_rates_updated_at on public.sow_party_rates;

create trigger update_sow_party_rates_updated_at
  before update on public.sow_party_rates
  for each row execute function update_updated_at_column();
