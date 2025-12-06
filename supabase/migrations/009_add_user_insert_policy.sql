-- Add RLS policy to allow admins to insert new users
-- This allows admin users to create user profiles when inviting new users

create policy "Admins can insert users"
  on public.users for insert
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );
