-- Allow managers to manage Cupboard content (DB + Storage)

-- Cupboard tables: expand admin-only manage policies to (admin, manager)
drop policy if exists "Admins can manage cupboard categories" on public.cupboard_categories;
create policy "Admins and managers can manage cupboard categories"
  on public.cupboard_categories for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'manager')
        and deleted_at is null
    )
  );

drop policy if exists "Admins can manage cupboard items" on public.cupboard_items;
create policy "Admins and managers can manage cupboard items"
  on public.cupboard_items for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'manager')
        and deleted_at is null
    )
  );

drop policy if exists "Admins can manage cupboard files" on public.cupboard_files;
create policy "Admins and managers can manage cupboard files"
  on public.cupboard_files for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'manager')
        and deleted_at is null
    )
  );

drop policy if exists "Admins can manage cupboard links" on public.cupboard_links;
create policy "Admins and managers can manage cupboard links"
  on public.cupboard_links for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'manager')
        and deleted_at is null
    )
  );

-- Storage bucket policies: expand admin-only policies to (admin, manager)
drop policy if exists "Admins can upload cupboard files" on storage.objects;
create policy "Admins and managers can upload cupboard files"
on storage.objects for insert
with check (
  bucket_id = 'cupboard'
  and exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin', 'manager')
      and deleted_at is null
  )
);

drop policy if exists "Admins can update cupboard files" on storage.objects;
create policy "Admins and managers can update cupboard files"
on storage.objects for update
using (
  bucket_id = 'cupboard'
  and exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin', 'manager')
      and deleted_at is null
  )
);

drop policy if exists "Admins can delete cupboard files" on storage.objects;
create policy "Admins and managers can delete cupboard files"
on storage.objects for delete
using (
  bucket_id = 'cupboard'
  and exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin', 'manager')
      and deleted_at is null
  )
);

