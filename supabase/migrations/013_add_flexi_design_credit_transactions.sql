-- Create table to track Flexi-Design credit transactions (when credit was added)
create table public.flexi_design_credit_transactions (
  id uuid default uuid_generate_v4() primary key,
  client_id uuid references public.flexi_design_clients(id) on delete cascade not null,
  hours numeric(10, 2) not null,
  transaction_date date not null default current_date,
  created_at timestamptz default now() not null,
  created_by uuid references public.users(id) on delete set null
);

-- Add index for faster lookups
create index idx_flexi_credit_transactions_client_id on public.flexi_design_credit_transactions(client_id);
create index idx_flexi_credit_transactions_date on public.flexi_design_credit_transactions(transaction_date desc);

-- RLS Policy - only admins can manage credit transactions
alter table public.flexi_design_credit_transactions enable row level security;

create policy "Admins can manage credit transactions"
  on public.flexi_design_credit_transactions for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Allow all authenticated users to read credit transactions
create policy "Authenticated users can read credit transactions"
  on public.flexi_design_credit_transactions for select
  using (auth.role() = 'authenticated');

-- Note: remaining_hours in flexi_design_clients will now be calculated as:
-- total_deposited (sum of transactions) - total_quoted_hours (sum of project quoted_hours)
-- We keep the remaining_hours column for backwards compatibility but it will be recalculated

