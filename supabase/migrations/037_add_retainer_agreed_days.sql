-- Add agreed days settings to retainer_clients table
-- This allows configuring how many days per week or per month the retainer is active
-- Daily allocation = monthly_hours / agreed_days
-- Any hours over the daily allocation on a given day come from rollover

alter table public.retainer_clients
  add column if not exists agreed_days_per_week numeric(5, 2),
  add column if not exists agreed_days_per_month numeric(5, 2);

-- Add comment to explain usage
comment on column public.retainer_clients.agreed_days_per_week is 'Number of days per week the retainer is active (e.g., 1-5). Used to calculate daily allocation.';
comment on column public.retainer_clients.agreed_days_per_month is 'Number of days per month the retainer is active. If set, takes precedence over agreed_days_per_week.';
