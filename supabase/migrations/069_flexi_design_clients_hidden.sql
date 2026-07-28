-- Soft-hide Flexi-Design clients from the default Clients list

alter table public.flexi_design_clients
  add column if not exists is_hidden boolean not null default false;

create index if not exists idx_flexi_design_clients_is_hidden
  on public.flexi_design_clients(is_hidden);

comment on column public.flexi_design_clients.is_hidden is
  'When true, client is hidden from the default Flexi-Design Clients list.';
