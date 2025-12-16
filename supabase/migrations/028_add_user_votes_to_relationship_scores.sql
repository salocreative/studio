-- Migrate customer_relationship_scores to support per-user voting
-- Drop the unique constraint on client_name and add user_id column

-- Create new table for user relationship votes
create table if not exists public.customer_relationship_votes (
  id uuid default uuid_generate_v4() primary key,
  client_name text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  relationship_score integer not null check (relationship_score >= 0 and relationship_score <= 10),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(client_name, user_id)
);

-- Add indexes for faster lookups
create index if not exists idx_customer_relationship_votes_client_name on public.customer_relationship_votes(client_name);
create index if not exists idx_customer_relationship_votes_user_id on public.customer_relationship_votes(user_id);

-- Migrate existing data from customer_relationship_scores to customer_relationship_votes
-- Create a system user vote for each existing score (if any admins exist, use the first one)
insert into public.customer_relationship_votes (client_name, user_id, relationship_score, created_at, updated_at)
select 
  crs.client_name,
  (select id from public.users where role = 'admin' and deleted_at is null limit 1),
  crs.relationship_score,
  crs.created_at,
  crs.updated_at
from public.customer_relationship_scores crs
where exists (select 1 from public.users where role = 'admin' and deleted_at is null)
on conflict (client_name, user_id) do nothing;

-- RLS Policy - all authenticated users can read votes
alter table public.customer_relationship_votes enable row level security;

create policy "All authenticated users can read relationship votes"
  on public.customer_relationship_votes for select
  using (auth.role() = 'authenticated');

-- All authenticated users can insert/update their own votes
create policy "Users can manage their own relationship votes"
  on public.customer_relationship_votes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Add trigger to update updated_at
create trigger update_customer_relationship_votes_updated_at 
  before update on public.customer_relationship_votes
  for each row execute function update_updated_at_column();

-- Keep the old table for backwards compatibility during migration, but deprecate it
-- Note: The old table can be dropped in a future migration after confirming the new system works

