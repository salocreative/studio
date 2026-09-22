-- Link Studio invoices to Xero so the same Xero invoice cannot be matched twice

alter table public.project_invoices
  add column if not exists xero_invoice_id text;

comment on column public.project_invoices.xero_invoice_id is
  'Xero InvoiceID when this row was matched or imported from Xero. Unique when set.';

create unique index if not exists idx_project_invoices_xero_invoice_id
  on public.project_invoices(xero_invoice_id)
  where xero_invoice_id is not null;
