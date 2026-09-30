-- Held: invoice is in the billing plan but must not be raised yet (e.g. 50% on delivery)

alter table public.project_invoices
  drop constraint if exists project_invoices_status_check;

alter table public.project_invoices
  add constraint project_invoices_status_check
  check (status in ('need_invoicing', 'held', 'waiting_payment', 'overdue', 'paid'));

comment on column public.project_invoices.status is
  'need_invoicing (Ready to bill) | held | waiting_payment | overdue | paid. Held invoices are planned but not ready to raise. Waiting-payment invoices past due_date display as overdue.';
