-- Share links for Time Reports (live report view for customers)
create table if not exists public.time_report_share_links (
  id uuid default uuid_generate_v4() primary key,
  client_name text not null,
  share_token text not null unique,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  expires_at timestamptz,
  is_active boolean not null default true
);

create index if not exists idx_time_report_share_links_token on public.time_report_share_links(share_token);
create index if not exists idx_time_report_share_links_client on public.time_report_share_links(client_name);

alter table public.time_report_share_links enable row level security;

create policy "Admins and managers can manage time report share links"
  on public.time_report_share_links for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'manager') and deleted_at is null
    )
  );

-- Public read by token is done via service role in server action (no policy for anon)
