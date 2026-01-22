-- Add hours_per_day setting to retainer_clients table
-- This allows configuring how many hours are in a working day for each retainer client
-- Used for converting hours to days in the retainer view

alter table public.retainer_clients
  add column if not exists hours_per_day numeric(4, 2) default 6.0;

-- Add comment to explain usage
comment on column public.retainer_clients.hours_per_day is 'Number of hours in a working day for this retainer client. Used to convert hours to days in the retainer view. Default is 6 hours.';
