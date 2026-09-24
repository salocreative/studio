-- Product cards edited in Studio and read by products.salo.uk.
-- The products site has no table access. It calls the security-definer functions below
-- with the anon key. Draft cards are never returned.
--
-- crm_companies, crm_contacts and crm_contact_activities do not exist in Studio yet.
-- Examples store company_name, and tracked links store contact_name / contact_email.
-- Those become foreign keys, and the first view of a named link becomes a contact
-- activity, once the CRM tables exist.

create table if not exists public.product_cards (
  id uuid default uuid_generate_v4() primary key,
  slug text not null unique,
  name text not null,
  category text not null default '',
  status text not null default 'draft',
  decision_statement text not null default '',
  summary text not null default '',
  pricing_model text not null default 'fixed',
  price_amount numeric(12, 2),
  currency text not null default 'GBP',
  price_basis text not null default '',
  payment_terms text not null default '',
  price_note text,
  flexi_service_id uuid references public.flexi_design_services(id) on delete restrict,
  credit_override numeric(10, 2),
  timeline_text text not null default '',
  cta_kind text not null default 'book_call',
  cta_target text not null default '',
  owner_user_id uuid references public.users(id) on delete set null,
  indexable boolean not null default false,
  meta_title text,
  meta_description text,
  og_image_path text,
  published_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint product_cards_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint product_cards_name_not_blank check (char_length(btrim(name)) > 0),
  constraint product_cards_status_check check (status in ('draft', 'unlisted', 'published', 'retired')),
  constraint product_cards_pricing_model_check check (pricing_model in ('fixed', 'flexi')),
  constraint product_cards_currency_check check (currency in ('GBP', 'USD')),
  constraint product_cards_cta_kind_check check (cta_kind in ('book_call', 'reply_email', 'flexi_brief')),
  constraint product_cards_price_amount_check check (price_amount is null or price_amount >= 0),
  constraint product_cards_credit_override_check check (credit_override is null or credit_override >= 0)
);

create index if not exists idx_product_cards_status_sort
  on public.product_cards(status, sort_order, name);

comment on table public.product_cards is
  'Repeatable products rendered at products.salo.uk/[slug]. Studio is the source; the site reads published and unlisted cards via get_product_card.';
comment on column public.product_cards.decision_statement is
  'What the client can decide or change after the work. Required before publish.';
comment on column public.product_cards.pricing_model is
  'fixed: one-off pound price. flexi: paid from Flexi-Design credits via flexi_service_id. Never both.';
comment on column public.product_cards.indexable is
  'When false, the products site should noindex the page. Default false.';

create table if not exists public.product_card_items (
  id uuid default uuid_generate_v4() primary key,
  card_id uuid not null references public.product_cards(id) on delete cascade,
  section text not null,
  title text not null default '',
  body text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz default now() not null,
  constraint product_card_items_section_check check (
    section in ('choose_when', 'approach', 'outcome', 'terms', 'faq')
  )
);

create index if not exists idx_product_card_items_card
  on public.product_card_items(card_id, section, sort_order);

comment on table public.product_card_items is
  'Repeatable copy blocks. Sections are separate lists; the products site chooses the layout.';

create table if not exists public.product_card_examples (
  id uuid default uuid_generate_v4() primary key,
  card_id uuid not null references public.product_cards(id) on delete cascade,
  kind text not null,
  title text not null default '',
  caption text not null default '',
  storage_path text,
  url text,
  company_name text,
  case_study_path text,
  signoff_by uuid references public.users(id) on delete set null,
  signoff_at timestamptz,
  signoff_note text,
  sort_order integer not null default 0,
  created_at timestamptz default now() not null,
  constraint product_card_examples_kind_check check (
    kind in ('image', 'video', 'logo', 'case_study', 'quote')
  )
);

create index if not exists idx_product_card_examples_card
  on public.product_card_examples(card_id, sort_order);

comment on table public.product_card_examples is
  'Proof on a product card. The public functions only return rows with a sign-off. Logos and quotes also need company_name. Not sourced from flexi_design_gallery_items.';
comment on column public.product_card_examples.company_name is
  'Client being credited. Stands in for a crm_companies foreign key until that table exists.';

