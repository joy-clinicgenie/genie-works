# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Clinic Genie internal agency operations platform (also called "Genie Works"): clients, action queue, tasks, approvals, SEO, Google Ads, issues/evidence, medical review, reports, timeline, admin. The Phase 1 public clinic website and lead intake live in the sibling repo `~/vsc/clinic-demo-a` — do not duplicate that backend here, and do not touch its Postgres on port 54329.

All seed data is fictional. Never introduce real client names, account IDs, contacts or results.

## Commands

Node ≥ 20.9 (see `.nvmrc`). No Docker needed — dev Postgres runs from embedded binaries.

```bash
npm install && cp .env.example .env   # set AUTH_SECRET
npm run db:start      # embedded Postgres on 127.0.0.1:54339 (keep running)
npm run db:migrate    # applies packages/db/migrations/*.sql in order
npm run db:seed       # idempotent fictional seed
npm run dev           # starts the DB if not listening, then Next.js on :3400
```

- `npm run typecheck` / `npm run lint` / `npm run build` — across workspaces (lint only exists in `apps/platform`).
- `npm test` — Vitest in `packages/db` (`test/**/*.test.ts`) and `apps/platform` (`src/**/*.test.ts`). **Requires the DB running, migrated and seeded.** Files run serially (`fileParallelism: false`).
- Single test file: `npm test -w @clinic-genie/db -- test/permissions.test.ts`; single test: add `-t "name pattern"`.
- `npm run db:reset` — drop/recreate schema (dev only). `db:backup`, `db:restore-test`, `db:seed-load` (perf DB; name must contain `perf`, see `docs/PERFORMANCE.md`).
- `npm run test:decisions` — `node --test` checks over `decisions/` records (DAY-01 is known to fail; see `docs/BUILD_STATUS.md`).

Dev sign-in: `/sign-in` with a seeded address (e.g. `admin@example.invalid`, `specialist-a@example.invalid`); the magic link is not emailed but listed at `/dev/magic-links`.

## Architecture

npm workspaces:
- `packages/contracts` — shared vocabularies (roles, statuses, metrics, event types) as zod/TS. Imported via `@clinic-genie/contracts`, and re-exported from `@clinic-genie/db`.
- `packages/db` — plain-SQL migrations, domain services (`src/services/*.ts`), seed, backup/restore. Consumed as TS source (`main: ./src/index.ts`, no build step).
- `apps/platform` — Next.js 16 App Router + React 19, Auth.js v5 (database sessions via `@auth/pg-adapter`), Tailwind v4. `@/` aliases `apps/platform/src`.

**Next.js 16 differs from training data** — read `apps/platform/AGENTS.md` and the docs in `node_modules/next/dist/docs/` before writing Next-specific code (e.g. route `params` are Promises).

### Authorization is enforced twice: app checks + Postgres RLS

- Two DB roles: `DATABASE_ADMIN_URL` (owner, bypasses RLS — migrations/seeds/backups/tests only) and `DATABASE_URL` as `cg_app` (`nobypassrls`; the app always uses this).
- Every app query goes through `withContext(ctx, fn)` in `packages/db/src/client.ts`, which opens a transaction and `SET LOCAL`s `app.context` / `app.user_id` / `app.platform_role`. RLS policies read those settings. Anonymous contexts have no policies (deny by default, migration 0007).
- In the app use the wrappers in `apps/platform/src/lib/db.ts`: `staffTx(access, fn)` for user actions, `serviceTx(fn)` only for trusted server-to-server work (auth adapter, public API).
- `AccessProfile` (user + client memberships) is resolved server-side per request by `getAccess()`/`requireAccess()`/`requireClientAccess()` in `lib/session.ts` — never from client-supplied claims. Permission predicates (`canAccessClient`, `canEditClient`, `canReviewClient`, `canManageRegistry`, `canManageUsers`) live in `packages/db/src/services/auth.ts`. Roles: admin/manager are global; specialist/reviewer/read_only are scoped by membership (see `docs/DECISIONS.md` D6).

### Mutations

Server actions in `apps/platform/src/app/actions/*.ts` (`"use server"`): `requireAccess()` → permission check → `staffTx` calling a `@clinic-genie/db` service → `revalidatePath`. Errors are mapped to a form-safe `ActionState` by `toActionError` in `lib/actions.ts` (services throw `PermissionDeniedError` or `*RuleError` with an optional `field`). Form helpers `str/optional/bool/list/numberOrNull` live there too. UI forms live in `src/components/modules/`, primitives in `src/components/ui/`.

### Data rules

- Migrations are checksummed: **never edit an applied migration** — add the next numbered `NNNN_name.sql`. Include RLS policies and grants for any new table.
- Approval decisions, report snapshots and audit events are append-only, enforced by DB triggers; corrections are new rows that supersede old ones (D9).
- The pg client returns `date` columns as `YYYY-MM-DD` strings and `numeric` as numbers. Operational day boundaries use Asia/Singapore (D8).
- Evidence uploads are private (`UPLOADS_DIR`) and served only via `app/api/evidence/[id]` after a permission check.
- Enquiries/form submissions are read from the clinic website DB via `ENQUIRY_DATABASE_URL` (`lib/form-submissions.ts`) and are not copied here.
- `app/api/public/seo/[websiteId]` is a per-site bearer-token, read-only API that connected websites use to fetch published SEO settings (D12).

### Tests

DB tests (`packages/db/test/helpers.ts`) use `asContext(ctx, fn)`, which runs as `cg_app` with an RLS context and **rolls back** by default; `staffByEmail` / `clientBySlug` look up seed records, so a seeded DB is required. Permission tests should cover unauthorised roles and cross-client isolation.

## Project documents and working rules

- Spec pack `00_README.md`–`20_DELIVERY_TIMELINE.md` (the source PDF is authoritative over it). Read 01–04 before larger changes. `06_WEBSITE_STARTER_SEO.md` + D11 define the current SEO soft-launch scope; anything beyond it is backlog.
- `docs/BUILD_STATUS.md` (current stage, exact next step), `docs/DECISIONS.md` (numbered decisions D1…), `docs/ACCEPTANCE.md`, `docs/HANDOVER.md`. Record scope changes in DECISIONS before implementing.
- From `16_BUILD_RULES.md`: implement one ticket at a time from `17_BUILD_TICKETS.md`; preserve client isolation and the separation between public pages, shared services and admin; add normal, failure, concurrency and unauthorised tests; run lint/typecheck/tests and report exact results. Escalate major schema changes, new paid vendors, patient-data handling changes, production secrets or duplicated backend logic. Don't mark anything "live" from a local demo.
- UI tokens and interaction rules are in `15_DESIGN_SYSTEM.md` (brand anchor `#DDF7F8`, action `#136C72`; status must use words/icons, not colour alone).
