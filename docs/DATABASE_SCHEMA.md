# Salo Studio – Database Schema

This document describes the complete Postgres (Supabase) schema used by Salo Studio. It is intended as a reference for external platforms that need to read from or integrate with this database.

- **Database:** PostgreSQL 15+ (Supabase-hosted)
- **Schemas:** All application tables live in `public`. Auth tables live in `auth` (managed by Supabase). Cupboard files use `storage.objects` (Supabase Storage).
- **Conventions:**
  - All primary keys are `uuid` (defaulted with `uuid_generate_v4()`), except `users.id` which mirrors `auth.users.id`.
  - All tables include `created_at timestamptz` and most include `updated_at timestamptz` (auto-updated by the `update_updated_at_column()` trigger).
  - RLS (Row Level Security) is enabled on every table. The `service_role` key bypasses RLS — external platforms typically read data via the service role on the server.
  - Money values are `numeric(10,2)` GBP unless noted.

---

## 1. Enums

| Enum | Values | Notes |
| --- | --- | --- |
| `user_role` | `admin`, `designer`, `employee`, `manager` | `employee` is legacy; new users default to `manager`. |
| `project_status` | `active`, `archived`, `locked`, `lead` | `lead` is used for items synced from the Leads board. |
| `document_category` | `hr`, `sales`, `operations` | Legacy enum — superseded by `cupboard_categories` table. |

---

## 2. Authentication & Users

### `users`
Extends `auth.users`. The `id` is identical to `auth.users.id`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | FK → `auth.users.id` (cascade delete) |
| `email` | `text` unique, not null | |
| `full_name` | `text` | |
| `role` | `user_role` not null | Defaults to `manager` |
| `exclude_from_utilization` | `boolean` not null default `false` | Hide user from team utilization/perf calcs |
| `deleted_at` | `timestamptz` | Soft delete; treat non-null as removed |
| `created_at` | `timestamptz` not null | |
| `updated_at` | `timestamptz` not null | |

**RLS:**
- Users can `SELECT`/`UPDATE` their own row.
- Admins can `INSERT` new users.

---

## 3. Monday.com Integration

### `monday_projects`
One row per project (top-level Monday item) synced from Monday.com.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `monday_item_id` | `text` unique, not null | Monday.com item ID |
| `monday_board_id` | `text` not null | Monday.com board ID |
| `name` | `text` not null | |
| `client_name` | `text` | Parsed from a mapped Monday column |
| `agency` | `text` | Optional agency name (parent column) |
| `completed_date` | `date` | From mapped `completed_date` column |
| `due_date` | `date` | From mapped `due_date` column |
| `status` | `project_status` not null default `active` | |
| `quoted_hours` | `numeric(10,2)` | |
| `quote_value` | `numeric(10,2)` | GBP quote subtotal |
| `monday_data` | `jsonb` | Raw Monday item payload |
| `created_at` / `updated_at` | `timestamptz` | |

**Indexes:** `monday_board_id`, `status`, `completed_date desc`, `due_date desc`, `quote_value desc`, `agency`.

### `monday_tasks`
One row per task / subtask synced from Monday.com.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `monday_item_id` | `text` unique, not null | |
| `project_id` | `uuid` not null | FK → `monday_projects.id` (cascade) |
| `name` | `text` not null | |
| `is_subtask` | `boolean` not null default `false` | |
| `parent_task_id` | `uuid` | FK → `monday_tasks.id` (set null) |
| `assigned_user_ids` | `text[]` | Monday user IDs (not Salo user UUIDs) |
| `quoted_hours` | `numeric(10,2)` | |
| `timeline_start` | `timestamptz` | |
| `timeline_end` | `timestamptz` | |
| `monday_data` | `jsonb` | |
| `created_at` / `updated_at` | `timestamptz` | |

**Indexes:** `project_id`, GIN on `assigned_user_ids`.

### `monday_column_mappings`
Maps Monday.com columns to logical roles (which column holds the client name, the timeline, etc).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `monday_column_id` | `text` not null | |
| `column_type` | `text` not null | One of: `client`, `agency`, `time`, `quoted_hours`, `timeline`, `quote_value`, `due_date`, `completed_date`, `status` |
| `board_id` | `text` | Per-board override |
| `workspace_id` | `text` | Per-workspace override |
| `created_at` / `updated_at` | `timestamptz` | |

**Constraints:** Unique on `(column_type, coalesce(board_id, ''), coalesce(workspace_id, ''))`.

