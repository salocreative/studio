-- Optional display of payment schedule on the public client share view

alter table public.sow_documents
  add column if not exists show_payment_schedule boolean not null default true;

comment on column public.sow_documents.show_payment_schedule is
  'When false, the payment schedule is hidden on the public share page. Default true.';
