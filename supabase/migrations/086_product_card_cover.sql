-- Cover image on a product card.
-- Not applied yet. Review before running.
-- Does not change og_image_path or product_card_examples.
-- Existing product_cards RLS already lets the team read and admins write these columns.
-- Uploads use the existing public product-cards bucket and admin storage policies.

alter table public.product_cards
  add column if not exists cover_image_path text,
  add column if not exists cover_image_alt text,
  add column if not exists cover_image_source text,
  add column if not exists cover_image_signoff_by uuid references public.users(id) on delete set null,
  add column if not exists cover_image_signoff_at timestamptz;

alter table public.product_cards drop constraint if exists product_cards_cover_source_check;
alter table public.product_cards
  add constraint product_cards_cover_source_check
  check (cover_image_source is null or cover_image_source in ('client', 'sample'));

alter table public.product_cards drop constraint if exists product_cards_cover_fields_check;
alter table public.product_cards
  add constraint product_cards_cover_fields_check
  check (
    (
      cover_image_path is null
      and cover_image_alt is null
      and cover_image_source is null
      and cover_image_signoff_by is null
      and cover_image_signoff_at is null
    )
    or (
      cover_image_path is not null
      and nullif(btrim(cover_image_alt), '') is not null
      and cover_image_source in ('client', 'sample')
      and (cover_image_signoff_by is null) = (cover_image_signoff_at is null)
    )
  );

comment on column public.product_cards.cover_image_path is
  'Path inside the public product-cards bucket, under covers/{card_id}/. Not the link-preview image.';
comment on column public.product_cards.cover_image_source is
  'client: real client work, hidden publicly until signed off. sample: in-house example, shown without a sign-off.';
comment on column public.product_cards.cover_image_signoff_by is
  'Who approved a client cover for the public page.';

-- Same card payload as 085, plus cover_image_url, cover_image_alt and cover_image_source.
-- Those three are null unless the cover is a sample, or client work with both sign-off fields set.
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
      'cover_image_url', case
        when c.cover_image_source = 'sample'
          or (
            c.cover_image_source = 'client'
            and c.cover_image_signoff_by is not null
            and c.cover_image_signoff_at is not null
          )
        then 'https://hlmfxwgbmrlmaueyyskn.supabase.co/storage/v1/object/public/product-cards/' || c.cover_image_path
        else null
      end,
      'cover_image_alt', case
        when c.cover_image_source = 'sample'
          or (
            c.cover_image_source = 'client'
            and c.cover_image_signoff_by is not null
            and c.cover_image_signoff_at is not null
          )
        then c.cover_image_alt
        else null
      end,
      'cover_image_source', case
        when c.cover_image_source = 'sample'
          or (
            c.cover_image_source = 'client'
            and c.cover_image_signoff_by is not null
            and c.cover_image_signoff_at is not null
          )
        then c.cover_image_source
        else null
      end,
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
  'Public card for products.salo.uk, including unlisted and retired. Drafts are omitted. Examples require a sign-off. A client cover is omitted until it is signed off.';

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
        'sort_order', c.sort_order,
        'cover_image_url', case
          when c.cover_image_source = 'sample'
            or (
              c.cover_image_source = 'client'
              and c.cover_image_signoff_by is not null
              and c.cover_image_signoff_at is not null
            )
          then 'https://hlmfxwgbmrlmaueyyskn.supabase.co/storage/v1/object/public/product-cards/' || c.cover_image_path
          else null
        end,
        'cover_image_alt', case
          when c.cover_image_source = 'sample'
            or (
              c.cover_image_source = 'client'
              and c.cover_image_signoff_by is not null
              and c.cover_image_signoff_at is not null
            )
          then c.cover_image_alt
          else null
        end,
        'cover_image_source', case
          when c.cover_image_source = 'sample'
            or (
              c.cover_image_source = 'client'
              and c.cover_image_signoff_by is not null
              and c.cover_image_signoff_at is not null
            )
          then c.cover_image_source
          else null
        end
      ) as row_data,
      c.sort_order,
      c.name
    from public.product_cards c
    left join public.flexi_design_services s on s.id = c.flexi_service_id
    where c.status = 'published'
  ) listed;
$$;

comment on function public.list_product_cards() is
  'Published cards only, for the products site index. Unlisted cards are omitted. A client cover is omitted until it is signed off.';
