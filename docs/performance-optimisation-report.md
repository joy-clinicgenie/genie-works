# Backend performance optimisation report

Date: 2 November 2026  
Scope: cold starts, PostgreSQL pooling, and database round trips for `/analytics`, `/seo`, Auth.js, and shared database utilities.

## A. Initial findings

### Runtime and rendering

Genie Works is a Next.js 16 App Router application. The affected routes are dynamic React Server Component routes (`force-dynamic`) and perform their reads before rendering. There is no request middleware. Authentication is Auth.js v5 with the PostgreSQL adapter and database sessions.

The deployed functions run in Singapore (`sin1`). A production response returned `x-vercel-id: sin1::sin1`, and the Neon pooler is in AWS `ap-southeast-1`. This removes the earlier Washington-to-Singapore database path.

Observed production baselines before these code changes:

- `/sign-in`: 64–114 ms time to first byte over six warm requests.
- `/api/auth/session`: 57–71 ms after the first request.
- `/api/auth/providers`: one observed cold request at 961 ms; later requests were 60–147 ms.
- Production logs showed the first database activity for warm `/seo` and `/analytics` requests after 57–105 ms. New instances took 544 ms and 883 ms before the first `/seo` database activity.
- A new Neon pooled connection took 73–111 ms. A warm `select 1` took 9–10 ms, while PostgreSQL execution for a client-count query was 0.325 ms. Network and protocol overhead, not SQL execution, dominated these small reads.

These production observations include Vercel and network effects. They are not interchangeable with local loader benchmarks below.

### Connection management

`packages/db/src/client.ts` already held one module-level `pg.Pool` per warm process, with `max: 8`. It did not create a pool per request. Separate Vercel instances still have separate pools, as expected.

The previous pool used `pg` defaults:

- 10-second connection idle timeout.
- No explicit connection acquisition timeout.
- Idle handles could keep scripts alive.

The Neon URL uses its pooled endpoint. No ORM, alternate provider, paid proxy, or new database service is involved.

Every `withContext` call previously used four network round trips for one query:

1. `BEGIN`
2. transaction-local RLS context (`set_config`)
3. the application query
4. `COMMIT`

Against Neon, an alternating same-process comparison measured a 37 ms median for this path.

### Authentication and access

Affected files:

- `apps/platform/src/lib/auth.ts`
- `apps/platform/src/lib/session.ts`
- `packages/db/src/client.ts`
- `packages/db/src/services/auth.ts`
- `node_modules/@auth/pg-adapter/index.js` (inspected only)

The official PostgreSQL adapter implemented `getSessionAndUser` as two queries. The application adapter wrapper placed each statement in its own RLS service transaction. A normal session read therefore used eight network round trips before page access was resolved.

`getAccess` then loaded active staff by email, loaded the same staff row again by ID, and loaded memberships. The Google sign-in callback also put its staff lookup and audit insert in separate transactions.

The auth route imported the complete `@clinic-genie/db` barrel. A fresh-process Node measurement took 116 ms to import that barrel. The focused client/auth/audit modules used by the production auth path took 63 ms. This is a module-load proxy, not a deployed Vercel cold-start benchmark.

### `/analytics`

Affected files:

- `apps/platform/src/app/(app)/analytics/page.tsx`
- `apps/platform/src/components/modules/AnalyticsShell.tsx`
- `apps/platform/src/lib/site-view.ts`
- `apps/platform/src/lib/load-analytics-board.ts`
- `apps/platform/src/lib/live-analytics.ts`

The route first opened one staff transaction to resolve the client, snapshots, websites, and references. When live analytics was enabled it opened a second staff transaction for connection and report reads. The second stage depended on the selected website, so it could not start safely before the first stage completed.

The analytics-only site view also loaded account references that no analytics component consumed. The live loader separately scanned the same daily session rows for totals and chart series, and loaded weekday, Wix contact/form, and Search Console reports that `liveFactsFromBundle` never used.

For a local disconnected-source fixture, the old page composition made two transactions and nine driver calls after the shared transaction optimisation was applied. Under the original four-round-trip transaction implementation, the equivalent path was eleven network round trips.

### `/seo`

Affected files:

