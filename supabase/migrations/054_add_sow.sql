-- Statement of Work documents, line items, and client share links

create table if not exists public.sow_documents (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  client_name text not null,
  customer_type text not null default 'client' check (customer_type in ('partner', 'client')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'rejected', 'archived')),
  include_vat boolean not null default false,
  subtotal_gbp numeric(12, 2) not null default 0,
  vat_amount_gbp numeric(12, 2) not null default 0,
  total_gbp numeric(12, 2) not null default 0,
  total_hours numeric(10, 2) not null default 0,
  notes text,
  approved_at timestamptz,
  approved_by_name text,
  approved_by_email text,
  rejected_at timestamptz,
  rejected_by_name text,
  rejection_notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.sow_line_items (
  id uuid default uuid_generate_v4() primary key,
  sow_id uuid not null references public.sow_documents(id) on delete cascade,
  title text not null,
  quantity numeric(10, 2) not null,
  is_days boolean not null default false,
  hours numeric(10, 2) not null,
  unit_rate_gbp numeric(10, 2) not null,
  line_total_gbp numeric(12, 2) not null,
  sort_order integer not null default 0,
  created_at timestamptz default now() not null
);

create table if not exists public.sow_share_links (
  id uuid default uuid_generate_v4() primary key,
  sow_id uuid not null references public.sow_documents(id) on delete cascade,
  share_token text not null unique,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  expires_at timestamptz,
  is_active boolean not null default true
);

create index if not exists idx_sow_documents_client on public.sow_documents(client_name);
create index if not exists idx_sow_documents_status on public.sow_documents(status);
create index if not exists idx_sow_documents_updated on public.sow_documents(updated_at desc);
create index if not exists idx_sow_line_items_sow_id on public.sow_line_items(sow_id);
create index if not exists idx_sow_share_links_token on public.sow_share_links(share_token);
create index if not exists idx_sow_share_links_sow_id on public.sow_share_links(sow_id);

drop trigger if exists update_sow_documents_updated_at on public.sow_documents;

create trigger update_sow_documents_updated_at
  before update on public.sow_documents
  for each row execute function update_updated_at_column();

alter table public.sow_documents enable row level security;
alter table public.sow_line_items enable row level security;
alter table public.sow_share_links enable row level security;

drop policy if exists "Team can manage sow documents" on public.sow_documents;
drop policy if exists "Team can manage sow line items" on public.sow_line_items;
drop policy if exists "Team can manage sow share links" on public.sow_share_links;

create policy "Team can manage sow documents"
  on public.sow_documents for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Team can manage sow line items"
  on public.sow_line_items for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Team can manage sow share links"
  on public.sow_share_links for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

comment on table public.sow_documents is 'Statement of Work documents for client projects';
comment on table public.sow_line_items is 'Line items (tasks) with time and cost for each SoW';
comment on table public.sow_share_links is 'Public share tokens for client review and approval';