### `monday_completed_boards`
Boards that hold archived/completed projects.

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `monday_board_id` | `text` unique, not null |
| `board_name` | `text` |
| `created_at` / `updated_at` | `timestamptz` |

### `monday_leads_board`
Configuration for a single "Leads" board (only one row in practice).

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `monday_board_id` | `text` unique |
| `board_name` | `text` |
| `created_at` / `updated_at` | `timestamptz` |

### `leads_status_config`
Single-row config (enforced via unique index on `((1))`) for which lead statuses to include in monthly summaries.

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `included_statuses` | `text[]` |
| `excluded_statuses` | `text[]` |
| `created_at` / `updated_at` | `timestamptz` |

### `monday_sync_settings`
Single-row table (id always `00000000-0000-0000-0000-000000000000`) holding sync schedule.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Fixed UUID |
| `enabled` | `boolean` not null default `false` | |
| `interval_minutes` | `int` not null default `60` (>0) | |
| `avoid_deletion` | `boolean` not null default `true` | If true, sync never archives/deletes |
| `last_sync_at` | `timestamptz` | |
| `next_sync_at` | `timestamptz` | |
| `created_at` / `updated_at` | `timestamptz` | |

---

## 4. Time Tracking

### `time_entries`
A user's hours logged against a Monday task on a date.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` not null | FK → `users.id` (cascade) |
| `task_id` | `uuid` not null | FK → `monday_tasks.id` (restrict) |
| `project_id` | `uuid` not null | FK → `monday_projects.id` (restrict) |
| `date` | `date` not null | |
| `hours` | `numeric(4,2)` not null, `> 0` | |
| `notes` | `text` | |
| `created_at` / `updated_at` | `timestamptz` | |

**Constraints:** Unique `(user_id, task_id, date)`.
**RLS:** All authenticated users can read all entries. Users can only insert/update/delete their own entries; insert blocked on `locked` projects.

### `favorite_tasks`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` not null | FK → `users.id` (cascade) |
| `task_id` | `uuid` not null | FK → `monday_tasks.id` (cascade) |
| `created_at` | `timestamptz` | |

**Constraints:** Unique `(user_id, task_id)`.

### `time_report_share_links`
Public share links for live time-report views (used by clients).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_name` | `text` not null | |
| `share_token` | `text` unique, not null | URL token |
| `created_by` | `uuid` | FK → `users.id` (set null) |
| `expires_at` | `timestamptz` | Optional |
| `is_active` | `boolean` not null default `true` | |
| `created_at` | `timestamptz` | |

Public reads are done via service-role server actions; no anon RLS.

---

## 5. Quoting & Rates

### `quote_rates`
One row per customer type.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `customer_type` | `text` unique not null | `partner` or `client` |
| `day_rate_gbp` | `numeric(10,2)` not null (>0) | |
| `hours_per_day` | `numeric(4,2)` not null default `6.0` | |
| `created_at` / `updated_at` | `timestamptz` | |

Default seed: `partner = £670/day`, `client = £720/day`.

---

## 6. Customer Relationship Scoring

### `customer_relationship_scores` (legacy, single score per client)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_name` | `text` unique not null | |
| `relationship_score` | `int` not null, `0..10` | |
| `created_at` / `updated_at` | `timestamptz` | |

### `customer_relationship_votes` (current, per-user voting)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_name` | `text` not null | |
| `user_id` | `uuid` not null | FK → `users.id` (cascade) |
| `relationship_score` | `int` not null, `0..10` | |
| `created_at` / `updated_at` | `timestamptz` | |

**Constraints:** Unique `(client_name, user_id)`.

### `lifetime_value_brackets`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `bracket_name` | `text` unique, `low` / `medium` / `high` | |
| `min_value` | `numeric(10,2)` not null | |
| `max_value` | `numeric(10,2)` | NULL means unlimited (used for `high`) |
| `created_at` / `updated_at` | `timestamptz` | |

Default seeds: `low = 1.00..4999.99`, `medium = 5000.00..9999.99`, `high = 10000.00+`.

---

## 7. Flexi-Design

### `flexi_design_clients`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_name` | `text` unique, not null | |
| `remaining_hours` | `numeric(10,2)` not null default `0` | Computed = sum of credit transactions − sum of project quoted hours |
| `created_at` / `updated_at` | `timestamptz` | |

