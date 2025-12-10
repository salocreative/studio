-- Add table to store quote day rates for different customer types
-- This table should only ever have one row per customer type
create table public.quote_rates (
  id uuid default uuid_generate_v4() primary key,
  customer_type text unique not null check (customer_type in ('partner', 'client')),
  day_rate_gbp numeric(10, 2) not null check (day_rate_gbp > 0),
  hours_per_day numeric(4, 2) default 6.0 not null check (hours_per_day > 0),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Insert default rates
insert into public.quote_rates (customer_type, day_rate_gbp, hours_per_day)
values 
  ('partner', 670.00, 6.0),
  ('client', 720.00, 6.0)
on conflict (customer_type) do nothing;

-- Add index for faster lookups
create index idx_quote_rates_customer_type on public.quote_rates(customer_type);

-- RLS Policy - only admins can manage quote rates
alter table public.quote_rates enable row level security;

create policy "Admins can manage quote rates"
  on public.quote_rates for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow all authenticated users to read quote rates (for quoting tool)
create policy "Authenticated users can read quote rates"
  on public.quote_rates for select
  using (auth.role() = 'authenticated');

-- Add trigger to update updated_at
create trigger update_quote_rates_updated_at
  before update on public.quote_rates
  for each row execute function update_updated_at_column();

