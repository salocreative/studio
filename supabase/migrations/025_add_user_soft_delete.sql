-- Add deleted_at column to users table for soft delete
alter table public.users
  add column if not exists deleted_at timestamptz;

-- Add index for filtering active users
create index if not exists idx_users_deleted_at 
  on public.users(deleted_at) 
  where deleted_at is null;

-- Update RLS policies to exclude deleted users
-- Note: Existing policies will need to be reviewed and updated to exclude deleted users

