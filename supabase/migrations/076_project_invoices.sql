-- Project invoices: track billing against Monday jobs (deposits, monthly amounts, final invoices)

create table if not exists public.project_invoices (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid not null references public.monday_projects(id) on delete cascade,
  label text not null,
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'need_invoicing'
    check (status in ('need_invoicing', 'waiting_payment', 'overdue', 'paid')),
  invoice_number text,
  invoice_date date,
  due_date date,
  paid_date date,
  notes text,
  sort_order integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_project_invoices_project_id
  on public.project_invoices(project_id);

create index if not exists idx_project_invoices_status
  on public.project_invoices(status);

create index if not exists idx_project_invoices_due_date
  on public.project_invoices(due_date);

comment on table public.project_invoices is
  'Studio-side billing tracker for Monday jobs. One project can have many invoices (deposit, monthly, final).';

comment on column public.project_invoices.label is
  'Short description, e.g. 50% deposit, Final delivery, April 2026.';

comment on column public.project_invoices.status is
  'need_invoicing | waiting_payment | overdue | paid. Waiting-payment invoices past due_date display as overdue.';

alter table public.project_invoices enable row level security;

drop policy if exists "Admins can manage project invoices" on public.project_invoices;

create policy "Admins can manage project invoices"
  on public.project_invoices for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role = 'admin'
        and deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role = 'admin'
        and deleted_at is null
    )
  );

create trigger update_project_invoices_updated_at
  before update on public.project_invoices
  for each row execute function update_updated_at_column();