### `flexi_design_credit_transactions`
Audit log of credit deposits.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_id` | `uuid` not null | FK → `flexi_design_clients.id` (cascade) |
| `hours` | `numeric(10,2)` not null | Positive = deposit |
| `transaction_date` | `date` not null default current_date | |
| `created_by` | `uuid` | FK → `users.id` (set null) |
| `created_at` | `timestamptz` | |

### `flexi_design_completed_board`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `monday_board_id` | `text` unique, not null |
| `board_name` | `text` |
| `created_at` / `updated_at` | `timestamptz` |

### `flexi_design_share_links`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `flexi_design_client_id` | `uuid` not null | FK → `flexi_design_clients.id` (cascade) |
| `share_token` | `text` unique, not null | |
| `created_by` | `uuid` | FK → `users.id` (set null) |
| `expires_at` | `timestamptz` | Optional |
| `is_active` | `boolean` not null default `true` | |
| `created_at` | `timestamptz` | |

---

## 8. Retainers

### `retainer_clients`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `client_name` | `text` unique, not null | |
| `display_order` | `int` not null default `0` | |
| `monthly_hours` | `numeric(10,2)` | Allocated hours/month |
| `rollover_hours` | `numeric(10,2)` | Banked hours from previous periods |
| `start_date` | `date` | |
| `agreed_days_per_week` | `numeric(5,2)` | Used to calc daily allocation |
| `agreed_days_per_month` | `numeric(5,2)` | Takes precedence over per-week if set |
| `hours_per_day` | `numeric(4,2)` default `6.0` | Used for hours→days conversion |
| `created_at` / `updated_at` | `timestamptz` | |

### `retainer_share_links`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `retainer_client_id` | `uuid` not null | FK → `retainer_clients.id` (cascade) |
| `share_token` | `text` unique, not null | |
| `created_by` | `uuid` | FK → `users.id` (set null) |
| `expires_at` | `timestamptz` | |
| `is_active` | `boolean` not null default `true` | |
| `created_at` | `timestamptz` | |

**RLS:** Anon reads allowed when `is_active = true AND (expires_at IS NULL OR expires_at > now())`.

---

## 9. Scorecard

### `scorecard_categories`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `name` | `text` unique, not null | `Marketing`, `Sales`, `Operations`, `Finance` |
| `display_order` | `int` not null | |
| `created_at` | `timestamptz` | |

### `scorecard_metrics`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `category_id` | `uuid` not null | FK → `scorecard_categories.id` (cascade) |
| `name` | `text` not null | Unique within category |
| `description` | `text` | |
| `unit` | `text` | e.g. `hours`, `£`, `%` |
| `target_value` | `numeric(12,2)` | |
| `is_automated` | `boolean` not null default `false` | |
| `automation_source` | `text` | `time_tracking`, `leads`, `xero`, `linkedin`, `capacity` |
| `automation_config` | `jsonb` | Source-specific config (board IDs, column IDs, group IDs) |
| `display_order` | `int` not null | |
| `created_at` / `updated_at` | `timestamptz` | |

**Sales metric automation_config typically includes:**
- `boardId`, `statusColumnId`, `valueColumnId`, `likelihoodColumnId`
- `quotedStatus`, `activeGroupId`, `activeGroupTitle`

### `scorecard_entries`
Weekly values per metric.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `metric_id` | `uuid` not null | FK → `scorecard_metrics.id` (cascade) |
| `week_start_date` | `date` not null | ISO week start (Monday) |
| `value` | `numeric(12,2)` not null | |
| `target_value` | `numeric(12,2)` | Optional weekly override |
| `notes` | `text` | |
| `created_by` | `uuid` | FK → `users.id` (set null) |
| `created_at` / `updated_at` | `timestamptz` | |

**Constraints:** Unique `(metric_id, week_start_date)`.

---

## 10. Cupboard (Shared Resources)

Replaces the legacy `documents` table. Items can have multiple files and links and live under one of several categories.

### `cupboard_categories`

| Column | Type |
| --- | --- |
| `id` | `uuid` PK |
| `name` | `text` unique, not null |
| `display_order` | `int` not null default `0` |
| `created_at` | `timestamptz` |

Default seeds: `HR`, `Sales`, `Operations`.

### `cupboard_items`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `title` | `text` not null | |
| `description` | `text` | |
| `category_id` | `uuid` | FK → `cupboard_categories.id` (set null) |
| `cover_image_path` | `text` | Path in storage bucket |
| `created_by` | `uuid` | FK → `users.id` (set null) |
| `created_at` / `updated_at` | `timestamptz` | |

**Indexes:** GIN full-text index on `title || description`.

### `cupboard_files`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `item_id` | `uuid` not null | FK → `cupboard_items.id` (cascade) |
| `file_path` | `text` not null | Path in `cupboard` storage bucket |
| `file_name` | `text` not null | |
| `file_size` | `bigint` | Bytes |
| `file_type` | `text` | MIME type |
| `thumbnail_path` | `text` | |
| `display_order` | `int` not null default `0` | |
| `created_at` | `timestamptz` | |

### `cupboard_links`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `item_id` | `uuid` not null | FK → `cupboard_items.id` (cascade) |
| `url` | `text` not null | |
| `label` | `text` | Optional display label |
| `display_order` | `int` not null default `0` | |
| `created_at` | `timestamptz` | |

**Storage:** Files live in the `cupboard` Supabase Storage bucket. Authenticated users can read; admins and managers can write.

### `documents` (LEGACY)
Deprecated — kept temporarily for migration safety. Use the `cupboard_*` tables instead.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Same IDs migrated into `cupboard_items.id` |
| `title` / `description` | `text` | |
| `category` | `document_category` | `hr`, `sales`, `operations` |
| `file_path` / `file_name` / `file_size` | | |
| `thumbnail_path` | `text` | |
| `created_by` | `uuid` → `users.id` | |
| `created_at` / `updated_at` | `timestamptz` | |

---

## 11. Xero Integration

### `xero_connection`
Holds the active OAuth connection (one row per tenant).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `tenant_id` | `text` unique, not null | Xero tenant ID |
| `tenant_name` | `text` not null | |
| `access_token` | `text` not null | **Sensitive** |
| `refresh_token` | `text` not null | **Sensitive** |
| `token_expires_at` | `timestamptz` not null | |
| `connected_by` | `uuid` | FK → `users.id` (cascade) |
| `connected_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

