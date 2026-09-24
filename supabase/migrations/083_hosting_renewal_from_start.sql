-- Next renewal is calculated from started_on and billing_cycle.
-- Drop the stored renewal date added in 082.

drop index if exists public.idx_hosting_sites_renewal_on;

alter table public.hosting_sites
  drop column if exists renewal_on;

comment on column public.hosting_sites.started_on is
  'Billing anchor. The next renewal is the next cycle date on or after today.';
