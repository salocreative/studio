-- Add column to exclude users from utilization calculations
alter table public.users
add column if not exists exclude_from_utilization boolean default false not null;

-- Add index for faster lookups when filtering utilization
create index if not exists idx_users_exclude_from_utilization on public.users(exclude_from_utilization);

-- Add comment to explain the column
comment on column public.users.exclude_from_utilization is 'If true, user will be excluded from team utilization and performance calculations';

