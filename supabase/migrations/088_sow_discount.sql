-- Optional percentage discount on a SoW, taken off the subtotal before VAT.

alter table public.sow_documents
  add column if not exists discount_percent numeric(5, 2)
    check (
      discount_percent is null
      or (discount_percent > 0 and discount_percent <= 100)
    );

comment on column public.sow_documents.discount_percent is
  'Optional percentage off the subtotal, applied before VAT. Null means no discount. Line items stay at full price.';
