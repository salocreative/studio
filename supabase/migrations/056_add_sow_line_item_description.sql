-- Optional description for SoW line items

alter table public.sow_line_items
  add column if not exists description text;

comment on column public.sow_line_items.description is
  'Optional scope or deliverable detail shown under the line item title';
