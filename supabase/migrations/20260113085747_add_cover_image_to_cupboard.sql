-- Add cover_image_path column to cupboard_items table
alter table public.cupboard_items
  add column if not exists cover_image_path text;

-- Add index for cover image path (optional, for performance)
create index if not exists idx_cupboard_items_cover_image_path 
  on public.cupboard_items(cover_image_path) 
  where cover_image_path is not null;

