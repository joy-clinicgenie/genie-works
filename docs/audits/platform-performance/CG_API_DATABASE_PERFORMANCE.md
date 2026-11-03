# API, database and integration performance

Date: 3 November 2026 · Commit `a54d6de` · Companion to `CG_LATENCY_AUDIT_REPORT.md`

---

## 1. The cost model

Everything in this document reduces to three measured constants.

| Constant | MEASURED | n | Method |
| --- | --- | --- | --- |
| Warm database round trip | p50 **8.2 ms**, p95 11.2 ms, min 7.5, max 18.0 | 30 | `select 1`, warm pooled connection, `DATABASE_URL` |
| Enquiry database warm round trip | p50 **8.0 ms**, p95 15.4 ms | 20 | `select 1`, `ENQUIRY_DATABASE_URL` |
| Cold connection + first query | p50 **75.2 ms**, max **516.5 ms** | 5 | fresh `pg.Pool`, connect, one query |
| Empty staff RLS transaction | p50 **25.3 ms**, p95 34.8 ms | 20 | `begin`+`set_config` bundled, one query, `commit` |
| Marginal cost per extra query in a transaction | **≈ 8.5 ms** | — | DERIVED from the sweep below |

Query-count sweep inside one transaction (MEASURED, n=8 each):

| Queries | p50 | p95 | Implied marginal |
| --- | --- | --- | --- |
| 1 | 23.9 ms | 26.2 ms | — |
| 5 | 58.4 ms | 74.4 ms | 8.6 ms |
| 11 | 106.2 ms | 110.3 ms | 8.0 ms |
| 16 | 146.6 ms | 157.3 ms | 8.1 ms |
| 25 | 227.6 ms | 248.7 ms | 9.0 ms |

**Perfectly linear.** Nothing pipelines or batches. `node-postgres` runs one statement at a time per checked-out client, and the codebase deliberately serialises reads for that reason (`seo-workspace.ts:352`, `seo-soft-launch.ts`). The practical rule for this platform:

> **route latency ≈ 25 ms × transactions + 8.5 ms × queries + external API time**

Note the local-to-Neon round trip measured here (8.2 ms) is the same order as the 9–10 ms the 2 November report measured **from Vercel `sin1`**. The pooler round trip, not geography, is the floor. There is no cross-region penalty to fix: functions are in `sin1`, Neon is in `ap-southeast-1`.

---

## 2. Database access layer

