-- Fix RLS policy for xero_connection to include WITH CHECK for INSERT operations
-- Drop the existing policy
drop policy if exists "Admins can manage Xero connections" on public.xero_connection;

-- Recreate with both USING and WITH CHECK
create policy "Admins can manage Xero connections"
  on public.xero_connection for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Also fix the financial cache policy
drop policy if exists "Admins can manage financial cache" on public.xero_financial_cache;

create policy "Admins can manage financial cache"
  on public.xero_financial_cache for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

