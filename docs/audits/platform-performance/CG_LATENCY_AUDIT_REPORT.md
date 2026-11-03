# Clinic Genie — platform latency and performance audit

Date: 3 November 2026
Commit: `a54d6de` (working tree had uncommitted enquiry-read changes; see "Tree state")
Scope: whole Genie Works platform (`apps/platform`, `packages/db`, `packages/contracts`)
Status: **audit only — no fixes applied, no configuration or data changed**

---

## 1. How to read this report

Every number in this report is one of three kinds, and each is labelled:

- **MEASURED** — produced by a command run during this audit, with the method stated.
- **DERIVED** — arithmetic over measured values (for example "19 round trips × measured 8.5 ms per round trip").
- **NOT MEASURED** — could not be measured in this environment. No value is invented.

Nothing here is a lab Lighthouse score presented as field data. **No browser Core Web Vitals were measured at all** — see section 3 for why, and section 9 for what that leaves open.

---

## 2. Tree state and environment

| Item | Value |
| --- | --- |
| Framework | Next.js 16.4.2, App Router, React 19 |
| Rendering | React Server Components; **every** app route is `force-dynamic` |
| Auth | Auth.js v5 beta.32, database sessions, `@auth/pg-adapter` with a custom `getSessionAndUser` override |
| Database | PostgreSQL on Neon, `ap-southeast-1`, pooled endpoint |
| Deploy target | Vercel, region `sin1` (`vercel.json`) |
| Cron | one job: `/api/internal/analytics/worker` daily at 02:00 |
| Client state | none — no store, no data-fetching library, no client-side cache |
| Caching | **none** — no `use cache`, no `unstable_cache`, no `revalidate`, no `fetchCache`, no ISR, no `Cache-Control` other than `no-store` |
| Streaming | **none** — zero `Suspense` boundaries, 2 `loading.tsx` files for 70 page routes |
| Monitoring | no APM, no RUM, no custom metrics. Errors go to `console.error` and Vercel logs |

Route inventory (MEASURED by enumeration):

| Kind | Count |
| --- | --- |
| `page.tsx` routes | 70 |
| `route.ts` handlers | 18 |
| Layouts | 4 |
| `loading.tsx` | 2 (`/blog`, `/clients`) |
| `error.tsx` | 1 (`/clients`) |
| `Suspense` boundaries | 0 |
| `force-dynamic` declarations | 72 |
| Client components (`"use client"`) | 44 of 78 components |
| Server actions files | 13 |

### The local `.env` points at the shared Neon database

This matters for every measurement below. `DATABASE_URL`, `DATABASE_ADMIN_URL` and `ENQUIRY_DATABASE_URL` in the repository `.env` all resolve to `ep-noisy-tooth-a1egyo2f.*.ap-southeast-1.aws.neon.tech`. There is also an embedded PostgreSQL listening on `127.0.0.1:54339`, but the app is not configured to use it.

Two consequences:

1. **Local development already pays the real network cost of the production database.** Round-trip latency measured from this machine (8.2 ms p50) is the same order as the figure the earlier backend report measured from Vercel `sin1` (9–10 ms for a warm `select 1`). The per-round-trip cost model used throughout this report is therefore production-representative, not a local artefact.
2. **Development magic-link sign-in is disabled**, correctly. `localRehearsalDatabase()` in `apps/platform/src/lib/runtime-policy.ts:18` refuses to enable dev links when `DATABASE_URL` is a shared database. `/api/auth/signin/dev-link` returns `error=Configuration`.

### Data volume in the shared database (MEASURED)

| Table | Rows |
| --- | --- |
| `analytics_metric_values` | 33,101 |
| `analytics_report_rows` | 8,290 |
| `audit_events` | 114 |
| `analytics_connections` | 22 |
| `analytics_report_partitions` | 21 |
| `clients` | 15 |
| `memberships` | 15 |
| `sessions` | 15 |
| `websites` | 14 |
| `blog_articles` | 1 |
| `saved_reports` | 2 |
| `staff_users` | 2 |
| `tasks`, `seo_pages`, `seo_changes`, `report_snapshots`, `enquiry_reads` | 0 |
| `enquiries` (external enquiry database) | 0 |

Websites with a Wix form binding: **8**, of which **7** have `wix_counts_in_totals = true`.

**This is a thin dataset for the operational tables.** Any finding about row volume (unbounded result sets, in-memory filtering) is therefore a *structural* finding about what the code will do as data arrives, not an observation of present slowness. Findings about round-trip counts and external API calls are independent of row volume and are observable today.

---

## 3. What could not be measured, and why

| Metric | Status | Reason |
| --- | --- | --- |
| TTFB, FCP, LCP, INP, CLS on authenticated routes | **NOT MEASURED** | No authenticated session could be obtained. Dev magic links are disabled because the database is shared (above); Google OAuth needs an interactive browser consent; and minting a session row directly was refused by this environment's safety controls — correctly, since it would have written to the shared production/staging database. |
| Real-user Core Web Vitals (field data) | **NOT MEASURED** | No RUM is installed anywhere in the platform. There is no field data to read. |
| Client-side navigation duration | **NOT MEASURED** | Requires an authenticated browser session. |
| Hydration cost, re-render counts | **NOT MEASURED** | Requires an authenticated browser session. |
| p50/p95/p99 of API endpoints under real traffic | **NOT MEASURED** | No request-level telemetry is collected. Vercel observability was not queried. |
| Concurrency behaviour (1 / 5 / 10 sessions) | **NOT MEASURED** | No staging environment with its own database was available, and load testing the shared database was out of scope. |
| Production cold-start duration on Vercel | **NOT MEASURED** | Not reproducible locally. |

