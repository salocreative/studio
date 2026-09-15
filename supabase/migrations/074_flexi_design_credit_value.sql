-- Record the ex-VAT £ charged for a Flexi-Design credit top-up so revenue
-- can be reported. value_is_estimated flags backfilled/guessed figures vs
-- amounts confirmed against an invoice.

alter table public.flexi_design_credit_transactions
  add column if not exists value_gbp numeric(10, 2),
  add column if not exists value_is_estimated boolean not null default false;

comment on column public.flexi_design_credit_transactions.value_gbp is
  'Ex-VAT GBP the client was charged for this top-up. Null when unknown.';

comment on column public.flexi_design_credit_transactions.value_is_estimated is
  'True when value_gbp was backfilled or estimated rather than confirmed against an invoice.';

-- Best-effort backfill from the current standard rate card. Pricing may have
-- moved over the period these rows cover, so mark estimated. Non-standard
-- hour amounts (e.g. 55-credit agency deals) are left null for a manual pass.
update public.flexi_design_credit_transactions
set
  value_gbp = case
    when hours = 20 then 1800
    when hours = 40 then 3420
    when hours = 60 then 4860
    when hours = 80 then 6120
  end,
  value_is_estimated = true
where value_gbp is null
  and hours in (20, 40, 60, 80);