- `apps/platform/src/app/(app)/seo/page.tsx`
- `apps/platform/src/lib/seo-workspace.ts`
- `packages/db/src/services/seo-soft-launch.ts`

The overview opened one staff transaction for client/site selection, another for SEO data, and a service transaction for the site token. Eight SEO reads were started with `Promise.all` on the same checked-out `pg` client. `node-postgres` does not execute statements concurrently on one client and emitted:

> Calling client.query() when the client is already executing a query is deprecated.

With a selected local site, the previous composition made three transactions and 17 driver calls after the shared transaction optimisation. Under the original transaction implementation, that is equivalent to 20 network round trips.

The public SEO configuration reader had the same unsupported same-client `Promise.all` pattern for pages, redirects, and verification.

## B. Changes implemented

### Shared pool and RLS transactions

`packages/db/src/client.ts` now:

- Keeps the existing bounded module-level pool (`max: 8`).
- Uses a 10-second connection acquisition timeout.
- Keeps an idle connection for 60 seconds instead of 10 seconds.
- Uses `allowExitOnIdle` so command-line processes can exit naturally.
- Sends `BEGIN` and the transaction-local RLS `set_config` calls in one network message.

The context values are generated by trusted server code and escaped with `pg.escapeLiteral`. Context remains transaction-local. `COMMIT`, rollback, and unconditional release behaviour are unchanged.

A live Neon comparison measured:

- Previous transaction median: 37 ms.
- Optimised transaction median: 29 ms.
- Improvement: 8 ms, or 21.6%.

After six transactions, the pool contained one idle connection. It still contained and reused that connection after 12 seconds. This verifies reuse within one warm process; it does not imply sharing between Vercel instances.

### Authentication

`apps/platform/src/lib/postgres-auth-adapter.ts` overrides only `getSessionAndUser`, joining `sessions` and `users` in one query. All writes and account operations remain on the official Auth.js PostgreSQL adapter.

Additional changes:

- The adapter session read falls from two RLS transactions/eight round trips to one transaction/three round trips.
- `getAccess` reuses the already-loaded active staff row and only queries memberships afterward.
- The Google callback performs staff lookup, optional local admin creation, and audit recording in one service transaction.
- Production auth imports focused database modules. Development-only magic-link code and local-only admin creation are dynamically imported when those paths run.

Google remains the authentication provider. Database sessions, the 12-hour session age, the active-staff check, audit events, roles, memberships, and denial behaviour are unchanged.

### Analytics

The analytics overview now resolves the site view and live analytics under one staff transaction. All reads use the same transaction-local authenticated staff context. The analytics-only site view no longer loads unused account references. Session totals are derived from the same complete-day series used by the chart, preserving the existing completeness rule while removing duplicate scans. Reads for live-bundle fields that no rendered analytics board consumes were removed.

Measured with the same local disconnected-source fixture:

- Before page consolidation: 2 transactions, 9 driver calls, 3 ms.
- Final: 1 transaction, 6 driver calls; warmed local median 2.3 ms over five requests.
- Original-to-final network round trips: 11 to 6, a 45.5% reduction.

The local elapsed-time difference is too small to treat as a production latency claim. Analytics calculations, source selection, periods, and rendered components are unchanged.

### SEO

The SEO overview now resolves context, selected-site data, and token presence in one staff transaction. Migration `0028_seo_site_token_staff.sql` already permits staff to select token rows only for clients they can access, so this removes a transaction without widening RLS. Token values are not returned by the check or exposed to the UI.

SEO reads on one checked-out client are explicitly ordered. This removes unsupported concurrent calls without changing their results. The public SEO configuration reader consolidates its three post-authorisation reads into one SQL query using JSON aggregates.

Measured with the same selected local site:

- Before page consolidation: 3 transactions, 17 driver calls, 4.8 ms.
- Final: 1 transaction, 13 driver calls; warmed local median 3.8 ms over five requests.
- Original-to-final network round trips: 20 to 13, a 35% reduction.

The report-builder had the same unsupported same-client concurrency pattern. Its reads are now ordered. This is a reliability correction; no latency improvement is claimed for that path.

### Files added

- `apps/platform/src/lib/postgres-auth-adapter.ts`
- `apps/platform/src/lib/postgres-auth-adapter.test.ts`
- `apps/platform/src/lib/live-analytics.test.ts`
- `packages/db/test/client-performance.test.ts`
- `packages/db/test/context-isolation.test.ts`
- `docs/performance-optimisation-report.md`

