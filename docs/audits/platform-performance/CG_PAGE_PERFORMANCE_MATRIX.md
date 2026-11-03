# Page performance matrix

Date: 3 November 2026 · Commit `a54d6de` · Companion to `CG_LATENCY_AUDIT_REPORT.md`

## Reading this matrix

**Browser metrics are absent from this matrix on purpose.** No authenticated browser session could be created in this environment (dev magic links are disabled because `.env` points at the shared Neon database; direct session creation was refused; Google OAuth needs interactive consent). So FCP, LCP, INP, CLS, client-navigation duration, request counts and hydration cost are **NOT MEASURED** for every authenticated route. Inventing them would be worse than leaving them out.

What the matrix does give, for every one of the 70 page routes:

- **Txns** — how many separate database transactions the route opens (each has a MEASURED 25.3 ms floor).
- **Queries** — driver calls on the critical path. Exact where measured, `~` where read from code.
- **External** — third-party API calls on the render path.
- **Server data time** — MEASURED where a sequence was benchmarked, DERIVED (txns × 25.3 ms + queries × 8.5 ms) otherwise.
- **Status** — against the ≤ 800 ms TTFB target, counting server data time only.

Shared cost on **every** authenticated route, added to every row below:

| Component | Txns | Queries | MEASURED |
| --- | --- | --- | --- |
| `getAccess()` (React `cache()`d per request) | 1 | 2 | 34.2 ms |
| `(app)/layout.tsx` client registry (full loads only) | 1 | 2 | 35.1 ms |
| **Shared total** | **2** | **4** | **≈ 69 ms** |

Mobile vs desktop: **no difference exists server-side.** These are server-rendered routes with no device-conditional data loading, no responsive image sources and one CSS bundle. Device-dependent metrics (LCP, INP, CLS) are the ones that could not be measured. Recorded as NOT MEASURED rather than "same".

---

## Agency Overview

| Route | Txns | Queries | External | Server data time | Status |
| --- | --- | --- | --- | --- | --- |
| `/` | 5–6 | ~10 | **7 Wix bindings** | **0.7–1.4 s** DERIVED | ❌ fails target |

Breakdown (DERIVED from measured parts): shared 69 ms + registry txn ~35 ms + `Promise.all` of four loaders, whose slowest branch is `dashboardEnquiryCounts` → `countWixEnquiryStatuses` = bindings txn (25) + 7 parallel bindings × ≥1 submissions page (**MEASURED 526 ms**) + follow-up statuses txn (25) ≈ 580 ms warm, ≈ 1,310 ms on a cold instance where the OAuth token is not yet cached (**MEASURED 731 ms**).

Nothing paints before this completes: no `Suspense`, no `loading.tsx`. See P0-1, P1-5, P2-3.

---

## Website Analytics

| Route | Txns | Queries | External | Server data time | Status |
| --- | --- | --- | --- | --- | --- |
| `/analytics` | 2 | **19** | none | **≈ 245 ms** | ✅ within target |
| `/analytics/traffic` | **3** | **19** | none | **≈ 265 ms** | ✅ within target |
| `/analytics/behavior` | **3** | **19** | none | **≈ 265 ms** | ✅ within target |
| `/analytics/behaviour` | 0 | 0 | none | redirect only | ⚠️ wasted round trip |

`/analytics` MEASURED: `loadSiteView` (4 queries) + `loadLiveBundle` (15 queries) share one transaction = 19 queries / 21 round trips / **173.7 ms p50, 191.6 ms p95**; plus shared 69 ms.

`/analytics/traffic` and `/analytics/behavior` split the same work across two transactions (P1-2): `loadSiteView` **56.8 ms** then `loadAnalyticsBoard` in a second transaction **≈ 174 ms**.

`/analytics/behaviour` is a `force-dynamic` page that only calls `redirect()`. Belongs in `next.config.ts` `redirects()`.

`loadSiteView` includes `listSnapshots(limit: 20000)` — free today (`report_snapshots` = 0 rows), unbounded later (P2-1).

---

## SEO Performance and SEO Management

Every route here calls `loadSeoContext` (2–3 queries, including a **duplicate** `listShellClients` the layout already ran — P1-5), then opens a **second** transaction for its own tab data.

