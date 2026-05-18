-- Add end_date (finish date) to retainer_clients table
-- Used to mark when a retainer is ending. After this date, the retainer is considered
-- inactive and capacity calculations reflect a prorated allocation in the final month
-- and zero capacity in subsequent months.

alter table public.retainer_clients
  add column if not exists end_date date;

comment on column public.retainer_clients.end_date is 'Finish date for the retainer. After this date the retainer is considered ended. The final month is prorated by working days up to (and including) this date.';
