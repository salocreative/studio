# Salo Studio — Supabase Schema & Monday.com Sync Reference

Reference for external tools that read or write data in this app's Supabase instance. Captures every `public` table that exists after applying all migrations in `supabase/migrations/`, the RLS posture, and exactly what is pulled from Monday.com.

- Database: PostgreSQL (Supabase)
- Most tables have **Row Level Security** enabled. Read access is generally available to authenticated users, write access is restricted to `admin` (occasionally `admin` + `manager`).
- Service role (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS and is used for sync jobs and public share-link readers. Use it carefully from a server-side context only.
- Convention: every mutable table has `created_at timestamptz default now()` and (where shown) `updated_at timestamptz` maintained by the trigger function `update_updated_at_column()`.

## Contents
1. [Conventions & primitives](#conventions--primitives)
2. [Authentication & users](#authentication--users)
3. [Monday.com sync — projects, tasks, configuration](#mondaycom-sync--projects-tasks-configuration)
4. [Time tracking](#time-tracking)
5. [Retainers](#retainers)
6. [Flexi-Design](#flexi-design)
7. [Cupboard (documents)](#cupboard-documents)
8. [Scorecards](#scorecards)
9. [Customer relationship scores](#customer-relationship-scores)
10. [Quoting & rates](#quoting--rates)
11. [Xero integration](#xero-integration)
12. [Share links (time report, etc.)](#share-links-time-report-etc)
13. [Legacy tables](#legacy-tables)
14. [Monday.com sync — what is synced and how](#mondaycom-sync--what-is-synced-and-how)
15. [Access patterns for an external tool](#access-patterns-for-an-external-tool)

---

## Conventions & primitives

### Enums
- `user_role` — `'admin' | 'designer' | 'manager' | 'employee'` (`'employee'` is the original name and is being replaced by `'manager'`; `'manager'` is the current default).
- `project_status` — `'active' | 'archived' | 'locked' | 'lead'`.
- `document_category` — `'hr' | 'sales' | 'operations'` (legacy, see Cupboard).

### Shared helpers
- Function `update_updated_at_column()` — trigger that sets `updated_at = now()` on update. Most tables wire this via a `before update` trigger.
- Extension: `uuid-ossp` (used by `uuid_generate_v4()`).

### RLS shorthand used below
- **Auth read** — `auth.role() = 'authenticated'` can `SELECT`.
- **Admin all** — only rows where `auth.uid()` resolves to a non-deleted admin can `INSERT/UPDATE/DELETE` (and, since policy is `FOR ALL`, can also `SELECT` if no broader auth-read policy exists).
- **Admin+manager all** — same, but allows the `manager` role.
- **Public read by token** — there is no anon policy; reads happen via the **service role** in server actions that validate the share token.

---

## Authentication & users

### `public.users`
Mirrors `auth.users` 1:1 and stores app-level profile data.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | FK → `auth.users.id` (`on delete cascade`) |
| `email` | `text` unique not null | |
| `full_name` | `text` | |
| `role` | `user_role` not null default `'manager'` | Used everywhere for RLS checks. |
| `exclude_from_utilization` | `boolean` not null default `false` | If true, user is hidden from team utilization/perf views. |
| `deleted_at` | `timestamptz` | Soft delete. Most RLS checks filter `deleted_at is null`. |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Indexes: `idx_users_exclude_from_utilization`, partial `idx_users_deleted_at where deleted_at is null`.

RLS:
- A user can `SELECT` and `UPDATE` their own row.
- Admins can `INSERT` users (used for invite flow).
- Other policies referencing role/permission always join through this table.

**Tip:** when reading users from an external tool, always filter `deleted_at is null` unless you need history.

---

## Monday.com sync — projects, tasks, configuration

These tables hold the locally-synced mirror of Monday data plus the configuration that drives the sync.

### `public.monday_projects`
Each row is one Monday item from a configured board (a "project").

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `monday_item_id` | `text` unique not null | Monday item ID. Stable join key with Monday. |
| `monday_board_id` | `text` not null | Monday board ID; classifies the project (Main / Flexi / Completed / Leads). |
| `name` | `text` not null | Monday item name. |
| `client_name` | `text` | Resolved via `monday_column_mappings` (`column_type = 'client'`). |
| `agency` | `text` | Resolved via `monday_column_mappings` (`column_type = 'agency'`). |
| `status` | `project_status` not null default `'active'` | Computed during sync (see [Sync details](#mondaycom-sync--what-is-synced-and-how)). |
| `quoted_hours` | `numeric(10,2)` | Sum of child `monday_tasks.quoted_hours`. Updated during sync. |
| `quote_value` | `numeric(10,2)` | Resolved via `monday_column_mappings` (`column_type = 'quote_value'`). |
| `due_date` | `date` | Active-project due date (`column_type = 'due_date'`). |
| `completed_date` | `date` | Completion date (`column_type = 'completed_date'`; legacy fallback to `date__1`). |
| `monday_data` | `jsonb` | Raw column values keyed by Monday column ID; see [`monday_data` shape](#monday_data-shape). |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Indexes: `idx_monday_projects_board_id`, `idx_monday_projects_status`, `idx_monday_projects_completed_date` (desc nulls last), `idx_monday_projects_due_date` (desc nulls last), `idx_monday_projects_quote_value` (desc nulls last), `idx_monday_projects_agency`.

RLS:
- Auth read.
- Admin all (manage).

### `public.monday_tasks`
Subitems of a Monday project. `is_subtask` is always set to `true` during sync — the schema supports nested tasks but they aren't currently produced.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `monday_item_id` | `text` unique not null | Monday subitem ID. |
| `project_id` | `uuid` not null | FK → `monday_projects.id` (`on delete cascade`). |
| `name` | `text` not null | |
| `is_subtask` | `boolean` not null default `false` | |
| `parent_task_id` | `uuid` | FK → `monday_tasks.id` (`on delete set null`); unused today. |
| `assigned_user_ids` | `text[]` | **Monday user IDs**, not Supabase user IDs. Extracted from the first `people` column on the subitem. |
| `quoted_hours` | `numeric(10,2)` | Resolved via mapping (`column_type = 'quoted_hours'`). |
| `timeline_start`, `timeline_end` | `timestamptz` | Resolved via mapping (`column_type = 'timeline'`). |
| `monday_data` | `jsonb` | Raw column values; see [`monday_data` shape](#monday_data-shape). |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Indexes: `idx_monday_tasks_project_id`, GIN `idx_monday_tasks_assigned_users on (assigned_user_ids)`.

RLS:
- Auth read.
- Admin all.

### `public.monday_column_mappings`
The table that connects "column type" semantics to a specific Monday column ID. Read by sync and by reporting code.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `monday_column_id` | `text` not null | The Monday column ID (e.g. `text_mksx1234`, `numbers`, `date__1`). |
| `column_type` | `text` not null | One of: `'client', 'time', 'quoted_hours', 'timeline', 'quote_value', 'due_date', 'completed_date', 'status', 'agency'`. |
| `board_id` | `text` | Nullable. `NULL` means "global default for any board that doesn't have a board-specific mapping". |
| `workspace_id` | `text` | Optional; used for workspace-scoped mappings. |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Composite unique index `monday_column_mappings_unique(column_type, coalesce(board_id, ''), coalesce(workspace_id, ''))`.
Partial indexes: `idx_monday_column_mappings_workspace_id where workspace_id is not null`, `idx_monday_column_mappings_board_id where board_id is not null`.

RLS:
- Auth read (added so designers can identify Flexi boards from the client).
- Admin all.

### `public.monday_completed_boards`
Lists boards that hold completed/locked projects. Items here are kept but never lose their `locked` status during sync.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `monday_board_id` | `text` unique not null | |
| `board_name` | `text` | |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

RLS:
- Auth read (migration 048).
- Admin all.

### `public.monday_leads_board`
Single-row-by-convention config that names the board to treat as **leads**. Projects on this board sync with `status = 'lead'`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `monday_board_id` | `text` unique | |
| `board_name` | `text` | |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

RLS: Auth read; Admin all.

### `public.monday_sync_settings`
Single fixed-id row (`id = '00000000-0000-0000-0000-000000000000'`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Always the zero UUID. |
| `enabled` | `boolean` not null default `false` | Master switch for periodic auto-sync. |
| `interval_minutes` | `integer` not null default `60` | `check (> 0)`. |
| `last_sync_at`, `next_sync_at` | `timestamptz` | |
| `avoid_deletion` | `boolean` not null default `true` | Safety mode: never archive/delete projects during sync. |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

RLS: Auth read; Admin all.

### `public.flexi_design_boards`
Canonical list of Flexi-Design boards. When this table has at least one row it is the source of truth for Main vs Flexi classification; otherwise classification falls back to "Monday board name contains 'flexi'".

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `monday_board_id` | `text` unique not null | |
| `board_name` | `text` | |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

RLS: Auth read; Admin all.

### `public.flexi_design_completed_board`
Like `monday_completed_boards` but specifically for the Flexi-Design completed archive. Items synced from this board land in `monday_projects` with `status = 'locked'`.

Columns mirror `monday_completed_boards`. RLS: Auth read; Admin all.

### `public.leads_status_config`
Single-row config of which Monday status values count as "in scope" for leads on the Monthly Summary.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `included_statuses` | `text[]` default `'{}'` | |
| `excluded_statuses` | `text[]` default `'{}'` | |
| `created_at`, `updated_at` | `timestamptz` | |

Unique index on the constant `(1)` enforces a single row. RLS: Admin read/insert/update (no broad auth-read policy).

---

## Time tracking

### `public.time_entries`
A logged hour entry from a user against a task.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` not null | FK → `users.id` (`on delete cascade`). |
| `task_id` | `uuid` not null | FK → `monday_tasks.id` (`on delete restrict`). Cannot delete a task while time exists on it. |
| `project_id` | `uuid` not null | FK → `monday_projects.id` (`on delete restrict`). Denormalised for fast filtering. |
| `date` | `date` not null | The work day. |
| `hours` | `numeric(4,2)` not null | `check (hours > 0)`. |
| `notes` | `text` | |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Unique constraint `(user_id, task_id, date)` — one entry per user/task/day.
Indexes: `idx_time_entries_user_id`, `idx_time_entries_date`, `idx_time_entries_project_id`.

RLS:
- Auth read (everyone can see all entries for reporting).
- A user can `INSERT/UPDATE/DELETE` only their own rows. Insert is additionally blocked when the project is `locked`.

### `public.favorite_tasks`
Per-user pinned tasks.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` not null | FK → `users.id` (`cascade`). |
| `task_id` | `uuid` not null | FK → `monday_tasks.id` (`cascade`). |
| `created_at` | `timestamptz` | |

Unique `(user_id, task_id)`. RLS: a user can manage only their own row.

---

## Retainers

### `public.retainer_clients`
A client elevated to retainer status, with the agreement terms used by the Retainers UI.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_name` | `text` unique not null | Matches `monday_projects.client_name` (case-sensitive). |
| `display_order` | `integer` not null default `0` | |
| `monthly_hours` | `numeric(10,2)` | Agreed hours per month. |
| `rollover_hours` | `numeric(10,2)` | Overflow hours that can absorb daily overage. |
| `start_date` | `date` | Time entries before this are excluded from retainer views. |
| `end_date` | `date` | **Finish date.** Time entries after this are excluded; the month containing this date is prorated by working days; later months show zero capacity. (Added in migration 049.) |
| `agreed_days_per_week` | `numeric(5,2)` | Informational. |
| `agreed_days_per_month` | `numeric(5,2)` | Informational. Takes precedence over per-week for display logic. |
| `hours_per_day` | `numeric(4,2)` default `6.0` | Working day length; daily cap for "monthly vs overflow" split; used to convert hours to days on the public share view. |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

RLS: Auth read; Admin all.

### `public.retainer_share_links`
Public share tokens for the retainer report.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `retainer_client_id` | `uuid` not null | FK → `retainer_clients.id` (`cascade`). |
| `share_token` | `text` unique not null | Token used in the public URL. |
| `created_by` | `uuid` | FK → `users.id` (`set null`). |
| `expires_at` | `timestamptz` | Optional expiry. |
| `is_active` | `boolean` not null default `true` | |
| `created_at` | `timestamptz` | |

Indexes: `idx_retainer_share_links_token`, `idx_retainer_share_links_retainer_client_id`, partial `idx_retainer_share_links_active where is_active = true`.

RLS:
- Admin all.
- "Public can read active retainer share links" — `SELECT` allowed when `is_active = true AND (expires_at IS NULL OR expires_at > now())`. **But** the public share endpoint uses the service role to bypass RLS regardless; it independently checks `is_active` and `expires_at`.

---

## Flexi-Design

A separate billing model. A "Flexi" client has a hours bank; hours are deducted as Flexi projects consume them.

### `public.flexi_design_clients`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_name` | `text` unique not null | |
| `remaining_hours` | `numeric(10,2)` not null default `0` | Kept for backwards compatibility; current logic computes balance from `flexi_design_credit_transactions` minus quoted hours. |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

RLS: Auth read; Admin all.

### `public.flexi_design_credit_transactions`
A transaction that adds hours to a Flexi client's bank.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_id` | `uuid` not null | FK → `flexi_design_clients.id` (`cascade`). |
| `hours` | `numeric(10,2)` not null | Positive to add credit. |
| `transaction_date` | `date` not null default `current_date` | |
| `created_at` | `timestamptz` | |
| `created_by` | `uuid` | FK → `users.id` (`set null`). |

RLS: Auth read; Admin all.

### `public.flexi_design_share_links`
Like `retainer_share_links` but for the Flexi-Design client report.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `flexi_design_client_id` | `uuid` not null | FK → `flexi_design_clients.id` (`cascade`). |
| `share_token` | `text` unique not null | |
| `created_by` | `uuid` | FK → `users.id` (`set null`). |
| `expires_at` | `timestamptz` | |
| `is_active` | `boolean` not null default `true` | |
| `created_at` | `timestamptz` | |

RLS: Auth read (for listing); Admin all. Public read happens via service role in server actions.

---

## Cupboard (documents)

The Cupboard is a generic content library. Each item has metadata, optional file attachments, optional links, and an optional cover image. Files are stored in the `cupboard` Supabase Storage bucket.

### `public.cupboard_categories`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `name` | `text` unique not null | Defaults inserted: `HR`, `Sales`, `Operations`. |
| `display_order` | `integer` not null default `0` | |
| `created_at` | `timestamptz` | |

Index: `idx_cupboard_categories_display_order`. RLS: Auth read; Admin+manager all.

### `public.cupboard_items`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `title` | `text` not null | |
| `description` | `text` | |
| `category_id` | `uuid` | FK → `cupboard_categories.id` (`set null`). |
| `cover_image_path` | `text` | Path inside the `cupboard` bucket. |
| `created_by` | `uuid` | FK → `users.id` (`set null`). |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Indexes: `idx_cupboard_items_category_id`, `idx_cupboard_items_created_at`, partial `idx_cupboard_items_cover_image_path where cover_image_path is not null`, GIN full-text `idx_cupboard_items_search on to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))`.

RLS: Auth read; Admin+manager all.

### `public.cupboard_files`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `item_id` | `uuid` not null | FK → `cupboard_items.id` (`cascade`). |
| `file_path` | `text` not null | Path in `cupboard` storage bucket. |
| `file_name` | `text` not null | Original filename. |
| `file_size` | `bigint` | Bytes. |
| `file_type` | `text` | MIME type. |
| `thumbnail_path` | `text` | |
| `display_order` | `integer` not null default `0` | |
| `created_at` | `timestamptz` | |

Index: `idx_cupboard_files_item_id`. RLS: read by anyone who can read the parent item; Admin+manager all.

### `public.cupboard_links`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `item_id` | `uuid` not null | FK → `cupboard_items.id` (`cascade`). |
| `url` | `text` not null | |
| `label` | `text` | |
| `display_order` | `integer` not null default `0` | |
| `created_at` | `timestamptz` | |

Index: `idx_cupboard_links_item_id`. RLS: same as `cupboard_files`.

### Storage bucket policies (`storage.objects` for `bucket_id = 'cupboard'`)
- Authenticated users can `SELECT` (read/download).
- Admins + managers can `INSERT/UPDATE/DELETE`.

---

## Scorecards

> **Status:** the Scorecard UI, server actions, and Sunday cron job were removed from the platform. The tables, RLS policies, and seeded categories/metrics below all remain intact in the database so they can be queried or re-attached to a UI later. Nothing in the running app currently reads or writes these tables.

A weekly KPI dashboard with categorised metrics. Some metrics are filled by humans, others are derived from external sources (Monday leads board, Xero, time tracking, capacity).

### `public.scorecard_categories`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `name` | `text` unique not null | Seeded: `Marketing`, `Sales`, `Operations`, `Finance`. |
| `display_order` | `integer` not null | |
| `created_at` | `timestamptz` | |

RLS: Auth read; Admin all.

### `public.scorecard_metrics`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `category_id` | `uuid` not null | FK → `scorecard_categories.id` (`cascade`). |
| `name` | `text` not null | Unique within a category. |
| `description` | `text` | |
| `unit` | `text` | E.g. `visitors`, `hours`, `£`, `%`. |
| `target_value` | `numeric(12,2)` | Default target for the metric. |
| `is_automated` | `boolean` not null default `false` | |
| `automation_source` | `text` | One of (current usage): `time_tracking`, `leads`, `xero`, `linkedin`, `capacity`. |
| `automation_config` | `jsonb` | Source-specific config (e.g. `{ type, boardId, statusColumnId, quotedStatus, ... }`). |
| `display_order` | `integer` not null | |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Indexes: `idx_scorecard_metrics_category_id`, `idx_scorecard_metrics_is_automated`. RLS: Auth read; Admin all.

### `public.scorecard_entries`
A weekly value for a metric.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `metric_id` | `uuid` not null | FK → `scorecard_metrics.id` (`cascade`). |
| `week_start_date` | `date` not null | ISO week Monday. |
| `value` | `numeric(12,2)` not null | |
| `target_value` | `numeric(12,2)` | Week-specific override. |
| `notes` | `text` | |
| `created_by` | `uuid` | FK → `users.id` (`set null`). |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Unique `(metric_id, week_start_date)`. Indexes: `idx_scorecard_entries_metric_id`, `idx_scorecard_entries_week_start`.
RLS: Auth read; Auth all (any authenticated user can submit weekly entries).

---

## Customer relationship scores

### `public.customer_relationship_votes`
Per-user vote on the strength of a client relationship.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_name` | `text` not null | |
| `user_id` | `uuid` not null | FK → `users.id` (`cascade`). |
| `relationship_score` | `integer` not null | `check (0..10)`. |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Unique `(client_name, user_id)`. Indexes: `idx_customer_relationship_votes_client_name`, `idx_customer_relationship_votes_user_id`.
RLS: Auth read; a user can manage only their own row.

### `public.lifetime_value_brackets`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `bracket_name` | `text` unique not null | `check in ('low','medium','high')`. |
| `min_value` | `numeric(10,2)` not null | |
| `max_value` | `numeric(10,2)` | `NULL` means unlimited (used for `high`). |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Seeded: `low (1.00..4999.99)`, `medium (5000.00..9999.99)`, `high (10000.00..NULL)`.
RLS: Auth read; Admin all.

### `public.customer_relationship_scores` (legacy)
Original single-score-per-client table; kept for backwards compatibility after migration 028 introduced per-user voting. New code reads from `customer_relationship_votes`. RLS: Auth read; Admin all.

---

## Quoting & rates

### `public.quote_rates`
Hour/day rates per customer tier. One row per `customer_type`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `customer_type` | `text` unique not null | `check in ('partner','client')`. |
| `day_rate_gbp` | `numeric(10,2)` not null | `check (> 0)`. |
| `hours_per_day` | `numeric(4,2)` not null default `6.0` | `check (> 0)`. |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Seeded: `partner` £670/day, `client` £720/day. RLS: Auth read; Admin all.

---

## Xero integration

### `public.xero_connection`
OAuth tokens for the connected Xero tenant.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `tenant_id` | `text` unique not null | Xero tenant ID. |
| `tenant_name` | `text` not null | |
| `access_token`, `refresh_token` | `text` not null | Treat as secrets. |
| `token_expires_at` | `timestamptz` not null | |
| `connected_by` | `uuid` | FK → `users.id` (`cascade`). |
| `connected_at`, `updated_at` | `timestamptz` | Trigger maintained. |

Indexes: `idx_xero_connection_tenant_id`, `idx_xero_connection_connected_by`.
RLS: Auth read (for status display); Admin all (with both `USING` and `WITH CHECK`).

### `public.xero_financial_cache`
Cached aggregates per period from Xero.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `tenant_id` | `text` not null | |
| `period_start`, `period_end` | `date` not null | |
| `revenue`, `expenses`, `profit` | `numeric(18,2)` default `0` | |
| `data` | `jsonb` | Raw payload. |
| `cached_at` | `timestamptz` not null default `now()` | |

Unique `(tenant_id, period_start, period_end)`.
Indexes: `idx_xero_financial_cache_tenant_period`, `idx_xero_financial_cache_period`.
RLS: Auth read; Admin all.

---

## Share links (time report, etc.)

### `public.time_report_share_links`
Public live-view of time entries for a specific client.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_name` | `text` not null | |
| `share_token` | `text` unique not null | |
| `created_by` | `uuid` | FK → `users.id` (`set null`). |
| `expires_at` | `timestamptz` | Optional. |
| `is_active` | `boolean` not null default `true` | |
| `created_at` | `timestamptz` | |

Indexes: `idx_time_report_share_links_token`, `idx_time_report_share_links_client`.
RLS: Admin + manager can manage. **There is no anon `SELECT` policy** — public access happens via service-role server actions that validate the token, `is_active`, and `expires_at` themselves.

---

## Legacy tables

These still exist in the database but the active app reads from newer tables.

### `public.documents`
Pre-Cupboard documents table (migration 022). Migration 031 migrated rows into `cupboard_items` + `cupboard_files` but left the drop statement commented out, so the table remains as-is. Don't write to it.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `title` | `text` not null | |
| `description` | `text` | |
| `category` | `document_category` not null | `'hr' \| 'sales' \| 'operations'`. |
| `file_path` | `text` not null | Storage path. |
| `file_name` | `text` not null | |
| `file_size` | `bigint` | |
| `thumbnail_path` | `text` | |
| `created_by` | `uuid` | FK → `users.id` (`set null`). |
| `created_at`, `updated_at` | `timestamptz` | Trigger maintained. |

RLS: Auth read; Admin all.

### `public.customer_relationship_scores`
See above under "Customer relationship scores". Read-compatible but new code writes to `customer_relationship_votes`.

---

## Monday.com sync — what is synced and how

The full implementation lives in `lib/monday/api.ts` (`getMondayProjects`, `getMondayTasks`, `syncMondayData`) and `app/actions/monday.ts`.

### What flows from Monday into Supabase

- A **board** is in scope when:
  - it has at least one row in `monday_column_mappings.board_id` referencing it, OR
  - it's listed in `monday_completed_boards`, `monday_leads_board`, `flexi_design_completed_board`, or `flexi_design_boards`.
- For each in-scope **active board** the sync paginates `items_page` (page size 500, cursor valid ~60 min) and produces one row per item in `monday_projects`.
- For each in-scope **completed board** (archive boards, Flexi completed board) the sync only fetches items by ID — usually items the DB already knows about. This avoids re-scanning huge archives but means completed boards rely on already-known IDs.
- For each project, `subitems` are pulled via a separate query and written to `monday_tasks` (`is_subtask = true`).

### How column values become typed columns on `monday_projects` / `monday_tasks`

The Studio settings page lets an admin map a Monday column to one of these **column types** (per board, optionally with a global fallback). During sync the matching column is looked up by `(column_type, board_id)` and its value is pulled out:

| `column_type` | Used on | Destination | Extraction notes |
| --- | --- | --- | --- |
| `client` | parent items | `monday_projects.client_name` | Uses `column_values[].text`. |
| `agency` | parent items | `monday_projects.agency` | Uses `column_values[].text`. |
| `quote_value` | parent items | `monday_projects.quote_value` | Parses `value` as JSON; falls back to a numeric parse of `text` (strips `£`, `$`, `,`, spaces). For **completed boards** this column **must** be mapped per-board (the sync refuses to fall back to a global mapping for `quote_value`). |
| `due_date` | parent items | `monday_projects.due_date` | Parses `value.date` (Monday date column shape) or `text` as ISO date. |
| `completed_date` | parent items | `monday_projects.completed_date` | Same as `due_date`; legacy fallback to column ID `date__1` if no mapping. |
| `status` | parent items | not materialised today | Used by the leads/scorecard automations to read status from the leads board. |
| `quoted_hours` | subitems | `monday_tasks.quoted_hours` | Number column. |
| `timeline` | subitems | `monday_tasks.timeline_start`, `monday_tasks.timeline_end` | Reads `value.from`/`value.to` (Monday timeline column shape). |
| `time` | (reserved) | n/a | Historical; not actively consumed by the current sync. |

Notes:
- For **Flexi-Design boards**, if a board lacks its own mapping the sync inherits the mapping from any other Flexi board that has one (matched by board name containing `flexi`).
- `assigned_user_ids` on a task come from the first `people`-type column found on the subitem and store **Monday user IDs**, not Supabase user IDs.
- `monday_tasks.quoted_hours` is summed up per project and written back to `monday_projects.quoted_hours` (with locked-project preservation; see below).

### `monday_data` shape
`monday_projects.monday_data` and `monday_tasks.monday_data` always hold the raw column dump for that item:

```jsonc
{
  "<monday_column_id>": {
    "text": "...",            // Monday's display text
    "value": <object|null>,   // Parsed JSON of the Monday value field (already JSON.parse'd; e.g. timeline -> { from, to })
    "type": "..."             // Monday column type (e.g. "text", "numbers", "status", "people", "date")
  },
  // Project-only convenience fields when the item belongs to a Monday group:
  "_group_id": "topics",
  "_group_title": "Active Leads",
  "__monday_group": { "id": "topics", "title": "Active Leads" }
}
```

Anything not promoted to a typed column is still recoverable from here (status colour/label, files, person columns beyond the first, custom Monday columns, etc.).

### Project status mapping during sync

For each project, the sync looks up:
- `boardId` in `monday_column_mappings.board_id` → "active" board.
- `boardId` in `monday_completed_boards` or `flexi_design_completed_board` → "completed" board.
- `boardId === monday_leads_board.monday_board_id` → "leads" board.

The status is then:

| Situation | Resulting `status` |
| --- | --- |
| On the leads board | `lead` |
| On an active mapped board | `active` |
| On any completed board | `locked` |
| In DB but no longer found on any board, and project has time entries | `archived` (only when `monday_sync_settings.avoid_deletion = false`) |
| In DB but no longer found anywhere and has no time entries | row is deleted (only when `avoid_deletion = false`) |
| Was previously `locked` | stays `locked` (never demoted) |

`avoid_deletion` defaults to `true`, so by default no rows are archived/deleted automatically.

### Locked-project preservation
For projects on completed/locked boards, the sync **preserves** these historical fields when Monday wouldn't return them:
- `quoted_hours` on both the project and its tasks (existing value retained if Monday no longer provides one).
- `quote_value` on the project (existing value retained, and as a last resort re-extracted from existing `monday_data`).
- `status = 'locked'` (never moves back to `active`/`lead`).

### Orphaned task cleanup
After syncing tasks for a project, any task in the DB that wasn't in the latest Monday response is deleted **only** if it has zero `time_entries`. Tasks with time entries are preserved to keep historical reporting intact (FK is `on delete restrict`).

---

## Access patterns for an external tool

These are the practical patterns you'll likely want when building a separate consumer.

### Authentication
- **Service role key** — full read/write, bypasses RLS. Use from a trusted server only. Required for:
  - reading every user's `time_entries` (the in-app reporting uses the admin client for this; the auth-read RLS works too as long as you have any authenticated session, but service role is simpler if you don't).
  - any sync-like background job.
  - reading data via share tokens (the share-link RLS doesn't expose data without an authenticated session; the app validates tokens in code and queries with service role).
- **Authenticated user JWT** — RLS applies. Lets you read essentially everything plus mutate the rows the policies allow.

### Common joins
- Projects ↔ tasks ↔ time entries:
  ```sql
  select p.id, p.name, p.client_name, t.name as task_name,
         te.date, te.hours, te.user_id, te.notes
  from public.monday_projects p
  join public.monday_tasks t  on t.project_id = p.id
  join public.time_entries te on te.task_id   = t.id
  where p.status <> 'archived'
    and te.date >= current_date - interval '90 days'
  order by te.date desc;
  ```
- Retainer-eligible projects for a client (mirrors `getRetainerData`):
  ```sql
  select p.*
  from public.monday_projects p
  join public.retainer_clients rc on rc.client_name = p.client_name
  where rc.client_name = $1
    and (rc.start_date is null or rc.start_date <= current_date)
    and (rc.end_date   is null or rc.end_date   >= current_date);
  ```
- Active vs Flexi boards (matches what the app calls "Main timesheet"):
  - Boards in `monday_column_mappings.board_id` minus boards in `flexi_design_boards`, `monday_completed_boards`, `flexi_design_completed_board`, and `monday_leads_board.monday_board_id`.

### Things to know / gotchas
- **`monday_item_id` is the join key with Monday.com**, not `id`. `id` is a Supabase UUID.
- **`assigned_user_ids`** on `monday_tasks` are **Monday user IDs** as strings. There is no automatic mapping to `public.users.id`. If you need to map, do it yourself by storing Monday user IDs on the user profile (currently not stored anywhere).
- **`time_entries.date` is a `date`** (no timezone). All retainer/reporting code compares it as a plain `YYYY-MM-DD` string.
- **Project status `'lead'` is real** — leads flow through the same `monday_projects` table. Filter on `status` if you want only billable work.
- **`monday_projects.quoted_hours` is denormalised** from the child tasks' `quoted_hours`, not from Monday itself. For locked projects it's preserved on purpose, so older historical projects can show a sum that no longer matches the current Monday data.
- **`avoid_deletion`** in `monday_sync_settings` is on by default, so syncing won't prune. If your tool expects "this project no longer exists in Monday → it should be gone here", you'll either have to detect this yourself (e.g. by `updated_at` going stale) or wait for an admin to disable safe mode.
- **`monday_data`** is JSONB and contains every column value with the raw type. It's the safety net for fields not yet promoted to typed columns.
- **Share-link tables** (`retainer_share_links`, `flexi_design_share_links`, `time_report_share_links`) are not intended for direct anon reads — the app reads them with the service role and enforces `is_active` and `expires_at` in application code.
- **`public.users.deleted_at`** is soft delete. Most RLS predicates filter it, and any reporting query should `where deleted_at is null` unless explicitly looking at history.

---

## Migration log (numerical order)

For posterity. The file names in `supabase/migrations/` always map 1:1 to the change described here.

| # | Title | Highlights |
| --- | --- | --- |
| 001 | `initial_schema` | `users`, `monday_projects`, `monday_tasks`, `time_entries`, `favorite_tasks`, `monday_column_mappings`, enums. |
| 002 | `add_workspace_id_to_mappings` | `monday_column_mappings.workspace_id` + composite unique. |
| 003 | `add_completed_boards` | `monday_completed_boards`. |
| 004 | `add_flexi_design_clients` | `flexi_design_clients`. |
| 005 | `add_leads_board` | `monday_leads_board`. |
| 006 | `add_lead_status` | `'lead'` value on `project_status`. |
| 007 | `add_xero_integration` | `xero_connection`, `xero_financial_cache`. |
| 008 | `fix_xero_rls_policy` | Adds `WITH CHECK` to Xero policies. |
| 009 | `add_user_insert_policy` | Admin can `INSERT` users. |
| 011 | `rename_employee_to_manager` | Adds `'manager'` enum value, migrates rows, changes default. |
| 012 | `add_completed_date_to_projects` | `monday_projects.completed_date`. |
| 013 | `add_flexi_design_credit_transactions` | `flexi_design_credit_transactions`. |
| 014 | `add_flexi_design_completed_board` | `flexi_design_completed_board`. |
| 015 | `add_monday_sync_settings` | `monday_sync_settings`. |
| 016 | `add_quote_rates` | `quote_rates`. |
| 017 | `add_exclude_from_utilization` | `users.exclude_from_utilization`. |
| 018 | `add_quote_value_column_type` | `'quote_value'` column type. |
| 019 | `add_quote_value_to_projects` | `monday_projects.quote_value`. |
| 020 | `add_date_column_mappings` | `'due_date'`, `'completed_date'` types; `monday_projects.due_date`. |
| 021 | `add_status_column_and_config` | `'status'` type; `leads_status_config`. |
| 022 | `add_documents` | legacy `documents` table. |
| 023 | `add_document_thumbnails` | `documents.thumbnail_path`. |
| 024 | `add_operations_document_category` | `'operations'` enum value. |
| 025 | `add_user_soft_delete` | `users.deleted_at`. |
| 026 | `add_customer_relationship_scores` | `customer_relationship_scores`, `lifetime_value_brackets`. |
| 027 | `add_agency_to_projects` | `monday_projects.agency`; `'agency'` column type. |
| 028 | `add_user_votes_to_relationship_scores` | `customer_relationship_votes`. |
| 029 | `add_scorecard_tables` | `scorecard_categories`, `scorecard_metrics`, `scorecard_entries`. |
| 030 | `allow_read_column_mappings` | Auth read on `monday_column_mappings`. |
| 031 | `transform_documents_to_cupboard` | `cupboard_categories`, `cupboard_items`, `cupboard_files`, `cupboard_links`. |
| 032 | `add_cupboard_storage_policies` | Storage bucket policies for `cupboard`. |
| 033 | `add_retainers` | `retainer_clients`, `retainer_share_links`. |
| 034 | `add_retainer_hours_and_start_date` | `monthly_hours`, `rollover_hours`, `start_date`. |
| 036 | `add_flexi_design_share_links` | `flexi_design_share_links`. |
| 037 | `add_retainer_agreed_days` | `agreed_days_per_week`, `agreed_days_per_month`. |
| 038 | `add_retainer_hours_per_day` | `retainer_clients.hours_per_day`. |
| 039 | `ensure_manager_role_enum` | Idempotent enum addition. |
| 040 | `set_default_manager_role` | Default role is `'manager'`. |
| 041 | `add_avoid_deletion_sync_setting` | `monday_sync_settings.avoid_deletion`. |
| 042 | `add_time_report_share_links` | `time_report_share_links`. |
| 043 | `cupboard_managers_can_manage` | Cupboard tables + storage bucket allow `manager`. |
| 044 | `update_sales_scorecard_metric_automation` | Sales metrics use leads board. |
| 045 | `restrict_sales_scorecard_to_active_leads_group` | Filter scorecard by Monday group title. |
| 046 | `set_active_leads_group_id_for_scorecard` | Pin group ID `new_group7337__1`. |
| 047 | `add_flexi_design_boards` | `flexi_design_boards`. |
| 048 | `allow_auth_read_monday_completed_boards` | Auth read on completed boards. |
| 049 | `add_retainer_end_date` | `retainer_clients.end_date` (finish date, prorates final month). |
| `20260113085747` | `add_cover_image_to_cupboard` | `cupboard_items.cover_image_path`. |
