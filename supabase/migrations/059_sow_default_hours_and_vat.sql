-- New SoWs: hide quoted hours by default; include VAT by default

alter table public.sow_documents
  alter column show_quoted_hours set default false;

alter table public.sow_documents
  alter column include_vat set default true;

comment on column public.sow_documents.show_quoted_hours is
  'When false, hours are hidden on the public share page (costs still shown). Default false for new SoWs.';