| Route | Txns | Queries | External | Server data time | Status |
| --- | --- | --- | --- | --- | --- |
| `/seo` | **3** | **13** | none | **≈ 232 ms** | ✅ within target |
| `/seo/settings` | 2 | ~12 | none | ~190 ms DERIVED | ✅ |
| `/seo/pages` | 2 | ~5 | none | ~120 ms DERIVED | ✅ |
| `/seo/pages/[id]` | 2 | ~7 | none | ~135 ms DERIVED | ✅ |
| `/seo/checklist` | 2 | ~11 | none | ~180 ms DERIVED | ✅ |
| `/seo/site-health` | 2 | ~4 | none | ~110 ms DERIVED | ✅ |
| `/seo/redirects` | 2 | ~4 | none | ~110 ms DERIVED | ✅ |
| `/seo/reports` | 2 | ~4 | none | ~110 ms DERIVED | ✅ |
| `/seo/tasks` | 2 | ~4 | none | ~110 ms DERIVED | ✅ |
| `/seo/ai-visibility` | 2 | ~3 | none | ~100 ms DERIVED | ✅ |
| `/seo/business-profile` | 2 | ~4 | none | ~110 ms DERIVED | ✅ |
| `/seo/business-profiles` | 2 | ~4 | none | ~110 ms DERIVED | ✅ |
| `/seo/new` | 2 | ~4 | none | ~110 ms DERIVED | ✅ |

`/seo` MEASURED: `loadSeoOverview` 11 queries / 13 round trips / **121.3 ms p50, 135.0 ms p95**, then `loadSearchPerformance` in its own transaction (2 queries ≈ 42 ms), plus shared 69 ms.

`/seo/site-health` loads its tab data conditionally (`tab === "indexing"` / `"speed"`), which is good practice and the reason its query count is low.

Volume trap across this module: `listSeoPages({clientId})` and `listTasks({limit: 300})` load unfiltered and filter in JavaScript. `seo_pages` and `tasks` are both at 0 rows today (P1-3).

---

## Leads & Forms

| Route | Txns | Queries | External | Server data time | Status |
| --- | --- | --- | --- | --- | --- |
| `/enquiries` | 4–5 | **6 enquiry DB + ~4 platform** | **8 Wix bindings** | **1.2–1.7 s** DERIVED | ❌ fails target |
| `/enquiries?handling=…` | 4–5 | same, **unpaginated** | 8 Wix bindings | **1.2–1.7 s +** unbounded | ❌ fails target |
| `/enquiries/[id]` | 3 | ~4 | 1 binding (detail) | ~0.6 s DERIVED | ⚠️ at risk |
| `/enquiries/notifications` | 2 | ~3 | none | ~100 ms DERIVED | ✅ |
| `/enquiries/export` | 3 | **unpaginated (`page: "all"`)** | 8 Wix bindings | unbounded | ⚠️ export, not interactive |
| `/forms` | 2 | ~3 | none | ~100 ms DERIVED | ✅ |
| `/forms/[id]` | 2 | ~3 | none | ~100 ms DERIVED | ✅ |

`/enquiries` DERIVED: shared 69 ms + `loadWixEnquirySlice` over 8 bindings, slowest branch per binding = max(form schema **MEASURED 1,013 ms**, current-period query **526 ms** × pages, previous-period query **526 ms** × pages) ≈ 1.0–1.6 s, awaited **before** any enquiry-database query starts + 6 sequential enquiry-DB round trips (~48 ms, two of them byte-identical duplicates) + `openedEnquiryIdentities` txn (25 ms).

Every filter change on this page is a full server navigation that re-runs the entire fan-out. Against the ≤ 300 ms filter-interaction target this is the worst interaction in the platform. See P0-1, P1-4.

---

## Blogs

| Route | Txns | Queries | External | Server data time | Status |
| --- | --- | --- | --- | --- | --- |
| `/blog` | 1 | ~5 | none | ~110 ms DERIVED | ✅ has `loading.tsx` |
| `/blog/[id]` | 1–2 | ~6 | none | ~130 ms DERIVED | ✅ |
| `/blog/[id]/preview` | 1–2 | ~5 | none | ~120 ms DERIVED | ✅ |
| `/blog/new` | 1 | ~4 | none | ~105 ms DERIVED | ✅ |
| `/blog/preview/[token]` | 1 | ~3 | none | ~95 ms DERIVED | ✅ |
| `GET /api/blog-media/[id]` | **2 + 1 audit write** | 3 | none | **≈ 50 ms per image** | ❌ per-image cost |

`/blog` and `/blog/[id]` are among the better-behaved routes: a single composed transaction, and `/blog` is one of only two routes in the platform with a `loading.tsx`.

