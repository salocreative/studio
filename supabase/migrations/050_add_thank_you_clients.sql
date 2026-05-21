-- Salo thank-you pages — client content for personalised /thank-you/{slug} pages

create table if not exists public.thank_you_clients (
  id uuid primary key default uuid_generate_v4(),

  slug text not null unique
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),

  client_name text not null,
  recipient_names text not null,
  project_description text not null,

  personal_message jsonb not null
    check (
      jsonb_typeof(personal_message) = 'string'
      or (
        jsonb_typeof(personal_message) = 'array'
        and jsonb_array_length(personal_message) > 0
      )
    ),

  team_video_url text,
  show_upsell boolean not null default true,

  referral_action_description text,
  upsell_heading text,
  upsell_description text,
  upsell_button_text text,

  published boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists thank_you_clients_published_idx
  on public.thank_you_clients (published, slug);

alter table public.thank_you_clients enable row level security;

drop policy if exists "Admins can manage thank you clients" on public.thank_you_clients;

create policy "Admins can manage thank you clients"
  on public.thank_you_clients for all
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

drop trigger if exists update_thank_you_clients_updated_at on public.thank_you_clients;

create trigger update_thank_you_clients_updated_at
  before update on public.thank_you_clients
  for each row execute function update_updated_at_column();
