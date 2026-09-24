-- Where a site is hosted. Free text so Flywheel, Framer, Vercel, Webflow
-- and later platforms do not need their own migration.

alter table public.hosting_sites
  add column if not exists platform text;

create index if not exists idx_hosting_sites_platform on public.hosting_sites (platform);

comment on column public.hosting_sites.platform is
  'Where the site is hosted, such as Flywheel or Framer.';
