-- Create table to store customer relationship scores
create table public.customer_relationship_scores (
  id uuid default uuid_generate_v4() primary key,
  client_name text unique not null,
  relationship_score integer not null check (relationship_score >= 0 and relationship_score <= 10),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Add index for faster lookups
create index idx_customer_relationship_scores_client_name on public.customer_relationship_scores(client_name);

-- RLS Policy - only admins can manage relationship scores
alter table public.customer_relationship_scores enable row level security;

create policy "Admins can manage customer relationship scores"
  on public.customer_relationship_scores for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- Allow all authenticated users to read relationship scores
create policy "Authenticated users can read customer relationship scores"
  on public.customer_relationship_scores for select
  using (auth.role() = 'authenticated');

-- Add trigger to update updated_at
create trigger update_customer_relationship_scores_updated_at 
  before update on public.customer_relationship_scores
  for each row execute function update_updated_at_column();

-- Create table to store lifetime value brackets configuration
create table public.lifetime_value_brackets (
  id uuid default uuid_generate_v4() primary key,
  bracket_name text unique not null check (bracket_name in ('low', 'medium', 'high')),
  min_value numeric(10, 2) not null,
  max_value numeric(10, 2), -- NULL means unlimited for 'high' bracket
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Insert default brackets
insert into public.lifetime_value_brackets (bracket_name, min_value, max_value)
values 
  ('low', 1.00, 4999.99),
  ('medium', 5000.00, 9999.99),
  ('high', 10000.00, null)
on conflict (bracket_name) do nothing;

-- Add index for faster lookups
create index idx_lifetime_value_brackets_bracket_name on public.lifetime_value_brackets(bracket_name);

-- RLS Policy - only admins can manage brackets
alter table public.lifetime_value_brackets enable row level security;

create policy "Admins can manage lifetime value brackets"
  on public.lifetime_value_brackets for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- Allow all authenticated users to read brackets
create policy "Authenticated users can read lifetime value brackets"
  on public.lifetime_value_brackets for select
  using (auth.role() = 'authenticated');

-- Add trigger to update updated_at
create trigger update_lifetime_value_brackets_updated_at 
  before update on public.lifetime_value_brackets
  for each row execute function update_updated_at_column();

