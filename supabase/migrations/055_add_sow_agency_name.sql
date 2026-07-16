-- Agency partner on statements of work (when billing via an agency for an end client)

alter table public.sow_documents
  add column if not exists agency_name text;

comment on column public.sow_documents.agency_name is
  'Agency partner when customer_type is partner. End client is stored in client_name.';

create index if not exists idx_sow_documents_agency on public.sow_documents(agency_name);