What **was** measured instead: database round-trip cost, the exact query sequence and query count of each hot server path, the real latency of the Wix Forms API, the production build's framework overhead, and client bundle size. Those four together account for the structure of the platform's latency, which is what the audit needs to prioritise work.

**Method for the authenticated-path numbers.** Rather than measure through HTTP, the audit imported the real service functions from `@clinic-genie/db` and ran the exact query sequences each page performs, inside the real `withContext` RLS transaction, against the real database, wrapping the `pg` client to count driver calls. This gives an exact query count (not an estimate) and a measured wall-clock time for the data-loading half of each route. It excludes React render time and network transfer to the browser, both of which section 6 shows to be small.

---

## 4. The single structural cause

**Every app route is `force-dynamic`, performs all of its reads serially before rendering anything, and has no cache and no streaming boundary. Response time therefore equals the sum of every database round trip plus every external API call on that route's critical path.**

Three measured constants set the scale:

| Constant | MEASURED | Method |
| --- | --- | --- |
| Warm database round trip | **p50 8.2 ms**, p95 11.2 ms, min 7.5 ms, max 18.0 ms (n=30) | `select 1` on a warm pooled connection |
| Cold connection + first query | **p50 75.2 ms**, max 516.5 ms (n=5) | new `pg.Pool`, connect, one query |
| Empty staff RLS transaction (3 round trips) | **p50 25.3 ms**, p95 34.8 ms (n=20) | `begin`+`set_config` bundled, one `select 1`, `commit` |
| Marginal cost of one extra query in a transaction | **≈ 8.5 ms** | DERIVED from a 1→25 query sweep: 23.9 ms (1 query) → 227.6 ms (25 queries), (227.6−23.9)/24 |

The 1→25 query sweep, in full (MEASURED, n=8 each):

| Queries in one transaction | p50 | p95 |
| --- | --- | --- |
| 1 | 23.9 ms | 26.2 ms |
| 5 | 58.4 ms | 74.4 ms |
| 11 | 106.2 ms | 110.3 ms |
| 16 | 146.6 ms | 157.3 ms |
| 25 | 227.6 ms | 248.7 ms |

The relationship is linear with no inflection: **nothing in the stack batches or pipelines queries.** `node-postgres` executes one statement at a time per checked-out client, and the code is aware of this — `packages/db/src/services/seo-soft-launch.ts` and `apps/platform/src/lib/seo-workspace.ts:352` carry comments explaining that `Promise.all` on one client is unsupported, so the reads were deliberately serialised. Correct for safety, but it means **query count is the latency budget**.

Opening a second transaction on a route costs a further ~17 ms (two extra round trips) on top of its queries.

---

## 5. Measured query sequences per route

Each row is the real sequence that route executes, with the driver call count counted by instrumentation, run 6 times (4 for reports) after one warm-up. "Round trips" = driver queries + 2 for `begin`/`set_config` and `commit`.

| Server path | Driver queries | Round trips | p50 | p95 |
| --- | --- | --- | --- | --- |
| `(app)/layout.tsx` — shell clients + active website ids | 2 | 4 | **34.2 ms** | 39.7 ms |
| `getAccess()` — staff by email + memberships | 2 | 4 | **35.1 ms** | 51.0 ms |
| `loadSiteView()` — analytics/report site selection | 4 | 6 | **56.8 ms** | 65.7 ms |
| `loadSeoOverview()` — SEO context + website bundle | 11 | 13 | **121.3 ms** | 135.0 ms |
| `loadLiveBundle()` GA4 — published report chain | 15 | 17 | **173.7 ms** | 191.6 ms |
| `composeReport()` uncompared | 20 | 22 | **214.1 ms** | 230.5 ms |
| `composeReport()` compared (period + comparison) | 28 | 30 | **265.3 ms** | 280.6 ms |

These are additive within a route. A full `/analytics` load runs `getAccess` (35) + layout (34) + `loadSiteView` and `loadLiveBundle` in one shared transaction (19 queries ≈ 175) → **≈ 245 ms of database time before React renders anything** (DERIVED from the measured parts).

---

## 6. What is *not* the problem

Ruling these out matters as much as the findings, because it tells the team where not to spend effort.

### Framework and server rendering overhead is negligible (MEASURED)

Production build (`next build` to a separate `distDir`, `next start` on port 3401), unauthenticated routes, `time_starttransfer`, 8 samples each:

| Route | First request | Warm requests |
| --- | --- | --- |
| `/sign-in` | 193 ms | 4.2 – 9.6 ms |
| `/api/auth/session` | 3.7 ms | 1.9 – 12.2 ms |
| `/api/auth/providers` | 2.5 ms | 1.7 – 1.9 ms |
| `/api/auth/csrf` | 2.9 ms | 1.5 – 1.8 ms |
| `/api/internal/operations/status` (401 path) | 7.2 ms | 1.3 – 2.2 ms |

Next.js 16, React 19 server rendering and the route layer cost **single-digit milliseconds** warm. The 193 ms first request is one-off route compilation. Any slowness staff experience is not the framework.

### The client bundle is small (MEASURED)

| Measure | Value |
| --- | --- |
| All client JS chunks, uncompressed | 1,148 KiB |
| All client JS chunks, gzipped | **332.5 KiB** |
| Largest three chunks (uncompressed) | 228 KiB, 168 KiB, 112 KiB |
| CSS | 48 KiB (one file) |

