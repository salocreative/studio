-- Add workspace_id column to monday_column_mappings table
alter table public.monday_column_mappings 
  add column if not exists workspace_id text;

-- Drop the old unique constraint if it exists
alter table public.monday_column_mappings
  drop constraint if exists monday_column_mappings_column_type_board_id_key;

-- Create a unique index that properly handles NULL values
-- PostgreSQL treats NULL != NULL in unique constraints, so we use COALESCE
create unique index if not exists monday_column_mappings_unique 
  on public.monday_column_mappings(
    column_type, 
    coalesce(board_id, ''),
    coalesce(workspace_id, '')
  );

-- Add index for faster lookups by workspace_id
create index if not exists idx_monday_column_mappings_workspace_id 
  on public.monday_column_mappings(workspace_id) 
  where workspace_id is not null;

-- Add index for faster lookups by board_id
create index if not exists idx_monday_column_mappings_board_id 
  on public.monday_column_mappings(board_id)
  where board_id is not null;

