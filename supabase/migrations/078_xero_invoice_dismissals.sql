-- Hide historic Xero invoices from Billing → Reconcile unmatched list

create table if not exists public.xero_invoice_dismissals (
  xero_invoice_id text primary key,
  dismissed_by uuid references public.users(id) on delete set null,
  dismissed_at timestamptz default now() not null
);

comment on table public.xero_invoice_dismissals is
  'Xero InvoiceIDs hidden from Billing → Reconcile. Does not change Xero or Studio invoices.';

alter table public.xero_invoice_dismissals enable row level security;

drop policy if exists "Admins can manage xero invoice dismissals" on public.xero_invoice_dismissals;

create policy "Admins can manage xero invoice dismissals"
  on public.xero_invoice_dismissals for all
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
