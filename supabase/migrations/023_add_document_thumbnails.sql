-- Add thumbnail_path column to documents table
alter table public.documents
  add column if not exists thumbnail_path text;

-- Add index for thumbnail lookups
create index if not exists idx_documents_thumbnail_path 
  on public.documents(thumbnail_path) 
  where thumbnail_path is not null;