> External platforms should NOT read these tokens unless they are responsible for managing the Xero connection. Treat as secrets.

### `xero_financial_cache`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `tenant_id` | `text` not null | |
| `period_start` | `date` not null | |
| `period_end` | `date` not null | |
| `revenue` | `numeric(18,2)` default 0 | |
| `expenses` | `numeric(18,2)` default 0 | |
| `profit` | `numeric(18,2)` default 0 | |
| `data` | `jsonb` | Full P&L payload from Xero |
| `cached_at` | `timestamptz` | |

**Constraints:** Unique `(tenant_id, period_start, period_end)`.

---

## 12. Relationships (high level)

```
auth.users 1───1 users
                │
                ├──< time_entries >── monday_tasks ──< monday_projects
                ├──< favorite_tasks >─ monday_tasks
                ├──< customer_relationship_votes
                ├──< scorecard_entries >── scorecard_metrics ── scorecard_categories
                ├──< cupboard_items >── cupboard_categories
                │                       │
                │                       ├──< cupboard_files
                │                       └──< cupboard_links
                ├──< retainer_share_links >── retainer_clients
                ├──< flexi_design_share_links >── flexi_design_clients ──< flexi_design_credit_transactions
                ├──< flexi_design_credit_transactions
                └──< time_report_share_links

monday_tasks (parent_task_id self-ref)
monday_column_mappings (config table, no FKs)
monday_completed_boards / monday_leads_board / flexi_design_completed_board (config)
monday_sync_settings / leads_status_config / quote_rates / lifetime_value_brackets (singleton config)
xero_connection >── xero_financial_cache (by tenant_id, no FK)
```

---

## 13. Recommended access patterns for an external platform

1. **Read-only consumption:** Use a Supabase **service-role key** server-side (bypasses RLS). Never ship the service-role key to a browser.
2. **Per-user scoped reads:** Use the Supabase **anon key** with a signed-in JWT — RLS will enforce role-based filtering.
3. **Useful joins:**
   - Hours by client: join `time_entries → monday_projects` on `project_id` and group by `client_name`.
   - Hours by user/week: aggregate `time_entries.hours` grouped by `user_id, date_trunc('week', date)`.
   - Active retainer usage: filter `monday_projects` by `client_name IN (SELECT client_name FROM retainer_clients)`.
   - Scorecard view: `scorecard_categories → scorecard_metrics → scorecard_entries` (week_start_date).
4. **Avoid writing to:** `monday_*` tables (managed by the sync), `xero_connection` (managed by OAuth flow), and singleton config tables unless the integration owns those features.

---

_Last updated: 2026-04-27. Migration source of truth: `supabase/migrations/`._
