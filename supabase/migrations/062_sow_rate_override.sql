-- Per-SoW quoted day rate override (true effort stays on line items; share view can scale hours)

alter table public.sow_documents
  add column if not exists day_rate_override_gbp numeric(10, 2)
    check (day_rate_override_gbp is null or day_rate_override_gbp > 0),
  add column if not exists base_day_rate_gbp numeric(10, 2),
  add column if not exists hours_per_day numeric(4, 2);

comment on column public.sow_documents.day_rate_override_gbp is
  'Optional client-facing day rate. When set, share-view hours are scaled by base/override. Null uses base rate with no scaling.';
comment on column public.sow_documents.base_day_rate_gbp is
  'Snapshot of the studio day rate used to price true effort for this SoW.';
comment on column public.sow_documents.hours_per_day is
  'Snapshot of hours-per-day used with the base day rate for this SoW.';

-- Backfill snapshots from current quote_rates by customer_type
update public.sow_documents d
set
  base_day_rate_gbp = coalesce(d.base_day_rate_gbp, r.day_rate_gbp),
  hours_per_day = coalesce(d.hours_per_day, r.hours_per_day)
from public.quote_rates r
where r.customer_type = d.customer_type
  and (d.base_day_rate_gbp is null or d.hours_per_day is null);

-- Fallback if a customer_type has no quote_rates row
update public.sow_documents
set
  base_day_rate_gbp = coalesce(base_day_rate_gbp, 720),
  hours_per_day = coalesce(hours_per_day, 6)
where base_day_rate_gbp is null or hours_per_day is null;

alter table public.sow_documents
  alter column base_day_rate_gbp set not null,
  alter column hours_per_day set not null;

alter table public.sow_documents
  add constraint sow_documents_base_day_rate_gbp_check check (base_day_rate_gbp > 0),
  add constraint sow_documents_hours_per_day_check check (hours_per_day > 0);
