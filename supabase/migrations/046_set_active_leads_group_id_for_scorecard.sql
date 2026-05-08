-- Use explicit Active Leads group ID for Sales scorecard metrics.
-- Provided by user: new_group7337__1

update public.scorecard_metrics
set
  automation_config = coalesce(automation_config, '{}'::jsonb) || jsonb_build_object(
    'activeGroupId', 'new_group7337__1',
    'activeGroupTitle', 'Active Leads'
  ),
  updated_at = now()
where automation_source = 'leads'
  and category_id in (
    select id from public.scorecard_categories where name = 'Sales'
  );