The cost is in the media route: 2 transactions plus an `audit_events` insert **per image per page view**, with `Cache-Control: no-store` so nothing is reused. An article with 10 images ≈ **500 ms of database time and 10 audit rows on every view** (P1-7). Images also render as bare `<img>` with no dimensions — **CLS impact NOT MEASURED**, precondition confirmed.

---

## Reports

| Route | Txns | Queries | External | Server data time | Status |
| --- | --- | --- | --- | --- | --- |
| `/reports` | 1 | ~4 | none | ~105 ms DERIVED | ✅ |
| `/reports/new` | 2 | **20–28** | none | **≈ 285–335 ms** | ✅ within target |
| `/reports/[id]` | 1–2 | ~6 | none | ~130 ms DERIVED | ✅ |
| `/reports/[id]/print` | 1–2 | ~6 | none | ~130 ms DERIVED | ✅ |
| `/reports/breakdown/[kind]` | 2 | ~6 | none | ~135 ms DERIVED | ✅ |
| `/reports/[id]/download` | 1 | ~3 | none | ~95 ms DERIVED + file walk | ⚠️ filesystem |
| `/reports/[id]/serial` | 1 | ~2 | none | ~90 ms DERIVED | ✅ |
| `/reports/breakdown/[kind]/download` | 1 | ~4 | none | ~105 ms DERIVED | ✅ |

Report composition MEASURED: uncompared **20 queries / 22 round trips / 214.1 ms p50**; compared **28 queries / 30 round trips / 265.3 ms p50**. The slowest single staff interaction measured in this audit. 13 scalar queries in sequence plus `publishedReport` × 8 template keys × 2 queries each, doubled when a comparison period is selected (P1-6, P1-1).

`/reports/[id]/download` resolves its artifact directory by walking up to 16 parent directories looking for `docs/DECISIONS.md` (P3-1) and will not work on Vercel's filesystem.

---

## Client Management

| Route | Txns | Queries | External | Server data time | Status |
| --- | --- | --- | --- | --- | --- |
| `/clients` | 1 | 3 | none | ~95 ms DERIVED | ✅ has `loading.tsx` + `error.tsx` |
| `/clients/[id]` | 1 | ~8 | none | ~145 ms DERIVED | ✅ |
| `/clients/[id]/profile` | 1 | ~5 | none | ~110 ms DERIVED | ✅ |
| `/clients/[id]/tasks` | 1 | ~4 | none | ~100 ms DERIVED | ✅ |
| `/clients/[id]/seo` | 1 | ~5 | none | ~110 ms DERIVED | ✅ |
| `/clients/[id]/approvals` | 1 | ~4 | none | ~100 ms DERIVED | ✅ |
| `/clients/[id]/issues` | 1 | ~4 | none | ~100 ms DERIVED | ✅ |
| `/clients/[id]/medical-review` | 1 | ~4 | none | ~100 ms DERIVED | ✅ |
| `/clients/[id]/google-ads` | 1 | ~4 | none | ~100 ms DERIVED | ✅ |
| `/clients/[id]/reports` | 1 | ~3 | none | ~95 ms DERIVED | ✅ |
| `/clients/[id]/timeline` | 1 | ~3 | none | ~95 ms DERIVED | ✅ |
| `/clients/new` | 1 | ~3 | none | ~95 ms DERIVED | ✅ |

The best-behaved module in the platform: one composed transaction per route, correct row caps. `docs/PERFORMANCE.md` measured the client overview at 9 ms server-side against a 40-client, 4,800-task load seed. Nothing here needs work.

---

## Tasks, Approvals, Issues, Medical Review, Google Ads, Timeline

| Route | Txns | Queries | External | Server data time | Status |
| --- | --- | --- | --- | --- | --- |
| `/my-tasks` | 1 | ~4 | none | ~100 ms DERIVED | ✅ |
| `/tasks/[id]` | 1 | ~6 | none | ~120 ms DERIVED | ✅ |
| `/tasks/new` | 1 | ~5 | none | ~110 ms DERIVED | ✅ |
| `/approvals` | 1 | ~4 | none | ~100 ms DERIVED | ✅ |
| `/approvals/[id]` | 1 | ~6 | none | ~120 ms DERIVED | ✅ |
| `/approvals/new` | 1 | ~5 | none | ~110 ms DERIVED | ✅ |
| `/issues`, `/issues/[id]`, `/issues/new` | 1 | ~4–6 | none | ~100–120 ms DERIVED | ✅ |
| `/medical-review`, `/medical-review/[id]`, `/medical-review/new` | 1 | ~4–6 | none | ~100–120 ms DERIVED | ✅ |
| `/google-ads` + 4 sub-routes | 1 | ~4–6 | none | ~100–120 ms DERIVED | ✅ |
| `/timeline` | 1 | ~3 | none | ~95 ms DERIVED | ✅ |

