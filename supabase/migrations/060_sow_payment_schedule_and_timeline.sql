-- SoW project timeline, payment schedule, and per-line-item timelines

alter table public.sow_documents
  add column if not exists start_date date,
  add column if not exists end_date date;

comment on column public.sow_documents.start_date is
  'Optional project start date shown on SoW and used for planning';
comment on column public.sow_documents.end_date is
  'Optional project end date; pushed to Monday Leads due date when present';

create table if not exists public.sow_payment_milestones (
  id uuid default uuid_generate_v4() primary key,
  sow_id uuid not null references public.sow_documents(id) on delete cascade,
  label text not null,
  percentage numeric(5, 2) not null check (percentage > 0 and percentage <= 100),
  due_date date,
  sort_order integer not null default 0,
  created_at timestamptz default now() not null
);

create index if not exists idx_sow_payment_milestones_sow_id
  on public.sow_payment_milestones(sow_id);

alter table public.sow_line_items
  add column if not exists timeline_start date,
  add column if not exists timeline_end date;

comment on column public.sow_line_items.timeline_start is
  'Optional line-item start date; pushed to Monday subitem timeline when present';
comment on column public.sow_line_items.timeline_end is
  'Optional line-item end date; pushed to Monday subitem timeline when present';

alter table public.sow_payment_milestones enable row level security;

drop policy if exists "Team can manage sow payment milestones" on public.sow_payment_milestones;

create policy "Team can manage sow payment milestones"
  on public.sow_payment_milestones for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

comment on table public.sow_payment_milestones is
  'Payment schedule rows for a SoW (label, percentage of total, optional due date)';
