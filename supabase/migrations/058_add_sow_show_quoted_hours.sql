-- Control whether quoted hours appear on the public client share view

alter table public.sow_documents
  add column if not exists show_quoted_hours boolean not null default true;

comment on column public.sow_documents.show_quoted_hours is
  'When false, hours are hidden on the public share page (costs still shown)';