create table if not exists public.product_card_related (
  card_id uuid not null references public.product_cards(id) on delete cascade,
  related_card_id uuid not null references public.product_cards(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (card_id, related_card_id),
  constraint product_card_related_not_self check (card_id <> related_card_id)
);

create table if not exists public.product_card_links (
  id uuid default uuid_generate_v4() primary key,
  card_id uuid not null references public.product_cards(id) on delete cascade,
  token text not null unique,
  label text not null default '',
  contact_name text,
  contact_email text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now() not null,
  expires_at timestamptz,
  is_active boolean not null default true
);

create index if not exists idx_product_card_links_card
  on public.product_card_links(card_id, created_at desc);

comment on table public.product_card_links is
  'Tracked links for a product card. contact_name and contact_email stand in for crm_contacts until that table exists. A null contact is a generic link.';

create table if not exists public.product_card_views (
  id uuid default uuid_generate_v4() primary key,
  link_id uuid references public.product_card_links(id) on delete set null,
  card_id uuid not null references public.product_cards(id) on delete cascade,
  viewed_at timestamptz default now() not null,
  referrer_host text
);

create index if not exists idx_product_card_views_card_viewed
  on public.product_card_views(card_id, viewed_at desc);
create index if not exists idx_product_card_views_link
  on public.product_card_views(link_id, viewed_at desc);

comment on table public.product_card_views is
  'Page views. link_id is null for a visit without a valid token. No IP addresses.';

drop trigger if exists update_product_cards_updated_at on public.product_cards;
create trigger update_product_cards_updated_at
  before update on public.product_cards
  for each row execute function update_updated_at_column();

alter table public.product_cards enable row level security;
alter table public.product_card_items enable row level security;
alter table public.product_card_examples enable row level security;
alter table public.product_card_related enable row level security;
alter table public.product_card_links enable row level security;
alter table public.product_card_views enable row level security;

drop policy if exists "Team can read product cards" on public.product_cards;
drop policy if exists "Admins can manage product cards" on public.product_cards;
drop policy if exists "Team can read product card items" on public.product_card_items;
drop policy if exists "Admins can manage product card items" on public.product_card_items;
drop policy if exists "Team can read product card examples" on public.product_card_examples;
drop policy if exists "Admins can manage product card examples" on public.product_card_examples;
drop policy if exists "Team can read product card related" on public.product_card_related;
drop policy if exists "Admins can manage product card related" on public.product_card_related;
drop policy if exists "Team can manage product card links" on public.product_card_links;
drop policy if exists "Team can read product card views" on public.product_card_views;

create policy "Team can read product cards"
  on public.product_cards for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Admins can manage product cards"
  on public.product_cards for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Team can read product card items"
  on public.product_card_items for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Admins can manage product card items"
  on public.product_card_items for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Team can read product card examples"
  on public.product_card_examples for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Admins can manage product card examples"
  on public.product_card_examples for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Team can read product card related"
  on public.product_card_related for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Admins can manage product card related"
  on public.product_card_related for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Team can manage product card links"
  on public.product_card_links for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

create policy "Team can read product card views"
  on public.product_card_views for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'designer', 'manager')
        and deleted_at is null
    )
  );

-- Public read API for products.salo.uk. Returns null for drafts and unknown slugs.
create or replace function public.get_product_card(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.id is null then null
    else jsonb_build_object(
      'slug', c.slug,
      'name', c.name,
      'category', c.category,
      'status', c.status,
      'decision_statement', c.decision_statement,
      'summary', c.summary,
      'pricing_model', c.pricing_model,
      'price_amount', c.price_amount,
      'currency', c.currency,
      'price_basis', c.price_basis,
      'payment_terms', c.payment_terms,
      'price_note', c.price_note,
      'credit_estimate', coalesce(c.credit_override, s.credit_estimate),
      'flexi_service_title', s.title,
      'flexi_service_category', s.category,
      'timeline_text', c.timeline_text,
      'cta_kind', c.cta_kind,
      'cta_target', c.cta_target,
      'indexable', c.indexable,
      'meta_title', c.meta_title,
      'meta_description', c.meta_description,
      'og_image_path', c.og_image_path,
      'published_at', c.published_at,
      'updated_at', c.updated_at,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'section', i.section,
            'title', i.title,
            'body', i.body,
            'sort_order', i.sort_order
          )
          order by i.sort_order, i.created_at
        )
        from public.product_card_items i
        where i.card_id = c.id
      ), '[]'::jsonb),
      'examples', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'kind', e.kind,
            'title', e.title,
            'caption', e.caption,
            'storage_path', e.storage_path,
            'url', e.url,
            'company_name', e.company_name,
            'case_study_path', e.case_study_path,
            'sort_order', e.sort_order
          )
          order by e.sort_order, e.created_at
        )
        from public.product_card_examples e
        where e.card_id = c.id
          and e.signoff_at is not null
          and e.signoff_by is not null
          and (
            e.kind not in ('logo', 'quote')
            or nullif(btrim(e.company_name), '') is not null
          )
      ), '[]'::jsonb),
      'related', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'slug', r.slug,
            'name', r.name,
            'category', r.category,
            'summary', r.summary,
            'sort_order', rel.sort_order
          )
          order by rel.sort_order, r.name
        )
        from public.product_card_related rel
        join public.product_cards r on r.id = rel.related_card_id
        where rel.card_id = c.id
          and r.status = 'published'
      ), '[]'::jsonb)
    )
  end
  from public.product_cards c
  left join public.flexi_design_services s on s.id = c.flexi_service_id
  where c.slug = p_slug
    and c.status in ('published', 'unlisted', 'retired');
