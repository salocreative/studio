-- Allow all authenticated users to read column mappings
-- This is needed for time tracking to identify Flexi-Design boards
-- Only admins can modify, but everyone needs to read for filtering projects

create policy "Authenticated users can read column mappings"
  on public.monday_column_mappings for select
  using (auth.role() = 'authenticated');

