-- Create enum for document categories
create type document_category as enum ('hr', 'sales');

-- Create documents table
create table public.documents (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  description text,
  category document_category not null,
  file_path text not null, -- Path to file in Supabase Storage
  file_name text not null, -- Original filename
  file_size bigint, -- File size in bytes
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Add indexes for faster queries
create index idx_documents_category on public.documents(category);
create index idx_documents_created_at on public.documents(created_at desc);

-- RLS Policy - only admins can manage documents
alter table public.documents enable row level security;

create policy "Admins can manage documents"
  on public.documents for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow all authenticated users to read documents
create policy "Authenticated users can read documents"
  on public.documents for select
  using (auth.role() = 'authenticated');

-- Add trigger to update updated_at timestamp
create trigger update_documents_updated_at 
  before update on public.documents
  for each row execute function update_updated_at_column();

