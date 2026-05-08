-- Restrict Sales scorecard automations to "Active Leads" group on Monday leads board.
-- Group title filter is used by default unless activeGroupId is provided.

update public.scorecard_metrics
set
  automation_config = coalesce(automation_config, '{}'::jsonb) || jsonb_build_object(
    'activeGroupTitle', 'Active Leads'
  ),
  updated_at = now()
where automation_source = 'leads'
  and category_id in (
    select id from public.scorecard_categories where name = 'Sales'
  );
