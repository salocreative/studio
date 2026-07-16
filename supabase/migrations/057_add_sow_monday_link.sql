-- Link statements of work to Monday.com leads board items

alter table public.sow_documents
  add column if not exists monday_project_id uuid references public.monday_projects(id) on delete set null,
  add column if not exists monday_item_id text,
  add column if not exists monday_board_id text,
  add column if not exists pushed_to_monday_at timestamptz;

create index if not exists idx_sow_documents_monday_project on public.sow_documents(monday_project_id);
create index if not exists idx_sow_documents_monday_item on public.sow_documents(monday_item_id);

comment on column public.sow_documents.monday_project_id is
  'Linked lead from monday_projects when imported from the leads board';
comment on column public.sow_documents.monday_item_id is
  'Monday.com item ID on the leads board (imported or pushed)';
comment on column public.sow_documents.pushed_to_monday_at is
  'When this SoW was pushed as a new item to the leads board';
