-- Transform Documents to Cupboard system
-- This migration renames the documents table to cupboard_items and adds support for
-- multiple files, links, and custom categories

-- Step 1: Create cupboard_categories table (replaces enum)
create table if not exists public.cupboard_categories (
  id uuid default uuid_generate_v4() primary key,
  name text unique not null,
  display_order integer not null default 0,
  created_at timestamptz default now() not null
);

-- Insert default categories
insert into public.cupboard_categories (name, display_order)
values 
  ('HR', 1),
  ('Sales', 2),
  ('Operations', 3)
on conflict (name) do nothing;

-- Step 2: Create cupboard_items table (rename and refactor from documents)
-- First, create the new table structure
create table if not exists public.cupboard_items (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  description text,
  category_id uuid references public.cupboard_categories(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Step 3: Migrate existing documents data
-- Map enum categories to category IDs
insert into public.cupboard_items (id, title, description, category_id, created_by, created_at, updated_at)
select 
  d.id,
  d.title,
  d.description,
  case 
    when d.category = 'hr' then (select id from public.cupboard_categories where name = 'HR')
    when d.category = 'sales' then (select id from public.cupboard_categories where name = 'Sales')
    when d.category = 'operations' then (select id from public.cupboard_categories where name = 'Operations')
    else null
  end as category_id,
  d.created_by,
  d.created_at,
  d.updated_at
from public.documents d;

-- Step 4: Create cupboard_files table for multiple file uploads per item
create table if not exists public.cupboard_files (
  id uuid default uuid_generate_v4() primary key,
  item_id uuid references public.cupboard_items(id) on delete cascade not null,
  file_path text not null, -- Path to file in Supabase Storage
  file_name text not null, -- Original filename
  file_size bigint, -- File size in bytes
  file_type text, -- MIME type (e.g., 'application/pdf', 'image/png')
  thumbnail_path text, -- Path to thumbnail if applicable
  display_order integer not null default 0,
  created_at timestamptz default now() not null
);

-- Migrate existing file data from documents to cupboard_files
insert into public.cupboard_files (item_id, file_path, file_name, file_size, file_type, thumbnail_path, display_order, created_at)
select 
  d.id as item_id,
  d.file_path,
  d.file_name,
  d.file_size,
  'application/pdf' as file_type, -- Assume PDFs for existing documents
  d.thumbnail_path,
  0 as display_order,
  d.created_at
from public.documents d;

-- Step 5: Create cupboard_links table for URLs associated with items
create table if not exists public.cupboard_links (
  id uuid default uuid_generate_v4() primary key,
  item_id uuid references public.cupboard_items(id) on delete cascade not null,
  url text not null,
  label text, -- Optional label for the link (e.g., "Figma File", "Live Demo")
  display_order integer not null default 0,
  created_at timestamptz default now() not null
);

-- Step 6: Add indexes for performance
create index if not exists idx_cupboard_items_category_id on public.cupboard_items(category_id);
create index if not exists idx_cupboard_items_created_at on public.cupboard_items(created_at desc);
-- Full-text search index for title and description
create index if not exists idx_cupboard_items_search on public.cupboard_items using gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));
create index if not exists idx_cupboard_files_item_id on public.cupboard_files(item_id);
create index if not exists idx_cupboard_links_item_id on public.cupboard_links(item_id);
create index if not exists idx_cupboard_categories_display_order on public.cupboard_categories(display_order);

-- Step 7: Set up RLS Policies
alter table public.cupboard_categories enable row level security;
alter table public.cupboard_items enable row level security;
alter table public.cupboard_files enable row level security;
alter table public.cupboard_links enable row level security;

-- Categories: All authenticated users can read, only admins can manage
create policy "Authenticated users can read cupboard categories"
  on public.cupboard_categories for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage cupboard categories"
  on public.cupboard_categories for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- Items: All authenticated users can read, only admins can manage
create policy "Authenticated users can read cupboard items"
  on public.cupboard_items for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage cupboard items"
  on public.cupboard_items for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- Files: Inherit permissions from items (all authenticated can read, admins can manage)
create policy "Authenticated users can read cupboard files"
  on public.cupboard_files for select
  using (
    exists (
      select 1 from public.cupboard_items
      where id = item_id
    )
  );

create policy "Admins can manage cupboard files"
  on public.cupboard_files for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- Links: Inherit permissions from items (all authenticated can read, admins can manage)
create policy "Authenticated users can read cupboard links"
  on public.cupboard_links for select
  using (
    exists (
      select 1 from public.cupboard_items
      where id = item_id
    )
  );

create policy "Admins can manage cupboard links"
  on public.cupboard_links for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- Step 8: Add triggers
create trigger update_cupboard_items_updated_at 
  before update on public.cupboard_items
  for each row execute function update_updated_at_column();

-- Step 9: Drop old documents table (after migration is verified)
-- Note: Keep this commented out initially until you've verified the migration worked
-- Uncomment after verifying data is correctly migrated
-- drop table if exists public.documents cascade;
-- drop type if exists document_category;

