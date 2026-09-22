-- Captured vendor invoices for review, then push to Xero as bills.
-- The Gmail filer writes rows via /api/expenses/captures. Admins moderate them in Studio.

create table if not exists public.vendor_rules (
  id uuid primary key default gen_random_uuid(),
  vendor_key text not null unique,
  vendor_name text not null,
  sender_domains text[],
  subject_keywords text[],
  raw_query_override text,
  mode text not null default 'attachment' check (mode in ('attachment', 'link', 'snapshot', 'flag')),
  link_domain_hint text,
  link_fallback boolean not null default false,
  folder_name text,
  is_capture_active boolean not null default true,
  xero_contact_id text,
  default_account_code text,
  default_tracking_category_id text,
  default_tracking_option_id text,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_captures (
  id uuid primary key default gen_random_uuid(),
  vendor_key text not null references public.vendor_rules (vendor_key),
  vendor_name text not null,
  gmail_message_id text not null,
  gmail_thread_id text,
  captured_at timestamptz not null default now(),
  email_date date,
  invoice_date date,
  amount numeric(10, 2),
  currency text not null default 'GBP',
  file_url text not null,
  file_type text not null check (file_type in ('pdf', 'html')),
  source_mode text not null check (source_mode in ('attachment', 'link', 'snapshot', 'flag')),
  status text not null default 'new' check (
    status in ('new', 'flagged_manual', 'approved', 'pushed', 'rejected', 'push_failed')
  ),
  chosen_account_code text,
  chosen_tracking_option_id text,
  xero_bill_id text,
  xero_pushed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gmail_message_id, file_url)
);

create index if not exists expense_captures_status_idx on public.expense_captures (status, email_date desc);
create index if not exists expense_captures_vendor_idx on public.expense_captures (vendor_key);

