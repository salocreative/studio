-- Flexi-Design client Files, Gallery, and Contacts (+ private storage bucket)

-- Files (AI context / reference docs)
create table public.flexi_design_files (
  id uuid default uuid_generate_v4() primary key,
  client_id uuid references public.flexi_design_clients(id) on delete cascade not null,
  file_name text not null,
  title text,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null
);

create index idx_flexi_design_files_client_id on public.flexi_design_files(client_id);
create index idx_flexi_design_files_created_at on public.flexi_design_files(created_at desc);

alter table public.flexi_design_files enable row level security;

create policy "Admins can manage Flexi-Design files"
  on public.flexi_design_files for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Authenticated users can read Flexi-Design files"
  on public.flexi_design_files for select
  using (auth.role() = 'authenticated');

-- Gallery (work examples, not tied to projects)
create table public.flexi_design_gallery_items (
  id uuid default uuid_generate_v4() primary key,
  client_id uuid references public.flexi_design_clients(id) on delete cascade not null,
  title text,
  caption text,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  sort_order integer default 0 not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null
);

create index idx_flexi_design_gallery_client_id on public.flexi_design_gallery_items(client_id);
create index idx_flexi_design_gallery_sort on public.flexi_design_gallery_items(client_id, sort_order, created_at desc);

alter table public.flexi_design_gallery_items enable row level security;

create policy "Admins can manage Flexi-Design gallery items"
  on public.flexi_design_gallery_items for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Authenticated users can read Flexi-Design gallery items"
  on public.flexi_design_gallery_items for select
  using (auth.role() = 'authenticated');

-- Contacts (for future automated emails)
create table public.flexi_design_contacts (
  id uuid default uuid_generate_v4() primary key,
  client_id uuid references public.flexi_design_clients(id) on delete cascade not null,
  name text not null,
  email text not null,
  role text,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_flexi_design_contacts_client_id on public.flexi_design_contacts(client_id);
create index idx_flexi_design_contacts_email on public.flexi_design_contacts(client_id, email);

alter table public.flexi_design_contacts enable row level security;

create policy "Admins can manage Flexi-Design contacts"
  on public.flexi_design_contacts for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Authenticated users can read Flexi-Design contacts"
  on public.flexi_design_contacts for select
  using (auth.role() = 'authenticated');

create trigger update_flexi_design_contacts_updated_at
  before update on public.flexi_design_contacts
  for each row execute function update_updated_at_column();

-- Private storage bucket for Flexi-Design client assets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'flexi-design',
  'flexi-design',
  false,
  52428800, -- 50 MB
  null
)
on conflict (id) do nothing;

-- Storage policies
create policy "Authenticated users can read Flexi-Design storage"
  on storage.objects for select
  using (
    bucket_id = 'flexi-design'
    and auth.role() = 'authenticated'
  );

create policy "Admins can upload Flexi-Design storage"
  on storage.objects for insert
  with check (
    bucket_id = 'flexi-design'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Admins can update Flexi-Design storage"
  on storage.objects for update
  using (
    bucket_id = 'flexi-design'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Admins can delete Flexi-Design storage"
  on storage.objects for delete
  using (
    bucket_id = 'flexi-design'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );
