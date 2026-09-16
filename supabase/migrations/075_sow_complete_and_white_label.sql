-- Complete status, plus optional white-label (direct) rates on partner share views

alter table public.sow_documents
  drop constraint if exists sow_documents_status_check;

alter table public.sow_documents
  add constraint sow_documents_status_check
  check (status in ('draft', 'sent', 'approved', 'rejected', 'archived', 'complete'));

alter table public.sow_documents
  add column if not exists allow_white_label_view boolean not null default false,
  add column if not exists white_label_day_rate_gbp numeric(10, 2);

alter table public.sow_documents
  drop constraint if exists sow_documents_white_label_day_rate_gbp_check;

alter table public.sow_documents
  add constraint sow_documents_white_label_day_rate_gbp_check
  check (white_label_day_rate_gbp is null or white_label_day_rate_gbp > 0);

comment on column public.sow_documents.allow_white_label_view is
  'When true on a partner SoW, the public share view can switch between partner and direct (white-label) rates. Off by default.';
comment on column public.sow_documents.white_label_day_rate_gbp is
  'Snapshot of the direct client day rate used when white-label view is enabled.';