create table if not exists public.xero_push_log (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.expense_captures (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  result text not null check (result in ('success', 'error')),
  xero_bill_id text,
  error_message text
);

create index if not exists xero_push_log_capture_idx on public.xero_push_log (capture_id, attempted_at desc);

comment on table public.vendor_rules is
  'Which vendor emails the filer looks for, and the default Xero coding for their bills.';
comment on table public.expense_captures is
  'Invoices saved by the Gmail filer, waiting for review before a Xero bill is created.';
comment on table public.xero_push_log is
  'Audit trail for bills created in Xero from expense captures.';

alter table public.vendor_rules enable row level security;
alter table public.expense_captures enable row level security;
alter table public.xero_push_log enable row level security;

drop policy if exists "Admins can manage vendor rules" on public.vendor_rules;
create policy "Admins can manage vendor rules"
  on public.vendor_rules for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

drop policy if exists "Admins can manage expense captures" on public.expense_captures;
create policy "Admins can manage expense captures"
  on public.expense_captures for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

drop policy if exists "Admins can manage xero push log" on public.xero_push_log;
create policy "Admins can manage xero push log"
  on public.xero_push_log for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

-- One-time seed of the filer's current vendors. Xero contact and account code
-- are filled in later, per vendor, before anything from them can be pushed.
insert into public.vendor_rules (
  vendor_key, vendor_name, mode, raw_query_override, link_domain_hint, link_fallback
) values
  ('google_workspace', 'Google Workspace', 'attachment', $q$subject:"Google Workspace" (invoice OR receipt)$q$, null, false),
  ('monday', 'monday.com', 'attachment', $q$subject:"monday.com" (invoice OR receipt OR renewed OR renewal)$q$, null, false),
  ('figma', 'Figma', 'attachment', $q$from:(figma.com) (receipt OR invoice OR subscription)$q$, 'click.figma.com', true),
  ('adobe', 'Adobe', 'attachment', $q$subject:Adobe (invoice OR receipt OR transaction)$q$, null, false),
  ('atlassian', 'Atlassian', 'attachment', $q$from:(atlassian.com) (invoice OR payment)$q$, null, false),
  ('cloudflare', 'Cloudflare', 'flag', $q$from:(cloudflare.com) invoice$q$, null, false),
  ('godaddy', 'GoDaddy', 'snapshot', $q$from:(godaddy.com) (renewal OR receipt OR invoice)$q$, null, false),
  ('hetzner', 'Hetzner', 'attachment', $q$from:(hetzner.com) invoice$q$, null, false),
  ('trooli', 'Trooli', 'attachment', $q$from:(trooli.com) invoice$q$, null, false),
  ('supabase', 'Supabase', 'attachment', $q$from:(supabase.com) invoice$q$, null, false),
  ('anthropic', 'Anthropic (Claude)', 'attachment', $q$from:(stripe.com) subject:"Anthropic"$q$, null, false),
  ('framer', 'Framer', 'attachment', $q$from:(stripe.com) subject:"Framer"$q$, null, false),
  ('recraft', 'Recraft', 'attachment', $q$subject:"Recraft" (receipt OR invoice)$q$, null, false),
  ('mobbin', 'Mobbin', 'attachment', $q$subject:"Mobbin" (receipt OR invoice)$q$, null, false),
  ('icograms', 'Icograms', 'attachment', $q$subject:"Icograms"$q$, null, false),
  ('agency_hackers', 'Agency Hackers', 'attachment', $q$from:(agencyhackers.co.uk) invoice$q$, null, false),
  ('bima', 'BIMA', 'attachment', $q$from:(post.xero.com) subject:"British Interactive Media Association"$q$, null, false),
  ('tech_boards', 'Tech Boards Ltd', 'attachment', $q$from:(post.xero.com) subject:"Tech Boards"$q$, null, false),
  ('cloud_eleven', 'Cloud Eleven Accountants', 'attachment', $q$from:(post.xero.com) subject:"Cloud Eleven"$q$, null, false),
  ('slack', 'Slack', 'attachment', $q$subject:"Salo Creative, your plan has renewed"$q$, null, false),
  ('ald_automotive', 'ALD Automotive', 'attachment', $q$from:(aldautomotive.com) subject:Q2677038$q$, null, false),
  ('tinify', 'Tinify', 'attachment', $q$"Tinify" (subject:"plan has renewed" OR subject:"subscription was renewed" OR subject:"plan has been renewed" OR subject:"payment has been processed" OR subject:"payment was successful" OR subject:"your invoice" OR subject:"your receipt")$q$, null, false),
  ('jitter', 'Jitter', 'attachment', $q$"Jitter" (subject:"plan has renewed" OR subject:"subscription was renewed" OR subject:"plan has been renewed" OR subject:"payment has been processed" OR subject:"payment was successful" OR subject:"your invoice" OR subject:"your receipt")$q$, null, false),
  ('loom', 'Loom', 'attachment', $q$"Loom" (subject:"plan has renewed" OR subject:"subscription was renewed" OR subject:"plan has been renewed" OR subject:"payment has been processed" OR subject:"payment was successful" OR subject:"your invoice" OR subject:"your receipt")$q$, null, false),
  ('midjourney', 'Midjourney', 'attachment', $q$"Midjourney" (subject:"plan has renewed" OR subject:"subscription was renewed" OR subject:"plan has been renewed" OR subject:"payment has been processed" OR subject:"payment was successful" OR subject:"your invoice" OR subject:"your receipt")$q$, null, false),
  ('growth_leaders', 'Growth Leaders', 'attachment', $q$"Growth Leaders" (subject:"plan has renewed" OR subject:"subscription was renewed" OR subject:"plan has been renewed" OR subject:"payment has been processed" OR subject:"payment was successful" OR subject:"your invoice" OR subject:"your receipt")$q$, null, false),
  ('lookback_group', 'Lookback Group', 'attachment', $q$"Lookback Group" (subject:"plan has renewed" OR subject:"subscription was renewed" OR subject:"plan has been renewed" OR subject:"payment has been processed" OR subject:"payment was successful" OR subject:"your invoice" OR subject:"your receipt")$q$, null, false),
  ('vercel', 'Vercel', 'attachment', $q$from:(vercel.com) (receipt OR invoice)$q$, null, false),
  ('paddle_macpaw', 'Paddle (MacPaw)', 'link', $q$from:(paddle.com) subject:(MacPaw OR CleanMyMac)$q$, 'paddle.com/receipt', false),
  ('flywheel', 'Flywheel', 'link', $q$"getflywheel.com" (subject:"payment was successful" OR subject:invoice)$q$, 'getflywheel.com', false),
  ('trainline', 'Trainline', 'flag', $q$from:(info.thetrainline.com OR comms.trainline.com) (eticket OR receipt OR refund)$q$, null, false)
on conflict (vendor_key) do nothing;