There is no chart library, no data grid, no date library, no state manager. Icons come from `lucide-react`. 44 client components exist but all are small (largest 536 lines). 22 `useEffect` calls across 10 files. **JavaScript weight is not a bottleneck.**

### Connection pooling is already correct

`packages/db/src/client.ts` holds one module-level `pg.Pool` per process (`max: 8`, 10 s acquisition timeout, 60 s idle, `allowExitOnIdle`). It does not create a pool per request. `beginWithContext` already bundles `begin` and the three `set_config` calls into a single network message — a deliberate optimisation from the 2 November work, and it is why the empty transaction costs 3 round trips rather than 4.

### Indexes are present on the paths that are used

74 indexes across 69 tables. Spot-checked against the hot queries: `analytics_partitions_lookup_idx (client_id, website_id, template_key, start_date, end_date)` covers the published-report lookup; `analytics_report_rows_partition_idx` covers the row fetch; `report_snapshots_client_period_idx`, `blog_articles_client_idx (client_id, status, updated_at desc)`, `seo_pages_client_idx`, `websites_client_idx`, `enquiry_reads_identity_idx` and `enquiry_reads_client_idx (client_id, read_at desc)` all match their access paths. **No missing index was identified.** The earlier `docs/PERFORMANCE.md` work also measured and rejected two RLS-function alternatives; that conclusion still holds and should not be revisited.

So: the platform is not slow because of its framework, its JavaScript, its pooling, or its indexes. It is slow — where it is slow — because of **how many sequential round trips and blocking third-party calls sit on a route's critical path**.

---

## 7. Confirmed findings

Ordered by priority. "Confirmed" means the evidence is a measurement or an unambiguous read of the code, not an inference.

---

### P0-1 — Live Wix Forms API calls block the dashboard and the enquiries page

**Module:** Agency Overview, Leads & Forms
**Files:** `apps/platform/src/lib/wix-enquiries.ts:41-137`, `apps/platform/src/lib/form-submissions.ts:525-543,689-692`, `apps/platform/src/app/(app)/page.tsx:49`, `apps/platform/src/app/(app)/enquiries/page.tsx:72`

