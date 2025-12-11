-- Add quote_value column to monday_projects table
-- This stores the quote value/subtotal from Monday.com's Value column
alter table public.monday_projects
  add column if not exists quote_value numeric(10, 2);

-- Add index for faster filtering and sorting by quote value
create index if not exists idx_monday_projects_quote_value 
  on public.monday_projects(quote_value desc nulls last);

-- Add comment to explain the column
comment on column public.monday_projects.quote_value is 'Quote value/subtotal from Monday.com Value column (numbers type). Stored separately for easier querying and reporting.';

