-- Studio API tokens for external clients (e.g. Figma plugin)

create table public.studio_api_tokens (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  created_by uuid references public.users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now() not null
);

create index idx_studio_api_tokens_hash on public.studio_api_tokens(token_hash)
  where revoked_at is null;
create index idx_studio_api_tokens_created_by on public.studio_api_tokens(created_by);

comment on table public.studio_api_tokens is
  'Personal/team API tokens for external tools (Figma plugin, etc.). Only the SHA-256 hash is stored.';
comment on column public.studio_api_tokens.token_prefix is
  'First characters of the plaintext token for display (e.g. salo_ab12).';
comment on column public.studio_api_tokens.token_hash is
  'SHA-256 hex digest of the full plaintext token.';

alter table public.studio_api_tokens enable row level security;

create policy "Admins can manage studio API tokens"
  on public.studio_api_tokens for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Admins can read studio API tokens"
  on public.studio_api_tokens for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );
