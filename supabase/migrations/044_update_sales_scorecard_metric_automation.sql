-- Align Sales scorecard metrics with leads board automation.
-- Board: 18390907727
-- Likelihood column: numeric_mm20j92n
-- Value column: numbers
-- Status column: status (Quoted)

with sales_category as (
  select id
  from public.scorecard_categories
  where name = 'Sales'
  limit 1
)
update public.scorecard_metrics
set
  name = 'New Leads',
  description = 'New leads created on the leads board this week',
  unit = 'leads',
  is_automated = true,
  automation_source = 'leads',
  automation_config = jsonb_build_object(
    'type', 'new_leads',
    'boardId', '18390907727'
  ),
  updated_at = now()
where category_id = (select id from sales_category)
  and name = 'New Lead Connections Made';

with sales_category as (
  select id
  from public.scorecard_categories
  where name = 'Sales'
  limit 1
)
update public.scorecard_metrics
set
  name = 'Average Likelihood',
  description = 'Average likelihood % across all leads on the board',
  unit = '%',
  is_automated = true,
  automation_source = 'leads',
  automation_config = jsonb_build_object(
    'type', 'average_likelihood',
    'boardId', '18390907727',
    'likelihoodColumnId', 'numeric_mm20j92n'
  ),
  updated_at = now()
where category_id = (select id from sales_category)
  and name = 'Intro Calls Completed';

with sales_category as (
  select id
  from public.scorecard_categories
  where name = 'Sales'
  limit 1
)
update public.scorecard_metrics
set
  name = 'Quotes Done',
  description = 'Count of leads currently in Quoted status',
  unit = 'quotes',
  is_automated = true,
  automation_source = 'leads',
  automation_config = jsonb_build_object(
    'type', 'quotes_submitted',
    'boardId', '18390907727',
    'statusColumnId', 'status',
    'quotedStatus', 'Quoted'
  ),
  updated_at = now()
where category_id = (select id from sales_category)
  and name = 'Quotes/Proposals Submitted';

with sales_category as (
  select id
  from public.scorecard_categories
  where name = 'Sales'
  limit 1
)
update public.scorecard_metrics
set
  name = 'Pipeline Amount',
  description = 'Total value across all leads on the board',
  unit = '£',
  is_automated = true,
  automation_source = 'leads',
  automation_config = jsonb_build_object(
    'type', 'pipeline_amount',
    'boardId', '18390907727',
    'valueColumnId', 'numbers'
  ),
  updated_at = now()
where category_id = (select id from sales_category)
  and name = 'Inbound Leads';

insert into public.scorecard_metrics (
  category_id,
  name,
  description,
  unit,
  target_value,
  is_automated,
  automation_source,
  automation_config,
  display_order
)
select
  sc.id,
  'New Quotes This Week',
  'Count of items moved/updated to Quoted during the week',
  'quotes',
  null,
  true,
  'leads',
  jsonb_build_object(
    'type', 'quotes_new_this_week',
    'boardId', '18390907727',
    'statusColumnId', 'status',
    'quotedStatus', 'Quoted'
  ),
  5
from public.scorecard_categories sc
where sc.name = 'Sales'
on conflict (category_id, name) do update
set
  description = excluded.description,
  unit = excluded.unit,
  is_automated = excluded.is_automated,
  automation_source = excluded.automation_source,
  automation_config = excluded.automation_config,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.scorecard_metrics (
  category_id,
  name,
  description,
  unit,
  target_value,
  is_automated,
  automation_source,
  automation_config,
  display_order
)
select
  sc.id,
  'New Quotes Amount This Week',
  'Total value of items moved/updated to Quoted during the week',
  '£',
  null,
  true,
  'leads',
  jsonb_build_object(
    'type', 'quotes_new_amount_this_week',
    'boardId', '18390907727',
    'statusColumnId', 'status',
    'quotedStatus', 'Quoted',
    'valueColumnId', 'numbers'
  ),
  6
from public.scorecard_categories sc
where sc.name = 'Sales'
on conflict (category_id, name) do update
set
  description = excluded.description,
  unit = excluded.unit,
  is_automated = excluded.is_automated,
  automation_source = excluded.automation_source,
  automation_config = excluded.automation_config,
  display_order = excluded.display_order,
  updated_at = now();