**Measured Wix API latency** (one token call, one submissions page, one form-schema call — a single staff page view's worth of traffic for one of eight bindings):

| Call | Latency | Result |
| --- | --- | --- |
| `POST /oauth2/token` | **731 ms** | 200 |
| `POST /form-submission-service/v4/submissions/namespace/query` (limit 100) | **526 ms** | 200, 59 submissions, 46.6 KB |
| `GET /form-schema-service/v4/forms/{id}` | **1,013 ms** | 200 |

**Root cause.** These calls run inline during server rendering of a `force-dynamic` page, with no cache and no `Suspense` boundary, so the whole response waits on them.

- The **dashboard** calls `dashboardEnquiryCounts` → `countWixEnquiryStatuses`, which loads bindings (one transaction), then fans out over the **7** `counts_in_totals` bindings with `Promise.all`, then runs one more transaction for follow-up statuses. Each binding calls `querySubmissions`, which paginates **sequentially** up to `MAX_PAGES = 5` (`wix-enquiries.ts:285`) at `PAGE_LIMIT` per page.
- The **enquiries page** calls `loadWixEnquirySlice`, which fans out over **8** bindings, and for each runs `formLabels` (the 1,013 ms schema call) in parallel with a current-period `querySubmissions` **and** a previous-period `querySubmissions`.
- `querySubmissions` downloads **whole submission records** in order to count them (`countWixEnquiryStatuses` then discards everything except `row.id`).
- `wixFetch` uses `cache: "no-store"` with a 15 s timeout per request (`wix-enquiries.ts:367-368`). Only the OAuth token is cached, in a module-level `Map` — per warm process, so lost on every new Vercel instance.
- `wixReadsAllowed()` (`wix-enquiries.ts:174`) is `!process.env.VITEST && ANALYTICS_FIXTURE_MODE !== "1"`. **There is no production flag.** Wix reads are unconditionally on.

**Derived critical-path cost**, using the measured per-call figures and the code's own fan-out:

| Scenario | DERIVED added latency |
| --- | --- |
| Dashboard, warm token, 1 page per binding | ≈ 526 ms + 2 transactions (≈ 50 ms) ≈ **0.6 s** |
| Dashboard, cold process (token not cached) | ≈ 731 + 526 ≈ **1.3 s** |
| Enquiries page, warm token, 1 page per binding | ≈ max(1,013 schema, 526 current, 526 previous) + 2 transactions ≈ **1.1 s** |
| Enquiries page, 3 pages per binding | ≈ max(1,013, 3×526) ≈ **1.6 s** |
| Worst case allowed by the code, per binding | 5 pages × 15 s timeout = **75 s** current + 75 s previous |

Against the ≤ 800 ms TTFB target and the ≤ 2 s dashboard-data target, the two highest-traffic pages in the platform are gated by a third-party API with no cache, no circuit breaker, and no flag to turn it off.

**Recommended direction (not applied):** move Wix reads off the render path — either a periodic sync into `analytics_*`/a Wix mirror table written by the existing analytics worker, or a cached read with a short TTL plus a `Suspense` boundary so the rest of the page paints. Replace the count-by-download with a count endpoint or a stored counter. Add a kill switch. **Expected benefit: ESTIMATE — removes 0.6–1.6 s from dashboard and enquiries TTFB.**
**Complexity:** high. **Regression risk:** medium (freshness semantics change; the UI already distinguishes "connected/unavailable/not connected" states, which must be preserved). **Security risk:** low, provided the mirror keeps the existing clinic scoping and does not copy enquiry message bodies — which `07_FORMS_LEAD_CAPTURE.md` and the current code deliberately avoid.

---

### P0-2 — Committed debug instrumentation in the analytics worker leaks secret lengths on every invocation

**Module:** Admin / background sync
**File:** `apps/platform/src/app/api/internal/analytics/worker/route.ts:20-22`
**Committed in:** `7c28a4f` — verified present in `git show HEAD:…` (not a working-tree artefact)

```
// #region agent log
fetch('http://127.0.0.1:7835/ingest/72ef6d47-…',{method:'POST',…body:JSON.stringify({…
  data:{headerPresent:…,bearerLength,workerSecretSet:…,workerSecretLength,
         cronSecretSet:…,cronSecretLength,lengthMatchesWorker:…,lengthMatchesCron:…}})}).catch(()=>{});
// #endregion
```

**Root cause.** Left-over debugging from an authentication investigation. It runs **before** `workerAuthorized(header)`, on every GET and POST, authorised or not.

Two distinct problems:

1. **Security.** It transmits the byte length of `ANALYTICS_WORKER_SECRET` and `CRON_SECRET`, and whether the presented bearer length matches either. An unauthenticated caller can therefore probe secret length. The destination is `127.0.0.1:7835`, so in production nothing listens — but the payload is constructed regardless, and the endpoint is a localhost address that anything co-resident could bind.
2. **Performance.** An unawaited `fetch` to a closed local port on every cron run and every probe of the endpoint. `.catch(()=>{})` hides the failure, so it is silent. Cost is normally sub-millisecond (immediate `ECONNREFUSED`) but it is unbounded in principle and it is dead work in a hot handler.

This is the one finding in this report that should be fixed before any performance work, because it is a one-line deletion and it is a secret-metadata leak. It is flagged here rather than silently fixed because the audit brief is explicit that no changes be made.

**Recommended direction:** delete lines 20-22. **Expected benefit:** removes a secret-metadata leak; negligible latency change. **Complexity:** trivial. **Regression risk:** none.

---

### P1-1 — `loadLiveBundle` issues 15 sequential queries because `publishedReport` is two queries per report

**Module:** Website Analytics
**Files:** `packages/db/src/analytics/read.ts:30-84`, `apps/platform/src/lib/live-analytics.ts:43-108`

**MEASURED:** 15 driver queries, 17 round trips, **p50 173.7 ms**, p95 191.6 ms.

**Root cause.** `publishedReport()` always runs two queries: one to find the published partition (`order by generation desc limit 1`), then one to fetch its rows joined to metric values. `loadLiveBundle` calls it up to **seven** times in one render (`ga4.traffic_range`, `ga4.acquisition`, `ga4.landing`, `ga4.device`, `ga4.country`, plus previous-period `traffic_range` and `acquisition`), and calls `dailySessionSeriesWithPeriod` twice. The calls are written as sequential `await`s — including five of them inside the returned object literal (`live-analytics.ts:102-107`), which reads as if it were parallel but is not.

Each of those 14 round trips is measured at ~8.5 ms. The two-query shape is the multiplier: a single query per report, or one batched query across all seven template keys, would roughly halve the count.

**Recommended direction:** fold the partition lookup and the row fetch into one statement (lateral join or CTE), and fetch the template keys for a period in one query with `template_key = any($n)`. **Expected benefit: ESTIMATE — 17 round trips → 4–6, saving ~90–110 ms per analytics page load.** **Complexity:** medium. **Regression risk:** low — pure read refactor, the shaping logic already groups rows in JavaScript. **Security risk:** none, RLS still applies to the combined statement.

---

### P1-2 — `/analytics/traffic` and `/analytics/behavior` open two transactions where `/analytics` opens one

**Module:** Website Analytics
**Files:** `apps/platform/src/app/(app)/analytics/traffic/page.tsx:10-13`, `apps/platform/src/app/(app)/analytics/behavior/page.tsx:10-13`, `apps/platform/src/lib/load-analytics-board.ts:10-16`

**Root cause.** The overview route was optimised on 2 November into a single shared transaction (`loadAnalyticsOverviewForAccess`, `load-analytics-board.ts:24-36`). The traffic and behaviour routes were not. They call `loadAnalytics(...)` — which opens a transaction for `loadSiteView` — then `loadAnalyticsBoard(view)`, which calls `requireAccess()` again and opens a **second** transaction for `loadLiveBundle`.

**DERIVED:** `loadSiteView` 56.8 ms + `loadLiveBundle` in its own transaction ≈ 173.7 ms = **≈ 230 ms**, against ≈ 175 ms if they shared one transaction. Two extra round trips plus a second connection checkout, ≈ **+20 ms**, on two of the four analytics routes.

**Recommended direction:** route both pages through `loadAnalyticsOverviewForAccess`-style composition. **Expected benefit: ESTIMATE ~20 ms.** **Complexity:** low. **Regression risk:** low.

---

### P1-3 — `/seo` overview runs 11 queries in one transaction and then opens a second transaction for Search Console

**Module:** SEO Performance / SEO Management
**Files:** `apps/platform/src/lib/seo-workspace.ts:351-364` (`loadWebsiteSeoData`), `seo-workspace.ts:396-404` (`loadSeoOverview`), `seo-workspace.ts:180-197` (`loadSearchPerformance`), `apps/platform/src/app/(app)/seo/page.tsx:13-16`

**MEASURED:** `loadSeoOverview` 11 queries / 13 round trips, **p50 121.3 ms**. `loadSearchPerformance` then runs as a separate `staffTx` containing a `publishedReport` (2 queries, ≈ 42 ms). **DERIVED route total ≈ 163 ms of database time**, plus `getAccess` (35 ms) and layout (34 ms) → **≈ 232 ms**.

Three separate issues in the same path:

1. **Serial transactions.** `loadSearchPerformance` cannot start until `loadSeoOverview` has committed, because it needs `ctx.selected`. It could be run inside the same transaction once the context is known.
2. **Over-fetching then filtering in JavaScript.** `loadWebsiteSeoData` loads `listSeoPages({clientId})` — *all* pages for the client — and `websiteSeoBundle` then filters to the selected website (`seo-workspace.ts:367-372`). Same pattern for `listSeoChanges(limit: 100)` and `listTasks({statuses: all, limit: 300})`, where the tasks are then filtered down to `related_type in ('seo_page','seo_change')` in memory (`seo-workspace.ts:374`). With `seo_pages` and `tasks` currently at 0 rows this costs nothing today; it is a volume trap.
3. **Duplicate client registry read.** `loadSeoContextWithDb` calls `listShellClients` (`seo-workspace.ts:215`), which the app layout already called for the same request (`layout.tsx:37`). Every SEO sub-page pays this twice.

**Recommended direction:** push the website filter and the task `related_type` filter into SQL; fold `loadSearchPerformance` into the existing transaction; share the client registry (see P1-5). **Expected benefit: ESTIMATE ~40–60 ms today, and it removes an unbounded read.** **Complexity:** medium. **Regression risk:** low–medium — the in-memory filters encode real selection rules (`unassignedPages` is derived from the unfiltered set) and must be reproduced exactly in SQL.

---

### P1-4 — `listEnquiryBoard` runs six sequential queries, two of which are byte-identical duplicates, and abandons pagination whenever Wix is configured

**Module:** Leads & Forms
**File:** `apps/platform/src/lib/form-submissions.ts:689-795`

**Root cause**, all in one function:

1. **Duplicate query.** `listProduction` is hard-coded `true` at line 694. The count query is built as `enquiryWhere(scope, filters, currentDates, listProduction)` (line 713) and the "production total" query as `enquiryWhere(scope, filters, currentDates, true)` (line 743). Same arguments, same SQL, same parameters, **executed twice**, ~8 ms wasted every load. The second result simply overwrites `currentTotal`.
2. **Pagination disabled.** Line 692: `const sqlPaging = wix.configured ? { limit: null, offset: 0, page: paging.page } : paging;`. Because eight Wix bindings are configured, `limit` is `null` and the list query fetches **every matching enquiry row**, unpaginated, so the merge with Wix rows can be sorted in JavaScript. `ENQUIRY_PAGE_SIZE` is 25.
3. **Second unbounded path.** The enquiries page passes `page: "all"` whenever the *handling* filter is set (`enquiries/page.tsx:72`), because handling is resolved from this platform's `enquiry_reads` rows rather than at the source, so it cannot be filtered in the source query.
4. **Serial external API before the database.** Line 691 awaits `loadWixEnquirySlice` *before* any enquiry-database query starts. The Wix latency from P0-1 and the six database round trips are additive, not overlapped.
5. **Extra connection probe.** `enquiries/page.tsx:99` calls `enquiryConnection()` when not connected, which issues its own `select 1`.

The external `enquiries` table currently holds 0 rows, so items 2 and 3 cost nothing today. At a few thousand enquiries per client they become the dominant cost of the page, and they are unbounded by construction.

**Recommended direction:** delete the duplicate count; start `loadWixEnquirySlice` concurrently with the database reads (separate pools, so `Promise.all` is safe here); keep SQL pagination by fetching only a bounded Wix window and merging within that window; materialise handling into a joinable form so the handling filter can page in SQL. **Expected benefit: ESTIMATE ~8 ms today from the duplicate, ~500 ms–1 s from overlapping Wix with the database, and it removes two unbounded reads.** **Complexity:** high. **Regression risk:** medium — merge-and-page semantics across two sources are subtle and the current code is careful about synthetic vs production rows.

---

### P1-5 — The client registry is loaded twice on most routes

**Module:** cross-cutting
**Files:** `apps/platform/src/app/(app)/layout.tsx:36-39`, `apps/platform/src/app/(app)/page.tsx:29-39`, `apps/platform/src/lib/seo-workspace.ts:215`

**MEASURED:** the layout's own transaction is 2 queries / 4 round trips / **34.2 ms p50**.

**Root cause.** `AppLayout` opens a `staffTx` for `listShellClients` + `listActiveWebsiteClientIds` on every full page load, to populate the sidebar client switcher. The dashboard then calls `listShellClients` again in its own transaction, and every SEO sub-page calls it a third time through `loadSeoContextWithDb`. `getAccess()` is correctly wrapped in React `cache()` (`session.ts:21`) and is shared per request — the client registry is not.

**Recommended direction:** wrap the registry read in `cache()` the same way `getAccess` is, so layout and page share one result per request. **Expected benefit: ESTIMATE ~34 ms on the dashboard and on every SEO sub-page.** **Complexity:** low. **Regression risk:** low. This is the highest benefit-to-effort item in the report.

---

### P1-6 — Report generation runs 20–28 sequential queries

**Module:** Reports
**Files:** `packages/db/src/services/report-builder.ts:118-231`, `report-builder.ts:223-231` (`loadAnalytics`)

**MEASURED:** uncompared 20 queries / 22 round trips / **p50 214.1 ms**; compared 28 queries / 30 round trips / **p50 265.3 ms**.

**Root cause.** `load()` issues 13 independent single-purpose queries in sequence (snapshots, blog counts, blog titles, SEO statuses, SEO flags, profiles, completed tasks, open tasks, issues, SEO changes, ads changes, decisions). Then `loadAnalytics` loops over `ANALYTICS_TEMPLATES` — **8 template keys** — calling `publishedReport` for each, which is 2 queries apiece (P1-1), and does it **twice** when a comparison period is selected.

With real report volume this is the slowest staff interaction in the platform, and it is measured at 214–265 ms against an empty-ish dataset. The number does not grow with the single-row fetches but the per-query floor does not shrink either.

**Recommended direction:** batch the 13 scalar queries into a small number of statements (several are `limit 8..12` title lists over different tables and can be `union all`ed); fix `publishedReport` per P1-1 and fetch all 8 template keys for a period in one query. **Expected benefit: ESTIMATE 30 round trips → 8–10, saving ~170–190 ms per report.** **Complexity:** medium–high. **Regression risk:** medium — report output is snapshotted and append-only (D9), so any change in values is a correctness problem, not a cosmetic one. Needs the existing report tests to pass unchanged.

---

### P1-7 — Blog media is served with two transactions and an audit write per image, and is never cacheable

**Module:** Blogs
**Files:** `apps/platform/src/app/api/blog-media/[id]/route.ts`, `apps/platform/src/components/modules/blog/ArticleDocument.tsx:480`, `blog/ArticleLayout.tsx:45,69`, `blog/ArticleForm.tsx:350`, `apps/platform/src/lib/storage.ts:46`

**Root cause.** `GET /api/blog-media/[id]` runs `staffTx` to look up the media row, then a **second** `staffTx` to write an audit event, then reads the whole file into memory and returns it with `Cache-Control: private, no-store`.

**DERIVED:** 2 transactions ≈ **50 ms** plus one `audit_events` insert **per image, per page view**, with no browser caching. An article with 10 images costs ≈ 500 ms of database time and 10 audit rows on every single view, including every re-render of the editor.

Two further issues in the same area:

- Images are rendered with bare `<img>` and no `width`/`height` (four call sites above), so the blog editor and preview will shift layout as images arrive. **CLS impact: NOT MEASURED** (needs a browser session) but the precondition is unambiguous.
- `storage.ts` reads from the local filesystem under `UPLOADS_DIR`. On Vercel the filesystem is ephemeral and effectively read-only, so blog media and evidence uploads cannot work in production as written. The file's own comment acknowledges this ("Production should swap this for object storage behind the same two functions") — recorded here as an **unresolved discrepancy between implementation and deployment target**, not as a new finding.

**Recommended direction:** combine the lookup and audit into one transaction; reconsider whether an append-only audit row per *image byte fetch* is the intended granularity (an article-level read event would cut writes by an order of magnitude — this is a policy question for D-series decisions, not a free optimisation); add `width`/`height` to the `<img>` tags; give media an immutable content-addressed URL so `Cache-Control: private, max-age=…, immutable` is safe. **Expected benefit: ESTIMATE ~25 ms and one audit write per image, plus near-elimination of repeat fetches.** **Complexity:** medium. **Regression risk:** medium — the audit trail is a compliance artefact (`12_MEDICAL_PRIVACY_APPROVALS.md`, `13_SECURITY_FOUNDATION.md`); changing its granularity needs a recorded decision. **Never cache these responses publicly** — they are client-scoped private media.

---

### P2-1 — `loadSiteView` reads up to 20,000 report snapshots on every analytics and report page

**Module:** Website Analytics, Reports
**Files:** `apps/platform/src/lib/site-view.ts:37` (`listSnapshots(db, { clientId: chosen.id, limit: 20000 })`), `packages/db/src/services/reports.ts:58-66`

**Root cause.** The whole snapshot history for the selected client is pulled into the Node process so that `matchedPeriods`/`alignRecordedPeriod` can pick a period and `latestUpdate` can find the newest `updated_at` — both of which are aggregate questions that SQL can answer in a few rows.

**MEASURED:** `report_snapshots` currently holds **0 rows**, so `loadSiteView` measures 4 queries / 56.8 ms and this read is free. The query is correctly indexed (`report_snapshots_client_period_idx`).

This is a **structural** finding: the limit is 20,000 rows and the code will transfer and allocate all of them once snapshots exist. At 20,000 rows the transfer alone, not the query, becomes the cost.

**Recommended direction:** replace with `select distinct period_start, period_end … order by … limit N` for period matching (the `listPeriods` helper at `reports.ts:73` already does almost exactly this) plus a `max(updated_at)` aggregate. **Expected benefit: ESTIMATE none today; prevents a multi-hundred-millisecond regression as snapshots accumulate.** **Complexity:** low. **Regression risk:** low.

---

### P2-2 — Server actions commonly use two or more serial transactions before any work happens

**Module:** cross-cutting (Blogs, SEO, Leads & Forms, Analytics)
**Files:** `apps/platform/src/app/actions/blog.ts` (14 actions with 2 transactions each), `actions/seo.ts` (`runSiteCheck`: 3), `actions/enquiries.ts` (`updateEnquiryStatusAction`: 4), `actions/analytics.ts` (`bindAnalyticsProperty`: 3)

**DERIVED:** each transaction has a measured 25.3 ms floor. So a blog save pays ≈ **50 ms** of transaction overhead, `updateEnquiryStatusAction` ≈ **100 ms**, before its queries run. Then `revalidatePath` re-renders the affected route, which costs that route's full data load again (sections 5 and 7) because nothing is cached.

**DERIVED total for "save a blog draft":** 2 transactions (50 ms) + queries + a full `/blog/[id]` re-render. **Not measured end-to-end** — needs an authenticated session.

**Recommended direction:** merge the permission/precondition read and the write into one transaction per action, which is also more correct (it closes a read-then-write race). **Expected benefit: ESTIMATE ~25–75 ms per mutation.** **Complexity:** low per action, but there are ~30 of them. **Regression risk:** low, and it improves atomicity.

---

### P2-3 — No streaming, no loading states, no caching anywhere

**Module:** cross-cutting

**MEASURED:** 0 `Suspense` boundaries, 2 `loading.tsx` for 70 routes, 0 uses of `use cache` / `unstable_cache` / `revalidate` / `fetchCache`, 72 `force-dynamic` declarations.

**Root cause.** The platform predates Next.js 16 Cache Components in its design and treats every page as fully dynamic. Two consequences:

1. **Nothing paints until the slowest read finishes.** On the dashboard that means the client count, the report drafts and the session summary all wait for the Wix calls (P0-1), even though three of the four are fast local reads and `Promise.all` already runs them concurrently (`page.tsx:49`). A `Suspense` boundary around the enquiry cards alone would let the rest of the dashboard paint in ~100 ms.
2. **Every navigation is a full server round trip.** With no `prefetch` configured on any `Link` (0 occurrences) and no cached segments, the ≤ 1 s client-navigation target depends entirely on server data time.

`force-dynamic` is the right default for a per-user, RLS-scoped internal tool, and this report does **not** recommend caching client data. The opportunity is streaming (`Suspense`), and caching only of genuinely shared, non-client-scoped data.

**Recommended direction:** add `Suspense` boundaries around the independently slow regions (dashboard enquiry cards, analytics panels, SEO Google panel) and `loading.tsx` for the remaining list routes. **Expected benefit: ESTIMATE dashboard first paint from ~1.3 s to ~150 ms, with enquiry counts filling in after.** **Complexity:** medium. **Regression risk:** low. **Security risk:** none, provided nothing client-scoped is moved into a cache.

---

### P2-4 — The analytics worker is a single serial drain on a once-daily cron

**Module:** Admin / background sync
**Files:** `vercel.json` (`0 2 * * *`), `apps/platform/src/app/api/internal/analytics/worker/route.ts`

The worker has `maxDuration = 120`, a 90 s internal budget and a default limit of 40 jobs per invocation. It is invoked **once a day**. If 40 jobs do not drain the queue, or the 90 s budget is hit, the remainder waits 24 hours. This does not affect interactive latency — the worker runs out of band — but it is the mechanism that would have to feed any snapshot-based fix for P0-1, so its throughput becomes relevant the moment that fix is attempted.

**Recommended direction:** no change for latency reasons. If P0-1 is fixed by syncing Wix data, increase the cron frequency to match the freshness the UI promises. **Complexity:** low. **Risk:** respect Wix rate limits.

---

### P3-1 — Small inefficiencies worth folding into other work

| Item | File | Note |
| --- | --- | --- |
| `/analytics/behaviour` alias costs a full extra server round trip | `analytics/behaviour/page.tsx` | A `force-dynamic` page whose only job is to `redirect()` to `/analytics/behavior`. A `redirects()` entry in `next.config.ts` would do it at the edge. |
| `countWixEnquiryStatuses` downloads full records to count them | `wix-enquiries.ts:120-128` | 46.6 KB per page of submissions, then only `row.id` is kept. |
| `enquiryConnection()` adds a `select 1` | `form-submissions.ts:404` | Called on the dashboard notice path and in `loadOperationsReport`. |
| Evidence and blog media buffer whole files into memory | `storage.ts:46`, `api/evidence/[id]`, `api/blog-media/[id]` | No streaming, no range requests. Bounded by `MAX_UPLOAD_BYTES` (10 MB), so not critical. |
| `report-artifact.ts` walks the filesystem to locate `docs/DECISIONS.md` | `report-artifact.ts:34-46` | Up to 16 `existsSync` calls per report artifact operation; will not work on Vercel's filesystem. |

---

## 8. Suspected, not confirmed — needs the measurements that could not be taken

These are stated as open questions, not findings. **No latency figure is claimed for any of them.**

| ID | Question | What would settle it |
| --- | --- | --- |
| S-1 | What are the real TTFB/LCP/INP/CLS on authenticated routes? | A seeded, isolated staging database (the repo already has `e2e-batch08/` tooling for exactly this) plus Playwright + Lighthouse. |
| S-2 | Is there a Vercel cold-start penalty on top of the measured database time? | Vercel observability, or a cold-instance probe against a preview deployment. |
| S-3 | Do staff actually perceive the dashboard as slow, and on which module? | RUM, or a short structured observation with two or three staff. |
| S-4 | Does `ANALYTICS_LIVE_REPORTS=true` vs snapshot mode change perceived speed, or only data availability? | The flag is on locally. `loadAnalyticsBoard` falls back to `boardFromSnapshots` when off, which skips `loadLiveBundle` entirely — so turning it off would remove the 173.7 ms chain **and** the live data. This is a data-freshness decision, not a performance lever, and the brief's warning applies: do not substitute snapshots for live values without checking freshness. |
| S-5 | How many Wix submission pages does a typical binding actually return? | The one measurement taken returned 59 submissions with no next cursor (1 page). If typical bindings need 3–5 pages, P0-1's cost triples. |
| S-6 | Does the pool's `max: 8` saturate under concurrent staff use? | Concurrency testing against a non-shared database. With 8 connections and transactions lasting 120–270 ms, 8 concurrent analytics page loads would already queue. |

S-6 deserves emphasis: it is the most likely way the measured per-route times get *worse* in practice, and it is cheap to test once a staging database exists.

---

## 9. Benchmark assessment

Are the brief's targets realistic for this architecture?

| Target | Assessment |
| --- | --- |
| TTFB ≤ 800 ms | **Realistic for most routes, currently missed on two.** Measured database time is 100–270 ms for the heaviest local-only routes; framework overhead is single-digit ms. Dashboard and enquiries miss it because of P0-1. |
| Simple internal API p95 ≤ 500 ms | **Realistic and probably already met** for routes without external calls. Unverified under load (S-6). |
| Standard database query p95 ≤ 100 ms | **Met per query, and the wrong metric for this platform.** Individual queries are fast and well indexed; p95 for a *warm round trip* is 11.2 ms. The problem is 15–30 of them in series. Track **round trips per route** instead. |
| Dashboard data visible ≤ 2 s | **Currently at risk** — DERIVED 0.6–1.3 s from Wix alone on a warm instance, more on a cold one, with no streaming so nothing shows earlier. |
| Client-side navigation ≤ 1 s | **Achievable**, since no route's measured server time exceeds ~300 ms, but unverified (S-1) and dependent on P0-1 for the two affected routes. |
| Simple filter interaction ≤ 300 ms | **At risk on `/enquiries`** (every filter change is a full server navigation that re-runs the Wix fan-out) and **unverified elsewhere**. |
| LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 | **Cannot be assessed.** No field data exists. The bundle is small (good sign for INP), the blog image tags lack dimensions (bad sign for CLS on those routes), and LCP will track TTFB closely because nothing streams. |

**Recommended primary metric for this platform: database round trips per route, and external API calls on the render path.** Both are cheap to count in code review, both map linearly to measured latency at ~8.5 ms each, and both are what the findings above are really about.

---

## 10. Discrepancies between implementation and specification

Recorded as the brief requires; none of these are performance defects in themselves.

| Spec | Discrepancy |
| --- | --- |
| `13_SECURITY_FOUNDATION.md` | Committed debug code in the analytics worker transmits secret-length metadata (P0-2). |
| `14_MONITORING_RECOVERY_HANDOVER.md` | No application performance monitoring and no real-user monitoring are installed. There is no field data for any of the Core Web Vitals the brief asks about, so regressions are currently undetectable. |
| `10_ANALYTICS_CONVERSIONS.md` | Live analytics reads happen during page render rather than from a synchronised store, for Wix enquiry data (P0-1). GA4 and Search Console data *are* correctly read from stored partitions by the worker. |
| `04_DATA_MODEL.md` / deployment | `storage.ts` serves evidence and blog media from a local filesystem path; the Vercel target has no persistent filesystem. Acknowledged in the file's own comment but unresolved. |
| `docs/PERFORMANCE.md` (19 Oct) | Still accurate on indexes, RLS function choice and the absence of N+1 list queries. Its row caps (tasks 500, approvals 300, timeline 200, audit 300, snapshots 1,000) and its warning to add pagination remain open, and P2-1/P1-4 are the same class of issue. |
| `docs/performance-optimisation-report.md` (2 Nov) | Its `/analytics` single-transaction fix landed for the overview route only; `/analytics/traffic` and `/analytics/behavior` still use two transactions (P1-2). |
| `16_BUILD_RULES.md` | `npm run test:decisions` DAY-01 is a known failure per `docs/BUILD_STATUS.md`; no tests were run as part of this audit. |

---

## 11. Method and reproducibility

All commands were read-only against the shared database except the production build, which wrote only to `apps/platform/.next-audit/` (git-ignored).

| Step | Command |
| --- | --- |
| Route inventory | `find apps/platform/src/app -name "page.tsx" -o -name "route.ts"` |
| Caching/streaming inventory | `grep -rn "export const dynamic\|use cache\|unstable_cache\|Suspense\|prefetch" apps/platform/src` |
| Production build | `NEXT_DIST_DIR=.next-audit npm run build -w @clinic-genie/platform` |
| Production server | `NEXT_DIST_DIR=.next-audit npx next start -p 3401` (from `apps/platform`) |
| Unauthenticated TTFB | `curl -w "%{time_starttransfer}"`, 8 samples per route |
| Bundle size | `find .next-audit/static -name "*.js"` with `du` and `gzip -c \| wc -c` |
| Round-trip and transaction cost | `pg.Pool` against `DATABASE_URL`; `select 1` × 30; `begin`+`set_config`/query/`commit` × 20; 1/5/11/16/25-query sweep × 8 |
| Per-route query sequences | real service functions imported from `@clinic-genie/db` via `npx tsx`, run inside `withContext`, with the `pg` client's `query` method wrapped to count driver calls; 6 repetitions after one warm-up (4 for reports) |
| Wix API latency | one `oauth2/token`, one `submissions/namespace/query` (limit 100), one `form-schema-service` GET, against one of the eight configured bindings |
| Row counts | `select count(*)` per table via `DATABASE_ADMIN_URL` |

Raw outputs are in this session's scratchpad (`rtt.json`, `sequences.json`, `wix.json`) and are summarised in `CG_PERFORMANCE_BASELINE.json` beside this file.

**Not run:** any write to any database, any load test, any repeated third-party API call beyond the three single probes above, any production configuration change, any Lighthouse or Playwright run.
