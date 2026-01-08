-- Create scorecard system tables

-- Scorecard categories (Marketing, Sales, Operations, Finance)
create table if not exists public.scorecard_categories (
  id uuid default uuid_generate_v4() primary key,
  name text unique not null, -- 'Marketing', 'Sales', 'Operations', 'Finance'
  display_order integer not null,
  created_at timestamptz default now() not null
);

-- Insert default categories
insert into public.scorecard_categories (name, display_order)
values 
  ('Marketing', 1),
  ('Sales', 2),
  ('Operations', 3),
  ('Finance', 4)
on conflict (name) do nothing;

-- Scorecard metrics (definitions of what we track)
create table if not exists public.scorecard_metrics (
  id uuid default uuid_generate_v4() primary key,
  category_id uuid not null references public.scorecard_categories(id) on delete cascade,
  name text not null, -- e.g., 'LinkedIn Page Visitors', 'Billable Hours Completed'
  description text,
  unit text, -- e.g., 'visitors', 'hours', '£', '%'
  target_value numeric(12, 2), -- Default target for this metric
  is_automated boolean default false not null, -- Whether this metric is auto-calculated
  automation_source text, -- e.g., 'time_tracking', 'leads', 'xero', 'linkedin'
  automation_config jsonb, -- Configuration for automated metric collection
  display_order integer not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(category_id, name)
);

-- Create indexes
create index if not exists idx_scorecard_metrics_category_id on public.scorecard_metrics(category_id);
create index if not exists idx_scorecard_metrics_is_automated on public.scorecard_metrics(is_automated);

-- Scorecard entries (weekly values for each metric)
create table if not exists public.scorecard_entries (
  id uuid default uuid_generate_v4() primary key,
  metric_id uuid not null references public.scorecard_metrics(id) on delete cascade,
  week_start_date date not null, -- ISO week start date (Monday)
  value numeric(12, 2) not null, -- The actual value for this week
  target_value numeric(12, 2), -- Target for this specific week (can override default)
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  created_by uuid references public.users(id) on delete set null,
  unique(metric_id, week_start_date)
);

-- Create indexes
create index if not exists idx_scorecard_entries_metric_id on public.scorecard_entries(metric_id);
create index if not exists idx_scorecard_entries_week_start on public.scorecard_entries(week_start_date);

-- RLS Policies
alter table public.scorecard_categories enable row level security;
alter table public.scorecard_metrics enable row level security;
alter table public.scorecard_entries enable row level security;

-- All authenticated users can read scorecard data
create policy "Authenticated users can read scorecard categories"
  on public.scorecard_categories for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can read scorecard metrics"
  on public.scorecard_metrics for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can read scorecard entries"
  on public.scorecard_entries for select
  using (auth.role() = 'authenticated');

-- Only admins can manage scorecard configuration
create policy "Admins can manage scorecard categories"
  on public.scorecard_categories for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Admins can manage scorecard metrics"
  on public.scorecard_metrics for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- All authenticated users can create/update entries (for weekly updates)
create policy "Authenticated users can manage scorecard entries"
  on public.scorecard_entries for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Add triggers to update updated_at
create trigger update_scorecard_metrics_updated_at 
  before update on public.scorecard_metrics
  for each row execute function update_updated_at_column();

create trigger update_scorecard_entries_updated_at 
  before update on public.scorecard_entries
  for each row execute function update_updated_at_column();

-- Insert default metrics based on user requirements
-- MARKETING
insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Marketing'),
  'LinkedIn Page Visitors',
  'Number of visitors to LinkedIn page',
  'visitors',
  null,
  false,
  null,
  null,
  1
on conflict (category_id, name) do nothing;

insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Marketing'),
  'Networking Events attended',
  'Number of networking events attended',
  'events',
  null,
  false,
  null,
  null,
  2
on conflict (category_id, name) do nothing;

insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Marketing'),
  'Salo Drop Items Created',
  'Number of Salo Drop items created',
  'items',
  null,
  false,
  null,
  null,
  3
on conflict (category_id, name) do nothing;

-- SALES
insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Sales'),
  'New Lead Connections Made',
  'Number of new lead connections made',
  'connections',
  null,
  true,
  'leads',
  '{"type": "new_connections"}'::jsonb,
  1
on conflict (category_id, name) do nothing;

insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Sales'),
  'Intro Calls Completed',
  'Number of intro calls completed',
  'calls',
  null,
  true,
  'leads',
  '{"type": "intro_calls"}'::jsonb,
  2
on conflict (category_id, name) do nothing;

insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Sales'),
  'Quotes/Proposals Submitted',
  'Number of quotes/proposals submitted',
  'quotes',
  null,
  true,
  'leads',
  '{"type": "quotes_submitted"}'::jsonb,
  3
on conflict (category_id, name) do nothing;

insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Sales'),
  'Inbound Leads',
  'Number of inbound leads',
  'leads',
  null,
  true,
  'leads',
  '{"type": "inbound"}'::jsonb,
  4
on conflict (category_id, name) do nothing;

-- OPERATIONS
insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Operations'),
  'Billable Hours Completed',
  'Total billable hours completed',
  'hours',
  null,
  true,
  'time_tracking',
  null,
  1
on conflict (category_id, name) do nothing;

insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Operations'),
  'Capacity for the next 4 weeks',
  'Available capacity for the next 4 weeks',
  'hours',
  null,
  true,
  'capacity',
  null,
  2
on conflict (category_id, name) do nothing;

-- FINANCE
insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Finance'),
  '% of Quarterly Target Billed',
  'Percentage of quarterly target (£130k) billed',
  '%',
  130000,
  true,
  'xero',
  '{"type": "quarterly_target_billed"}'::jsonb,
  1
on conflict (category_id, name) do nothing;

insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Finance'),
  '% Profit for Quarter to Date',
  'Percentage profit for quarter to date',
  '%',
  null,
  true,
  'xero',
  '{"type": "profit_percentage"}'::jsonb,
  2
on conflict (category_id, name) do nothing;

insert into public.scorecard_metrics (category_id, name, description, unit, target_value, is_automated, automation_source, automation_config, display_order)
select 
  (select id from public.scorecard_categories where name = 'Finance'),
  '3 months pipeline value',
  'Total pipeline value for next 3 months',
  '£',
  null,
  true,
  'xero',
  '{"type": "pipeline_value"}'::jsonb,
  3
on conflict (category_id, name) do nothing;

