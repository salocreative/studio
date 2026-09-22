-- Log of linked Studio invoices updated from Xero (Reconcile fetch or daily cron)

create table if not exists public.xero_invoice_status_sync_runs (
  id uuid default uuid_generate_v4() primary key,
  source text not null check (source in ('reconcile', 'cron')),
  ran_at timestamptz default now() not null,
  updated_count integer not null default 0,
  checked_count integer not null default 0,
  changes jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null
);

comment on table public.xero_invoice_status_sync_runs is
  'Latest Xero→Studio invoice status refreshes. Does not change Xero.';

create index if not exists idx_xero_invoice_status_sync_runs_ran_at
  on public.xero_invoice_status_sync_runs (ran_at desc);

alter table public.xero_invoice_status_sync_runs enable row level security;

drop policy if exists "Admins can manage xero invoice status sync runs"
  on public.xero_invoice_status_sync_runs;

create policy "Admins can manage xero invoice status sync runs"
  on public.xero_invoice_status_sync_runs for all
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
