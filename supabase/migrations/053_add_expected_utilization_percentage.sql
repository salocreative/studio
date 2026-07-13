-- Per-user expected utilization capacity (percentage of full 5-day × 6h week)

alter table public.users
  add column if not exists expected_utilization_percentage numeric(5, 2) not null default 100;

alter table public.users
  add constraint users_expected_utilization_percentage_check
  check (expected_utilization_percentage >= 0 and expected_utilization_percentage <= 100);

comment on column public.users.expected_utilization_percentage is
  'Expected capacity as % of full-time (5 weekdays × 6h/day). Used for utilisation and performance metrics. 100 = full-time.';
