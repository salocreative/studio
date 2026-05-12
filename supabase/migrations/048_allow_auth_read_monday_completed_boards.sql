-- Allow all authenticated users to read completed-board configuration so Main timesheet
-- filtering can exclude archive boards (admins already had FOR ALL; SELECT needs explicit policy for others).

create policy "Authenticated users can read monday completed boards"
  on public.monday_completed_boards for select
  using (auth.role() = 'authenticated');
