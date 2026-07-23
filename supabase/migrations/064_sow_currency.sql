-- SoW display currency and FX rate (pricing remains GBP; FX converts share-view money)

alter table public.sow_documents
  add column if not exists currency text not null default 'GBP',
  add column if not exists fx_rate numeric(12, 6) not null default 1;

alter table public.sow_documents
  drop constraint if exists sow_documents_currency_check;

alter table public.sow_documents
  add constraint sow_documents_currency_check check (currency in ('GBP', 'USD'));

alter table public.sow_documents
  drop constraint if exists sow_documents_fx_rate_check;

alter table public.sow_documents
  add constraint sow_documents_fx_rate_check check (fx_rate > 0);

comment on column public.sow_documents.currency is
  'Share-view currency. Internal line totals stay in GBP.';
comment on column public.sow_documents.fx_rate is
  'Units of currency per £1 (1 for GBP). Snapshot at save for stable share links.';
