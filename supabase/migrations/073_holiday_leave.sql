-- Annual Leave board (Monday 6382233029): holiday requests as their own data type,
-- not monday_projects. Also stores the Monday people id on Studio users so leave
-- can be joined to utilisation.

alter table public.users
  add column if not exists monday_user_id text;

create unique index if not exists idx_users_monday_user_id
  on public.users (monday_user_id)
  where monday_user_id is not null;

comment on column public.users.monday_user_id is
  'Monday.com people id. Used to attach holiday-board items to Studio users.';

create table public.monday_holidays_board (
  id uuid default uuid_generate_v4() primary key,
  monday_board_id text unique not null,
  board_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_monday_holidays_board_board_id on public.monday_holidays_board(monday_board_id);

alter table public.monday_holidays_board enable row level security;

create policy "Admins can manage holidays board"
  on public.monday_holidays_board for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Authenticated users can read holidays board"
  on public.monday_holidays_board for select
  using (auth.role() = 'authenticated');

create trigger update_monday_holidays_board_updated_at
  before update on public.monday_holidays_board
  for each row execute function update_updated_at_column();

insert into public.monday_holidays_board (monday_board_id, board_name)
values ('6382233029', 'Annual Leave');

create table public.holiday_requests (
  id uuid default uuid_generate_v4() primary key,
  monday_item_id text unique not null,
  monday_board_id text not null,
  name text not null,
  user_id uuid references public.users(id) on delete set null,
  monday_user_id text,
  leave_type text,
  status text,
  start_date date,
  end_date date,
  days numeric(6, 2),
  reduces_capacity boolean not null default false,
  monday_data jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_holiday_requests_user_id on public.holiday_requests(user_id);
create index idx_holiday_requests_dates on public.holiday_requests(start_date, end_date);
create index idx_holiday_requests_reduces_capacity
  on public.holiday_requests(reduces_capacity)
  where reduces_capacity = true;

comment on table public.holiday_requests is
  'Leave, sickness, birthdays and bank holidays synced from the Monday Annual Leave board.';
comment on column public.holiday_requests.reduces_capacity is
  'True for Approved, Completed, and legacy Before Sarah joined. Submitted and Denied do not reduce utilisation.';
comment on column public.holiday_requests.days is
  'Number of days from Monday (can be 0.5). Timeline may span weekends; days is the actual leave amount.';

alter table public.holiday_requests enable row level security;

create policy "Admins can manage holiday requests"
  on public.holiday_requests for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Authenticated users can read holiday requests"
  on public.holiday_requests for select
  using (auth.role() = 'authenticated');

create trigger update_holiday_requests_updated_at
  before update on public.holiday_requests
  for each row execute function update_updated_at_column();