No schema, migration, environment variable, authentication provider, analytics calculation, SEO metric, or production infrastructure was changed by this optimisation.

## C. Before-and-after comparison

| Metric | Before | After | Improvement |
| --- | ---: | ---: | ---: |
| Full deployed cold-start latency | 500–1,000 ms observed; `/api/auth/providers` 961 ms and `/seo` first DB activity 544–883 ms | Not deployed or measured | No unverified claim |
| Auth database-module import proxy | 116 ms | 63 ms | 53 ms / 45.7% |
| New connection overhead | 73–111 ms | Unchanged for a genuinely new connection | Pool reuse avoids more repeated connections |
| Idle connection reuse | Default 10-second idle timeout | Verified retained after 12 seconds; configured for 60 seconds | Avoids reconnects between 10 and 60 seconds on a warm instance |
| One-query RLS transaction | 37 ms median | 29 ms median | 8 ms / 21.6% |
| Auth.js session read | 2 transactions / 8 round trips | 1 transaction / 3 round trips | 5 round trips / 62.5% |
| Access-profile resolution after Auth.js | 3 data queries / 6 round trips | 2 data queries / 4 round trips | 2 round trips / 33.3% |
| `/analytics` page-data path, disconnected fixture | 2 transactions / 11 original round trips | 1 transaction / 6 round trips | 5 round trips / 45.5% |
| `/analytics` loader elapsed time, local | 3 ms initial comparison | 2.3 ms warmed median (five requests) | Directional only; not a production claim |
| `/seo` page-data path, selected fixture | 3 transactions / 20 original round trips | 1 transaction / 13 round trips | 7 round trips / 35% |
| `/seo` loader elapsed time, local | 4.8 ms initial comparison | 3.8 ms warmed median (five requests) | Directional only; not a production claim |

Cold-start and HTTP response-time improvements require a deployment of this revision and comparable Vercel observations. The table intentionally does not substitute local loader time for deployed latency.

## D. Security verification

Completed checks:

- `npm run typecheck`: passed for all workspaces.
- `npm run lint`: passed.
- Production build using an isolated Next.js output directory: passed.
- Database permission suite: 19/19 passed against local PostgreSQL.
- Application auth/access suite: 3/3 passed.
- Auth adapter, SEO workspace, and analytics unit suites: passed.
- Concurrent context test: twelve overlapping specialist/reviewer transactions retained their own `app.user_id` and `app.platform_role` before and after an intentional delay.
- Transaction tests prove commit setup, rollback, release, and connection-acquisition error mapping.
- The full platform suite passed 60/60 tests.
- The final database suite excluding one unrelated existing backup-coverage failure passed 117/117.

RLS remains enabled and no policy was changed. Every staff or service operation still starts a transaction, applies transaction-local context, commits or rolls back, and releases the checked-out connection. No authenticated or client-specific result is globally cached.

The complete repository test command currently has one unrelated failure: uncommitted migration `0039_search_checks.sql` creates `seo_index_checks` and `seo_speed_checks`, but the existing backup coverage lists do not classify those tables. This optimisation did not modify that migration or backup scope.

## E. Remaining recommendations

1. Deploy this revision to a non-production environment and capture cold and warm `/api/auth/providers`, `/seo`, and `/analytics` timings. Do not claim a Vercel cold-start improvement from the module import proxy alone.
2. Add request-scoped query/transaction telemetry without SQL parameters or sensitive data. Current counts were gathered with a local instrumentation harness.
3. If connected analytics routes remain slow, consolidate the repeated promoted-report reads in `loadLiveBundle` into purpose-built aggregate queries. This needs result-equivalence tests for every provider template.
4. Consider `@vercel/functions` `attachDatabasePool` only after adding the package and verifying its lifecycle with the current Vercel runtime. It was not added because the existing bounded pool is already reused, and no connection leak or exhaustion was observed.
5. Neon free compute wake-up remains outside application pooling. A first request after compute suspension can still be slower even when the Vercel function is warm.
6. Classify the two new Site Health tables in backup policy so the unrelated full-suite failure is resolved.