All measured by `docs/PERFORMANCE.md` (19 Oct) at 14–81 ms server-side against a 5–10× load seed. That still holds; nothing in this audit contradicts it. Row caps (tasks 500, approvals 300, timeline 200) remain the pagination debt that report already recorded.

---

## Settings and Admin

| Route | Txns | Queries | External | Server data time | Status |
| --- | --- | --- | --- | --- | --- |
| `/settings` | 1 | ~3 | none | ~95 ms DERIVED | ✅ |
| `/admin` | 2 | ~5 | **enquiry DB probe** | ~130 ms DERIVED | ✅ |
| `/admin/users` | 1 | ~3 | none | ~95 ms DERIVED | ✅ |
| `/admin/audit` | 1 | ~2 | none | ~90 ms DERIVED | ✅ |
| `/admin/backups` | 1 | ~2 | none | ~90 ms DERIVED | ✅ |

`/admin` calls `loadOperationsReport`, which runs `enquiryConnection()` (an extra `select 1` against the enquiry database) before its platform reads.

---

## Unauthenticated routes — the only routes measured end-to-end

MEASURED on the production build (`next start`, port 3401), `time_starttransfer`, 8 samples:

| Route | First request | Warm p50 | Warm range |
| --- | --- | --- | --- |
| `/sign-in` | 193 ms | ~5.7 ms | 4.2 – 9.6 ms |
| `/api/auth/session` (no cookie) | 3.7 ms | ~2.4 ms | 1.9 – 12.2 ms |
| `/api/auth/providers` | 2.5 ms | ~1.8 ms | 1.7 – 1.9 ms |
| `/api/auth/csrf` | 2.9 ms | ~1.7 ms | 1.5 – 1.8 ms |
| `/api/internal/operations/status` (401) | 7.2 ms | ~1.8 ms | 1.3 – 2.2 ms |

**This is the control.** Framework, routing and React server rendering cost single-digit milliseconds. Every authenticated route's time is database round trips and external API calls — nothing else.

---

## Client-side asset budget (MEASURED)

| Measure | Value | Assessment |
| --- | --- | --- |
| All client JS, uncompressed | 1,148 KiB | fine |
| All client JS, gzipped | **332.5 KiB** | fine |
| Largest chunk | 228 KiB uncompressed | fine |
| CSS | 48 KiB, one file | fine |
| Fonts | 1 (`Plus_Jakarta_Sans`, 4 weights, `display: swap`) | correct |
| `next/image` usage | 3 call sites | — |
| Bare `<img>` without dimensions | 4 call sites, all blog | CLS risk |
| Chart libraries | none | fine |
| Client components | 44 of 78, largest 536 lines | fine |
| `useEffect` calls | 22 across 10 files | fine |
| `Link prefetch` configured | 0 | opportunity |

No front-end asset work is warranted. Every page-level opportunity is server-side.

---

## Summary by status

| Status | Routes |
| --- | --- |
| ❌ Fails the ≤ 800 ms server-data target | **2** — `/` and `/enquiries` (both: blocking Wix API calls) |
| ❌ Per-request cost defect | **1** — `GET /api/blog-media/[id]` |
| ⚠️ At risk or structurally unbounded | **5** — `/enquiries/[id]`, `/enquiries/export`, `/analytics/behaviour`, `/reports/[id]/download`, and every route reaching `listSnapshots(limit: 20000)` |
| ✅ Within target on measured/derived server data time | **62** |
| Browser metrics (FCP/LCP/INP/CLS/navigation) | **NOT MEASURED on all 70** |

**Five slowest routes** by server data time:

| # | Route | Server data time | Dominant cause |
| --- | --- | --- | --- |
| 1 | `/enquiries` | 1.2–1.7 s DERIVED | 8 Wix bindings on the render path |
| 2 | `/` (Dashboard) | 0.7–1.4 s DERIVED | 7 Wix bindings on the render path |
| 3 | `/enquiries/[id]` | ~0.6 s DERIVED | 1 Wix binding + 3 transactions |
| 4 | `/reports/new` | 285–335 ms MEASURED | 20–28 sequential queries |
| 5 | `/analytics/traffic` and `/analytics/behavior` | ~265 ms MEASURED | 19 queries across 3 transactions |