| Property | Finding |
| --- | --- |
| ORM | None. Hand-written SQL throughout `packages/db/src/services/*.ts`. |
| Pooling | One module-level `pg.Pool` per process. `max: 8`, `connectionTimeoutMillis: 10_000`, `idleTimeoutMillis: 60_000`, `allowExitOnIdle`. Correct — no pool-per-request. |
| Transaction wrapper | `withContext(ctx, fn)` — `begin` + three `set_config` calls in **one** network message, then the work, then `commit`. 3 round trips minimum. Already optimised. |
| RLS | Two roles. App always uses `cg_app` (`nobypassrls`). Policies read `app.context` / `app.user_id` / `app.platform_role`. |
| Type parsing | `date` → `YYYY-MM-DD` string, `numeric` → `Number`. Correct for the Asia/Singapore day-boundary rule (D8). |
| Indexes | 74 across 69 tables. No missing index identified on any path this audit inspected. |
| Auth adapter | Custom `getSessionAndUser` override joins `sessions` and `users` in one query (down from the official adapter's two). Already optimised. |

### Pool saturation is the main untested risk

`max: 8` with transactions lasting 120–270 ms on analytics, SEO and report routes. **DERIVED:** nine concurrent analytics page loads would queue on connection acquisition; at 10 concurrent sessions the 10 s acquisition timeout is still far off, but added latency would be roughly linear past 8. **NOT MEASURED** — concurrency testing needs an isolated database. This is the cheapest high-value follow-up test once `e2e-batch08` tooling is pointed at a seeded database.

---

## 3. Measured server paths, by query count

Run against the real database through the real service functions inside `withContext`, with the `pg` client wrapped to count driver calls. 6 repetitions after one warm-up (4 for reports).

| Path | Driver queries | Round trips | p50 | p95 | Finding |
| --- | --- | --- | --- | --- | --- |
| `getAccess()` | 2 | 4 | 35.1 ms | 51.0 ms | `cache()`d per request — correct |
| `(app)/layout.tsx` registry | 2 | 4 | 34.2 ms | 39.7 ms | duplicated by pages — P1-5 |
| `loadSiteView()` | 4 | 6 | 56.8 ms | 65.7 ms | includes `limit: 20000` read — P2-1 |
| `loadSeoOverview()` | **11** | 13 | 121.3 ms | 135.0 ms | P1-3 |
| `loadLiveBundle()` GA4 | **15** | 17 | 173.7 ms | 191.6 ms | P1-1 |
| `composeReport()` uncompared | **20** | 22 | 214.1 ms | 230.5 ms | P1-6 |
| `composeReport()` compared | **28** | 30 | 265.3 ms | 280.6 ms | P1-6 |

### Why `loadLiveBundle` is 15 queries

`publishedReport()` (`packages/db/src/analytics/read.ts:30-84`) is **always two queries**:

1. `select … from analytics_report_partitions where client_id=$1 and website_id=$2 and template_key=$3 and start_date=$4 and end_date=$5 and published order by generation desc limit 1`
2. `select r.dimension_key, r.dimensions, m.metric_key, m.value_numeric, m.value_state from analytics_report_rows r join analytics_metric_values m on m.report_row_id = r.id where r.partition_id = $1 order by …`

`loadLiveBundle` calls it 7 times per render and `dailySessionSeriesWithPeriod` twice = 15 queries. Five of the seven are written inside a returned object literal (`live-analytics.ts:102-107`), which *looks* parallel and is not.

Both queries are correctly indexed (`analytics_partitions_lookup_idx`, `analytics_report_rows_partition_idx`). **The problem is the count, not the plan.** Collapsing the pair into one lateral-join statement and fetching template keys with `template_key = any($n)` would take 17 round trips to 4–6. **ESTIMATE: saves ~90–110 ms per analytics page load.**

### Why `composeReport` is 20–28 queries

`report-builder.ts:118-215` runs 13 independent scalar queries in sequence — snapshot rows, blog published/existing counts, blog titles (`limit 8`), SEO content statuses, SEO mapping flags (`limit 12`), business profiles, completed tasks (`limit 12`), open tasks (`limit 8`), issues (`limit 12`), SEO changes (`limit 8`), ads changes (`limit 8`), approvals (`limit 8`). Then `loadAnalytics` (`report-builder.ts:223-231`) loops over **8** `ANALYTICS_TEMPLATES` calling `publishedReport` — 16 queries — and runs the whole loop **twice** when a comparison period is set.

Several of the scalar queries are `select <title> from <table> where client_id … limit N` over different tables and could be a single `union all`. **ESTIMATE: 30 round trips → 8–10, saving ~170–190 ms.**

Caution: report snapshots are append-only and corrections supersede rather than overwrite (D9). Any batching must leave the composed values byte-identical. The existing report tests are the gate.

---

## 4. Confirmed database-layer defects

### 4.1 Duplicated identical query — `listEnquiryBoard`

`apps/platform/src/lib/form-submissions.ts`, `listProduction` is hard-coded `true`:

- line 713: `const countWhere = enquiryWhere(scope, filters, currentDates, listProduction);` → executed
- line 743: `const productionWhere = enquiryWhere(scope, filters, currentDates, true);` → executed

Same arguments → same SQL → same parameters → **two identical `count(*)` queries per page load**. The second overwrites `currentTotal` with the same number. **≈ 8 ms wasted per `/enquiries` load and per export.** Confirmed by reading the code; the function is 6 sequential enquiry-database queries in total (list, count, clinics, websites, duplicate count, grouped breakdown).

### 4.2 Pagination abandoned when any Wix binding exists

`form-submissions.ts:692`:

```
const sqlPaging = wix.configured ? { limit: null, offset: 0, page: paging.page } : paging;
```

8 bindings are configured, so `limit` is always `null` and **every matching enquiry row is fetched**, so Wix rows and database rows can be merged and sorted in JavaScript. `ENQUIRY_PAGE_SIZE` is 25. The external `enquiries` table currently holds **0 rows**, so the cost today is zero — this is unbounded by construction, not by observation.

Second unbounded path: the enquiries page passes `page: "all"` whenever the handling filter is set, because handling lives in this platform's `enquiry_reads` table and cannot be filtered at the source. `/enquiries/export` passes `page: "all"` unconditionally (acceptable for an export, noted for completeness).

### 4.3 Unbounded snapshot read — `loadSiteView`

`apps/platform/src/lib/site-view.ts:37`: `listSnapshots(db, { clientId: chosen.id, limit: 20000 })`.

The whole snapshot history for a client is transferred to Node so that `matchedPeriods`/`alignRecordedPeriod` can choose a period and `latestUpdate` can find the newest `updated_at`. Both are aggregate questions. `report_snapshots` = **0 rows** today. `listPeriods` (`reports.ts:73`) already implements the `select distinct period_start, period_end` form that would replace most of it.

### 4.4 Over-fetch-then-filter in the SEO bundle

`apps/platform/src/lib/seo-workspace.ts:351-364` loads, then `websiteSeoBundle` filters in JavaScript:

| Loaded | Filtered to | Where |
| --- | --- | --- |
| `listSeoPages({clientId})` — all client pages | pages for the selected website | `seo-workspace.ts:367` |
| `listSeoChanges({clientId, limit: 100})` | changes whose `seo_page_id` is in the selected set | `seo-workspace.ts:373` |
| `listTasks({clientId, statuses: all, limit: 300})` | `related_type in ('seo_page','seo_change')` | `seo-workspace.ts:374` |

`unassignedPages` is derived from the *unfiltered* page set, so the full read is not purely wasteful — but the website filter and the task `related_type` filter both belong in SQL. `seo_pages` and `tasks` are at **0 rows** today.

### 4.5 Serial transactions where one would do

| Path | Transactions | Avoidable overhead |
| --- | --- | --- |
| `/seo` — `loadSeoOverview` then `loadSearchPerformance` | 2 | ~17 ms + connection checkout |
| `/analytics/traffic`, `/analytics/behavior` | 3 | ~20 ms (P1-2) |
| Every `/seo/*` sub-page — context then tab data | 2 | ~17 ms |
| `GET /api/blog-media/[id]` — lookup then audit | 2 | ~25 ms **per image** |
| `GET /api/evidence/[id]` | 1 | correct — lookup and audit share one transaction |
| 14 blog server actions | 2 each | ~25 ms per mutation |
| `updateEnquiryStatusAction` | **4** | ~75 ms per mutation |
| `runSiteCheck`, `bindAnalyticsProperty` | 3 each | ~50 ms per mutation |

`/api/evidence/[id]` is the correct pattern and shows the fix is straightforward: do the permission read and the audit write in the same `staffTx` callback.

### 4.6 No N+1 queries were found in list rendering

Checked explicitly. Every list page runs one query per table and shapes rows in JavaScript. `docs/PERFORMANCE.md` reached the same conclusion on 19 October against a 5–10× load seed. The loops that do contain `await` are template loops (`report-builder.ts:226` over 8 template keys, `report-artifact.ts:36` over filesystem candidates), not per-row loops.

---

## 5. API route and server action inventory

18 route handlers. **p50/p95/p99 under real traffic: NOT MEASURED** — no request telemetry is collected anywhere in the platform, and Vercel observability was not queried.

### Measured (unauthenticated, production build, 8 samples)

| Endpoint | First | Warm p50 | Notes |
| --- | --- | --- | --- |
| `GET /api/auth/session` | 3.7 ms | ~2.4 ms | no-cookie path, no database hit |
| `GET /api/auth/providers` | 2.5 ms | ~1.8 ms | static |
| `GET /api/auth/csrf` | 2.9 ms | ~1.7 ms | static |
| `GET /api/internal/operations/status` | 7.2 ms | ~1.8 ms | 401 rejection path |

With a session cookie, `GET /api/auth/session` becomes one service transaction — **DERIVED ≈ 25 ms** — and Auth.js calls it on every client-side session read.

### Reviewed from code

| Endpoint | Txns | External | Finding |
| --- | --- | --- | --- |
| `GET/POST /api/internal/analytics/worker` | many (drain loop) | GA4, GSC, Wix, PageSpeed | **P0-2: committed debug `fetch` to `127.0.0.1:7835` transmitting secret lengths, executed before the authorisation check.** `maxDuration: 120`, 90 s budget, 40 jobs default, invoked once daily at 02:00. |
| `GET /api/blog-media/[id]` | **2** + audit write | none | P1-7. `no-store`, whole file buffered. ~50 ms + 1 audit row **per image per view**. |
| `GET /api/evidence/[id]` | 1 | none | Correct transaction shape. Whole file buffered; bounded by 10 MB. |
| `GET /api/public/seo/[websiteId]` | 1 service txn | none | Bearer-token read-only API (D12). Correct `503` + `Retry-After: 10`. `private, no-store` — correct for per-site config but means connected websites re-fetch on every request. A short `max-age` with the token in the path would be worth discussing. |
| `GET /api/public/blog/[websiteId]` + 4 sub-routes | 1 service txn each | none | Same shape. Sitemap route is the one most likely to want caching. |
| `GET /api/analytics/export` | 1 | none | — |
| `GET /api/analytics/google/start` · `/callback` | 3 (callback) | Google OAuth | Interactive, infrequent. |
| `GET /api/auth/[...nextauth]` | 1–2 per call | Google | Adapter already optimised. |
| `GET /enquiries/export` | 3 | **8 Wix bindings** | `page: "all"`, unbounded. Appropriate for an export; should not share code paths with the interactive list without a bound. |
| `GET /reports/[id]/download` | 1 | none | Walks up to 16 parent directories for `docs/DECISIONS.md`; filesystem-dependent. |
| `GET /reports/[id]/serial` · `/reports/breakdown/[kind]/download` | 1 each | none | — |

### Caching posture

**Zero caching primitives in the entire platform:** no `use cache`, no `unstable_cache`, no `revalidate`, no `fetchCache`, no ISR. 72 `force-dynamic` declarations. Every `Cache-Control` header emitted is `private, no-store`.

For per-user, RLS-scoped internal pages that is the correct default and this audit does **not** recommend caching client data. Two narrow exceptions worth evaluating: content-addressed blog media (immutable once written), and the public blog sitemap route.

---

## 6. External integrations

| Integration | Where it runs | Blocks render? | Cached? |
| --- | --- | --- | --- |
| **Wix Forms** (enquiries) | `apps/platform/src/lib/wix-enquiries.ts`, called from `/`, `/enquiries`, `/enquiries/[id]`, `/enquiries/export` | **Yes** | Token only, in a per-process `Map`. Responses: `cache: "no-store"`. |
| **GA4** | analytics worker → `analytics_report_partitions` | No | Read from stored partitions. Correct. |
| **Google Search Console** | analytics worker → `analytics_report_partitions` | No | Read from stored partitions. Correct. |
| **Wix Analytics** | analytics worker → `wix.data_daily` partitions | No | Read from stored partitions. Correct. |
| **PageSpeed** | analytics worker | No | Stored in `seo_speed_checks`. Correct. |
| **Google Business Profile** | not implemented — internal branch references only (`seo_business_profiles.setup_status`) | n/a | n/a |

**GA4, Search Console, Wix Analytics and PageSpeed are architected correctly**: the worker fetches, the database stores, the pages read. `10_ANALYTICS_CONVERSIONS.md` is satisfied for those four.

**Wix Forms is the exception** and is the platform's single worst latency source.

### Measured Wix Forms API latency

One token call, one submissions page, one form-schema call, against one of the eight configured bindings — exactly the traffic of a single staff page view for one binding. Not repeated, to respect rate limits.

| Call | MEASURED | Result |
| --- | --- | --- |
| `POST /oauth2/token` | **731 ms** | 200 |
| `POST /form-submission-service/v4/submissions/namespace/query` (`cursorPaging.limit: 100`) | **526 ms** | 200 · 59 submissions · 46.6 KB · no next cursor |
| `GET /form-schema-service/v4/forms/{id}` | **1,013 ms** | 200 |

### How the code multiplies that

`apps/platform/src/lib/wix-enquiries.ts`:

| Property | Value |
| --- | --- |
| Bindings configured | 8 (7 with `wix_counts_in_totals = true`) |
| Fan-out | `Promise.all` across bindings — parallel, good |
| Pagination within a binding | **sequential**, `MAX_PAGES = 5` (line 285) |
| Per-request timeout | 15 s (line 368) |
| Response caching | none — `cache: "no-store"` (line 367) |
| Token caching | module-level `Map`, per warm process (line 328) |
| Kill switch | **none.** `wixReadsAllowed()` (line 174) is only `!VITEST && ANALYTICS_FIXTURE_MODE !== "1"` |
| Retry loop | none — a failure returns partial rows and a notice. Correct; no retry storm. |
| Counting method | downloads whole submission records, then keeps only `row.id` (lines 117-128) |

**DERIVED critical-path cost:**

| Caller | Fan-out | Per-binding worst branch | Added latency |
| --- | --- | --- | --- |
| Dashboard (`countWixEnquiryStatuses`) | 7 parallel | 1 page = 526 ms | **≈ 0.6 s** warm |
| Dashboard, cold instance | 7 parallel | token 731 + page 526 | **≈ 1.3 s** |
| `/enquiries` (`loadWixEnquirySlice`) | 8 parallel | max(schema 1,013, current 526×n, previous 526×n) | **≈ 1.1 s** (n=1) to **1.6 s** (n=3) |
| Code's allowed worst case, per binding | — | 5 pages × 15 s timeout, current **and** previous | **75 s + 75 s** |

**Identical date ranges trigger repeated requests** (no response cache). **Switching clients re-fetches everything** (no cache, and the clinic filter is applied after the fetch for the board). **Failures do not retry** — the one thing the integration gets right.

### `ANALYTICS_LIVE_REPORTS`

`ANALYTICS_LIVE_REPORTS=true` locally. When off, `loadAnalyticsBoard` returns `boardFromSnapshots(view)` and never calls `loadLiveBundle` — so turning it off removes the measured 173.7 ms chain **and the live data with it**.

This is a **data-availability flag, not a performance flag.** The brief asks whether missing records or stale snapshots are being mistaken for latency: in this platform they are distinguishable, because `loadLiveBundle` returns explicit `available` / `unavailable` / `not_connected` states with notes like `"{covered} of {expected} days recorded"`, and the UI renders them. Analytics slowness is real round trips (P1-1), not a data-availability artefact. Do not flip this flag for speed.

---

## 7. Recommended improvements, by expected benefit

All benefits are ESTIMATES unless marked MEASURED. None has been applied.

| # | Change | Expected benefit | Complexity | Regression risk | Security risk |
| --- | --- | --- | --- | --- | --- |
| 1 | Delete the debug `fetch` in the analytics worker (P0-2) | none (correctness/security) | trivial | none | **removes a secret-metadata leak** |
| 2 | Move Wix Forms reads off the render path; add a kill switch (P0-1) | **−0.6 to −1.6 s** on `/` and `/enquiries` | high | medium | low if clinic scoping and the no-copy-of-message rule are preserved |
| 3 | `Suspense` around dashboard enquiry cards (P2-3) | dashboard first paint ~1.3 s → **~150 ms** | medium | low | none |
| 4 | Collapse `publishedReport` to one query; batch template keys (P1-1) | **−90 to −110 ms** per analytics load; also helps reports | medium | low | none |
| 5 | `cache()` the client registry (P1-5) | **−34 ms** on dashboard and every `/seo/*` page | **low** | low | none |
| 6 | Batch `composeReport`'s 13 scalar queries (P1-6) | **−170 to −190 ms** per report | medium–high | medium (D9 append-only) | none |
| 7 | Delete the duplicate count in `listEnquiryBoard` (4.1) | **−8 ms** per `/enquiries` load | **trivial** | none | none |
| 8 | Start the Wix slice concurrently with enquiry-DB reads (P1-4) | **−0.5 to −1 s** on `/enquiries` | medium | medium | none |
| 9 | One transaction per server action (P2-2) | −25 to −75 ms per mutation | low × ~30 sites | low (improves atomicity) | none |
| 10 | Share one transaction on `/analytics/traffic` and `/behavior` (P1-2) | −20 ms | low | low | none |
| 11 | Push SEO website/task filters into SQL (P1-3, 4.4) | ~0 today; removes unbounded reads | medium | medium | none |
| 12 | Replace `listSnapshots(limit: 20000)` with aggregates (P2-1, 4.3) | ~0 today; prevents a future regression | low | low | none |
| 13 | Combine blog-media lookup + audit; content-addressed immutable URLs; `width`/`height` on `<img>` (P1-7) | −25 ms and −1 audit row per image; removes repeat fetches | medium | medium (audit granularity needs a D-series decision) | **never cache publicly — client-scoped private media** |
| 14 | `redirects()` for `/analytics/behaviour` (P3-1) | −1 server round trip | trivial | none | none |
| 15 | Count Wix submissions without downloading records (P3-1) | −46.6 KB per page per binding | medium | low | none |
| 16 | Install RUM / request telemetry (section 10 of the main report) | makes every target above measurable | medium | none | must not log lead or patient data |

### Explicitly not recommended

- **Do not cache client-scoped page data.** `force-dynamic` with per-request RLS is correct for this platform.
- **Do not remove tenant filters, membership checks or RLS** to reduce query cost. The per-row `app_has_membership` probe was already measured and chosen over two alternatives in `docs/PERFORMANCE.md`; that conclusion stands.
- **Do not revisit the RLS helper-function shape.** Measured and settled on 19 October.
- **Do not add indexes speculatively.** None were found missing.
- **Do not switch `ANALYTICS_LIVE_REPORTS` off for speed.** It changes what data staff see.
- **Do not reduce `pool.max` below 8**, and test before raising it — Neon's pooled endpoint has its own limits.