$$;

comment on function public.get_product_card(text) is
  'Public card for products.salo.uk, including unlisted and retired. Drafts are omitted. Examples require a sign-off.';

create or replace function public.list_product_cards()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(listed.row_data order by listed.sort_order, listed.name), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'slug', c.slug,
        'name', c.name,
        'category', c.category,
        'summary', c.summary,
        'pricing_model', c.pricing_model,
        'price_amount', c.price_amount,
        'currency', c.currency,
        'price_basis', c.price_basis,
        'price_note', c.price_note,
        'credit_estimate', coalesce(c.credit_override, s.credit_estimate),
        'flexi_service_title', s.title,
        'timeline_text', c.timeline_text,
        'sort_order', c.sort_order
      ) as row_data,
      c.sort_order,
      c.name
    from public.product_cards c
    left join public.flexi_design_services s on s.id = c.flexi_service_id
    where c.status = 'published'
  ) listed;
$$;

comment on function public.list_product_cards() is
  'Published cards only, for the products site index. Unlisted cards are omitted so they cannot be discovered.';

create or replace function public.log_product_card_view(
  p_slug text,
  p_token text default null,
  p_referrer_host text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_id uuid;
  v_link_id uuid;
  v_host text;
  v_token text;
begin
  select id into v_card_id
  from public.product_cards
  where slug = p_slug
    and status in ('published', 'unlisted', 'retired');

  if v_card_id is null then
    return;
  end if;

  v_token := nullif(btrim(coalesce(p_token, '')), '');
  if v_token is not null and char_length(v_token) <= 64 then
    select id into v_link_id
    from public.product_card_links
    where card_id = v_card_id
      and token = v_token
      and is_active
      and (expires_at is null or expires_at > now());
  end if;

  v_host := nullif(btrim(coalesce(p_referrer_host, '')), '');
  if v_host is null
    or char_length(v_host) > 255
    or v_host !~ '^[A-Za-z0-9.-]+$'
    or v_host like '%..%'
  then
    v_host := null;
  else
    v_host := lower(v_host);
  end if;

  insert into public.product_card_views (link_id, card_id, referrer_host)
  values (v_link_id, v_card_id, v_host);
end;
$$;

comment on function public.log_product_card_view(text, text, text) is
  'Records a products-site view. Invalid tokens are stored as untracked visits. Returns nothing.';

-- Studio stats. Invoker rights, so product_card_views RLS still applies.
create or replace function public.product_card_view_counts(p_since timestamptz)
returns table (card_id uuid, views bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select v.card_id, count(*)::bigint
  from public.product_card_views v
  where v.viewed_at >= p_since
  group by v.card_id;
$$;

create or replace function public.product_card_link_stats(p_card_id uuid)
returns table (
  link_id uuid,
  view_count bigint,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select v.link_id, count(*)::bigint, min(v.viewed_at), max(v.viewed_at)
  from public.product_card_views v
  where v.card_id = p_card_id
    and v.link_id is not null
  group by v.link_id;
$$;

revoke all on function public.get_product_card(text) from public;
revoke all on function public.list_product_cards() from public;
revoke all on function public.log_product_card_view(text, text, text) from public;
revoke all on function public.product_card_view_counts(timestamptz) from public;
revoke all on function public.product_card_link_stats(uuid) from public;

grant execute on function public.get_product_card(text) to anon, authenticated, service_role;
grant execute on function public.list_product_cards() to anon, authenticated, service_role;
grant execute on function public.log_product_card_view(text, text, text) to anon, authenticated, service_role;
grant execute on function public.product_card_view_counts(timestamptz) to authenticated, service_role;
grant execute on function public.product_card_link_stats(uuid) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-cards',
  'product-cards',
  true,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'video/mp4', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read product card files" on storage.objects;
drop policy if exists "Admins can upload product card files" on storage.objects;
drop policy if exists "Admins can update product card files" on storage.objects;
drop policy if exists "Admins can delete product card files" on storage.objects;

create policy "Public can read product card files"
  on storage.objects for select
  using (bucket_id = 'product-cards');

create policy "Admins can upload product card files"
  on storage.objects for insert
  with check (
    bucket_id = 'product-cards'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Admins can update product card files"
  on storage.objects for update
  using (
    bucket_id = 'product-cards'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );

create policy "Admins can delete product card files"
  on storage.objects for delete
  using (
    bucket_id = 'product-cards'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin' and deleted_at is null
    )
  );
