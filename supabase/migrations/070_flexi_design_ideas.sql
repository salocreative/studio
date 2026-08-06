-- Flexi-Design ideas: push-to-flexi backlog and client confirm/decline
--
-- Ideas only ever land here once Finalised in Olas's clients/{Client}/ideas.md.
-- Confirming an idea is a flag of client intent only — it does NOT touch
-- flexi_design_credit_transactions. Costing/scheduling stays a team step.

create table if not exists public.flexi_design_ideas (
  id uuid default uuid_generate_v4() primary key,
  client_id uuid references public.flexi_design_clients(id) on delete cascade not null,
  title text not null,
  summary text not null,
  deliverable text not null default '',
  goal text not null default '',
  credit_estimate numeric(10, 2) check (credit_estimate >= 0),
  status text not null default 'pushed' check (status in ('pushed', 'confirmed', 'declined')),
  slack_thread_url text,
  pushed_at timestamptz default now() not null,
  decided_at timestamptz,
  decided_by_name text,
  decision_notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_flexi_design_ideas_client_id
  on public.flexi_design_ideas(client_id);

create index if not exists idx_flexi_design_ideas_status
  on public.flexi_design_ideas(client_id, status);

comment on table public.flexi_design_ideas is
  'Finalised creative ideas pushed live to a client''s Flexi-Design portal for confirm/decline. Source of truth for drafting/review stays Olas''s clients/{Client}/ideas.md in Drive.';
comment on column public.flexi_design_ideas.status is
  'pushed = live, awaiting client action. confirmed/declined = client has responded (intent only, no credit deduction).';
comment on column public.flexi_design_ideas.credit_estimate is
  'Team''s credit estimate at the point of push, for the client''s reference. Not a transaction.';

alter table public.flexi_design_ideas enable row level security;

drop policy if exists "Admins can manage flexi design ideas" on public.flexi_design_ideas;
drop policy if exists "Team can read flexi design ideas" on public.flexi_design_ideas;

create policy "Admins can manage flexi design ideas"
  on public.flexi_design_ideas for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role = 'admin'
        and deleted_at is null
    )
  );

create policy "Team can read flexi design ideas"
  on public.flexi_design_ideas for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

drop trigger if exists update_flexi_design_ideas_updated_at on public.flexi_design_ideas;

create trigger update_flexi_design_ideas_updated_at
  before update on public.flexi_design_ideas
  for each row execute function update_updated_at_column();
