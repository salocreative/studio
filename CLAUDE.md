# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Salo Studio: the internal business-management app for Salo Creative (time tracking, projects, Flexi-Design credits, retainers, statements of work, leads, forecast, cupboard documents). Deployed on Vercel at admin.salo.uk. Data lives in Supabase; projects and tasks are synced in from Monday.com; financials come from Xero.

## Commands

```bash
npm run dev      # Next dev server on port 3000
npm run build    # Production build (also the only type-check; run before pushing)
npm run lint     # eslint (eslint-config-next core-web-vitals + typescript)
npx tsc --noEmit # Type-check without building
```

There is no test suite. Verification is `npm run build` plus manual checks in the running app.

Database changes are SQL files in `supabase/migrations/` (numbered `NNN_description.sql`). Apply with `supabase migration up` or paste into the Supabase SQL editor. There is no `supabase/config.toml`, so the CLI is linked per developer.

## Stack

Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, shadcn/ui (new-york style, `components/ui/`), Supabase (`@supabase/ssr`), Recharts, sonner for toasts, lucide icons. Path alias `@/*` maps to repo root.

## Architecture

### Request flow and auth

- `proxy.ts` is the Next 16 middleware (exported as `proxy`). It refreshes the Supabase session cookie, redirects unauthenticated users on protected route prefixes to `/auth/login`, and routes Supabase invite codes hitting `/` to `/auth/callback`. Public share routes (`/sow/share`, `/retainers/share`, `/flexi-design/share`, `/time-reports/share`) are excluded. When adding a new protected top-level route, add its prefix to the list here.
- `app/(dashboard)/layout.tsx` is `force-dynamic`, re-checks the user, loads the role from `users`, and renders the sidebar. Soft-deleted users (`deleted_at` set) are bounced to login.
- Roles are `admin | designer | manager`. The DB enum also contains legacy `employee`, which is mapped to `manager` wherever roles are read. `types/database.ts` still says `employee` and only covers the first ~13 tables; it is stale and most actions use untyped rows. `docs/SUPABASE_SCHEMA.md` and `docs/DATABASE_SCHEMA.md` are the accurate schema references.
- Navigation and role gating live in `components/navigation/sidebar.tsx` (a `roles` array per nav item). Settings is admin only.
- `app/actions/auth.ts` provides `requireAdmin` / `requireAuth` (redirecting) and `checkIsAdmin` (non-redirecting) for server actions.

### Data access: server actions, two Supabase clients

Almost all data access is through server actions in `app/actions/*.ts` (one file per domain). Pages are thin: `page.tsx` usually just renders a `*-client.tsx` component that calls actions. API routes exist only for cron, webhooks, OAuth callbacks, file downloads, and the Figma plugin.

Actions return plain objects, never throw to the caller: `{ error: string }` on failure, `{ success: true, ...data }` on success. Follow this shape.

Two clients in `lib/supabase/server.ts`:
- `createClient()` uses the anon key plus the user's cookie session. RLS applies. Use for anything acting as the logged-in user.
- `createAdminClient()` uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS. Returns `null` if the key is missing, so always null-check. Use for: Monday sync writes, public share-token readers (`*-public.ts` actions), user admin, and the Figma API. Never expose it to the browser.

Public share pages (`app/<domain>/share/[token]/`) live outside `(dashboard)`, take the token from params, and call a `get*ByToken` action that validates the token against a `*_share_links` table (`is_active`, `expires_at`) using the admin client.

Several actions tolerate a table not existing yet (Postgres `42P01` / "schema cache" errors) because production has sometimes lagged migrations. Keep that pattern when reading newly added tables from widely used code paths.

### Monday.com sync

Monday is the source of truth for projects, tasks, clients and leads. `lib/monday/api.ts` holds the GraphQL client (`mondayRequest`, with timeout and retry) and `syncMondayData`, which upserts into `monday_projects` / `monday_tasks` using the admin client. Triggered manually from Settings (`app/actions/monday.ts`) or by Vercel cron hitting `/api/sync/cron` daily (see `vercel.json`), which respects `monday_sync_settings` (enabled, interval, avoid_deletion) and an optional `CRON_SECRET` header.

Column extraction is configuration-driven: admins map Monday column IDs to semantic types (client, quoted_hours, quote_value, timeline, status, likelihood, dates) in `monday_column_mappings`, per board or global (`board_id null`). Resolve with `findMappingColumnId` in `lib/monday/mapping-resolver.ts`; parse values with `lib/monday/column-extract.ts`. Raw column payloads are also stored on the row (`column_values` / `monday_data`).

Board classification is central to the app and lives in `lib/monday/board-helpers.ts`:
- Main boards = boards with column mappings minus Flexi boards, completed/archive boards, the Flexi completed board and the leads board.
- Flexi-Design boards = union of `flexi_design_boards` table and legacy name-contains-"flexi" detection.
- Configured in Settings via `monday_completed_boards`, `monday_leads_board`, `flexi_design_boards`, `flexi_design_completed_board`.

Time tracking, projects, performance and Flexi views all filter by these sets, so changes here ripple everywhere.

### Domains worth knowing before touching

- **Flexi-Design** (`app/actions/flexi-design*.ts`, `lib/flexi-design/`): clients buy credit (hours) recorded in `flexi_design_credit_transactions`; spend is derived from quoted hours on Flexi-board projects. Projects whose Monday status contains "speculative" stay visible but count zero spend (`lib/flexi-design/speculative.ts`). Client share pages expose files, gallery, contacts, services and ideas; assets go to Supabase Storage via `lib/flexi-design/storage.ts`.
- **SoW** (`app/actions/sow*.ts`, `lib/sow/`): statements of work with line items, payment milestones, per-party rates, currency and FX. Pricing maths is in `lib/sow/calculations.ts`; keep it there rather than in components. Approved SoWs can be pushed to Monday (`sow-to-monday.ts`), as can quotes (`quote-to-monday.ts`).
- **Retainers**: keyed by client name, with share links for clients.
- **Xero** (`lib/xero/api.ts`, `app/api/xero/callback`): OAuth tokens stored in DB; feeds the Forecast page.
- **Figma plugin API** (`app/api/figma/*`, `lib/api/figma-auth.ts`): Bearer auth accepting either the shared `FIGMA_PLUGIN_API_TOKEN` env secret or a `salo_…` Studio API token (hashed in `studio_api_tokens`, issued from Settings). Responses need the CORS helpers in that file.
- **Cupboard**: internal documents in Supabase Storage with categories; formerly "documents" (migration 031 renamed it).

### Environment variables

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `MONDAY_API_TOKEN`. Optional: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `CRON_SECRET`, `FIGMA_PLUGIN_API_TOKEN`. Setup guides are in `docs/` (Monday, Xero, auth/invitations, Vercel).

## Conventions

- UK English in UI copy and comments. Currency defaults to GBP; SoW can be USD.
- Brand colour is `#6405FF`; font is Stolzl via Adobe Fonts. Use existing shadcn components before adding new ones.
- Commit messages are a single imperative sentence with a full stop (see `git log`).
- `docs/` contains many historical troubleshooting notes (invitations especially). Treat them as context, not as current spec. The two schema docs are the ones kept current.
