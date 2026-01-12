-- Add monthly hours, rollover hours, and start date to retainer_clients table

alter table public.retainer_clients
  add column if not exists monthly_hours numeric(10, 2),
  add column if not exists rollover_hours numeric(10, 2),
  add column if not exists start_date date;

