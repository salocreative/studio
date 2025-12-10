-- Add 'quote_value' to allowed column_type values in monday_column_mappings
-- This allows mapping a column to store quote subtotals/values on Monday.com

-- Drop the existing check constraint
alter table public.monday_column_mappings
drop constraint if exists monday_column_mappings_column_type_check;

-- Add the new check constraint with quote_value included
alter table public.monday_column_mappings
add constraint monday_column_mappings_column_type_check
check (column_type in ('client', 'time', 'quoted_hours', 'timeline', 'quote_value'));

-- Add comment to explain the new column type
comment on constraint monday_column_mappings_column_type_check on public.monday_column_mappings is 
  'quote_value: Column to store quote subtotal/value on main/parent items when pushing quotes to Monday.com';

