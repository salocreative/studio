-- Designers and managers add and edit product cards, including cover and example files.
-- Links were already open to the team.

drop policy if exists "Admins can manage product cards" on public.product_cards;
drop policy if exists "Team can manage product cards" on public.product_cards;
drop policy if exists "Admins can manage product card items" on public.product_card_items;
drop policy if exists "Team can manage product card items" on public.product_card_items;
drop policy if exists "Admins can manage product card examples" on public.product_card_examples;
drop policy if exists "Team can manage product card examples" on public.product_card_examples;
drop policy if exists "Admins can manage product card related" on public.product_card_related;
drop policy if exists "Team can manage product card related" on public.product_card_related;

create policy "Team can manage product cards"
  on public.product_cards for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Team can manage product card items"
  on public.product_card_items for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Team can manage product card examples"
  on public.product_card_examples for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Team can manage product card related"
  on public.product_card_related for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

drop policy if exists "Admins can upload product card files" on storage.objects;
drop policy if exists "Admins can update product card files" on storage.objects;
drop policy if exists "Admins can delete product card files" on storage.objects;
drop policy if exists "Team can upload product card files" on storage.objects;
drop policy if exists "Team can update product card files" on storage.objects;
drop policy if exists "Team can delete product card files" on storage.objects;

create policy "Team can upload product card files"
  on storage.objects for insert
  with check (
    bucket_id = 'product-cards'
    and exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Team can update product card files"
  on storage.objects for update
  using (
    bucket_id = 'product-cards'
    and exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Team can delete product card files"
  on storage.objects for delete
  using (
    bucket_id = 'product-cards'
    and exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );
