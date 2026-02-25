-- Add setting to avoid archiving/deleting projects during sync (safe mode)
alter table public.monday_sync_settings
  add column if not exists avoid_deletion boolean default true not null;

comment on column public.monday_sync_settings.avoid_deletion is
  'When true, sync never archives or deletes projects; only adds/updates. Use to prevent accidental removal of completed projects.';
