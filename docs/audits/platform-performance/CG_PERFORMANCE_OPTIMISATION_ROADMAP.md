# Performance optimisation roadmap

Date: 3 November 2026 · Commit `a54d6de` · Companion to `CG_LATENCY_AUDIT_REPORT.md`

**Nothing in this roadmap has been implemented.** It is a sequenced proposal for review. Per `16_BUILD_RULES.md`, each item should become a ticket in `17_BUILD_TICKETS.md` and be implemented one at a time, with normal / failure / concurrency / unauthorised tests. Items marked **needs a recorded decision** should get a `docs/DECISIONS.md` entry before implementation, because they change behaviour rather than only speed.

All latency figures are ESTIMATES derived from the measured constants in `CG_API_DATABASE_PERFORMANCE.md` (25 ms per transaction, 8.5 ms per query, and the measured Wix call times), unless marked MEASURED.

---

## Stage 0 — Immediate fixes

Small, safe, independently shippable. Together these take roughly a day and remove ~50 ms from several routes plus one security defect.

| # | Item | Files | Benefit | Risk |
| --- | --- | --- | --- | --- |
| 0.1 | **Delete the committed debug `fetch`** that posts secret lengths to `127.0.0.1:7835` before the authorisation check | `apps/platform/src/app/api/internal/analytics/worker/route.ts:20-22` | security, not speed | none |
| 0.2 | **Delete the duplicated `count(*)`** — `listProduction` is hard-coded `true`, so the count query and the "production total" query are byte-identical and both execute | `apps/platform/src/lib/form-submissions.ts:713,743` | −8 ms per `/enquiries` load and per export | none |
| 0.3 | **`cache()` the client registry** so the app layout and the page share one read, as `getAccess()` already does | `apps/platform/src/app/(app)/layout.tsx:37`, `(app)/page.tsx:29`, `lib/seo-workspace.ts:215` | −34 ms MEASURED on the dashboard and every `/seo/*` route | low |
| 0.4 | **Share one transaction** on `/analytics/traffic` and `/analytics/behavior`, matching the fix already applied to `/analytics` on 2 November | `analytics/traffic/page.tsx:10-13`, `analytics/behavior/page.tsx:10-13`, `lib/load-analytics-board.ts:10` | −20 ms on two routes | low |
| 0.5 | **Move `/analytics/behaviour` to `redirects()`** instead of a `force-dynamic` page that only calls `redirect()` | `next.config.ts`, delete `analytics/behaviour/page.tsx` | −1 full server round trip | none |
| 0.6 | **Add `width`/`height` to the four blog `<img>` tags** | `blog/ArticleDocument.tsx:480`, `blog/ArticleLayout.tsx:45,69`, `blog/ArticleForm.tsx:350` | removes a CLS precondition (impact NOT MEASURED) | none |

Start with 0.1. It is a three-line deletion and it is the only finding in this audit with a security dimension.

---

## Stage 1 — Make the two failing pages pass

`/` and `/enquiries` are the only routes that miss the ≤ 800 ms server-data target, and they miss it for the same reason: **live Wix Forms API calls on the render path.** MEASURED: token 731 ms, submissions query 526 ms, form schema 1,013 ms, fanned out over 7–8 bindings with up to 5 sequential pages each and no response cache.

Sequenced so that benefit arrives before the expensive work.

### 1.1 — Stream the dashboard (do this first)

Wrap the enquiry and notification cards in `Suspense` so the rest of the dashboard — client count, linked websites, report drafts, session summary, all fast local reads already running under `Promise.all` — paints immediately.

- Files: `apps/platform/src/app/(app)/page.tsx`, `components/modules/AgencyOverview.tsx`
- Benefit: dashboard first paint ~1.3 s → **~150 ms**, enquiry counts filling in after
- Complexity: medium · Risk: low · **Does not change any data**
- This is the highest perceived-speed win in the whole roadmap and it does not touch the integration

### 1.2 — Add a Wix read kill switch

`wixReadsAllowed()` is currently only `!process.env.VITEST && ANALYTICS_FIXTURE_MODE !== "1"`. There is no way to disable Wix reads in production if the API degrades.

- File: `apps/platform/src/lib/wix-enquiries.ts:174`
- Benefit: operational safety; makes 1.3 and 1.4 testable by comparison
- Complexity: low · Risk: low · **Needs a recorded decision** (it changes what staff see when off — the UI's existing `not_connected` state is the natural target)

### 1.3 — Overlap the Wix fan-out with the enquiry-database reads

`listEnquiryBoard` awaits `loadWixEnquirySlice` **before** any enquiry-database query starts. The two use different pools, so `Promise.all` is safe here (unlike same-client query parallelism, which `node-postgres` does not support).

- File: `apps/platform/src/lib/form-submissions.ts:689-692`
- Benefit: −0.5 to −1 s on `/enquiries`
- Complexity: medium · Risk: medium (ordering of the merge and the `sourceNotice` must be preserved)

### 1.4 — Move Wix reads off the render path entirely

The structural fix. Two options; the first is preferred.

**Option A — sync into a mirror table via the existing analytics worker.** The worker already does exactly this for GA4, Search Console, Wix Analytics and PageSpeed, and `10_ANALYTICS_CONVERSIONS.md` expects it. Pages then read local rows at ~8.5 ms per query.

- New migration for a Wix submission mirror; worker job type; read path in `form-submissions.ts`
- Benefit: **−0.6 to −1.6 s** on `/` and `/enquiries`; also fixes the unbounded-pagination problem (1.5) because a local table can be paged in SQL
- Complexity: high · Risk: medium
- **Needs a recorded decision.** Three questions the decision must settle: (a) acceptable staleness, and whether the 02:00 daily cron must become more frequent; (b) that enquiry **message bodies are still not copied**, per `07_FORMS_LEAD_CAPTURE.md` and the current deliberate design; (c) that clinic scoping and RLS apply to the mirror exactly as to `enquiry_reads`
- **Security constraint:** the mirror must carry `client_id` and full RLS policies and grants, per the data rules in `CLAUDE.md`

**Option B — short-TTL cached reads plus `Suspense`.** Cheaper, keeps data live, but leaves the fan-out and the unbounded pagination in place. A reasonable interim step if Option A is deferred.

### 1.5 — Restore SQL pagination on the enquiries list

`form-submissions.ts:692` sets `limit: null` whenever any Wix binding is configured, so **every matching enquiry row** is fetched to allow a JavaScript merge. The handling filter additionally forces `page: "all"`. The external `enquiries` table holds **0 rows** today, so this costs nothing yet and is unbounded by construction.

- Benefit: ~0 today; prevents the page becoming unusable as enquiries accumulate
- Complexity: high standalone, **low once 1.4 Option A lands** — a single-source query pages in SQL naturally
- **Recommendation: do not attempt this before 1.4.** Merge-and-page across two sources is where the real difficulty lies.

### 1.6 — Count Wix submissions without downloading them

`countWixEnquiryStatuses` downloads full submission records (MEASURED 46.6 KB per page) and keeps only `row.id`.

- File: `apps/platform/src/lib/wix-enquiries.ts:120-128`
- Benefit: −46.6 KB per page per binding; moot if 1.4 Option A lands
- Complexity: medium (depends on what the Wix API offers) · Risk: low

---

## Stage 2 — Short-term optimisation

Independent of Stage 1. Roughly a week. Removes ~250–300 ms from analytics, SEO, reports and every mutation.

| # | Item | Files | Benefit | Complexity | Risk |
| --- | --- | --- | --- | --- | --- |
| 2.1 | **Collapse `publishedReport` from two queries to one** (lateral join or CTE over partition + rows) and **fetch template keys in one query** with `template_key = any($n)` | `packages/db/src/analytics/read.ts:30-84`, `apps/platform/src/lib/live-analytics.ts:43-108` | −90 to −110 ms per analytics load (17 round trips → 4–6); compounds into 2.2 | medium | low — pure read refactor, row grouping is already done in JavaScript |
| 2.2 | **Batch `composeReport`'s 13 scalar queries.** Several are `select <title> … limit N` over different tables and can be one `union all`. With 2.1, the 8 template keys collapse too | `packages/db/src/services/report-builder.ts:118-231` | −170 to −190 ms per report (30 round trips → 8–10) | medium–high | **medium** — report values are snapshotted and append-only (D9). Output must be byte-identical; existing report tests are the gate |
| 2.3 | **One transaction per server action.** 14 blog actions use 2, `runSiteCheck` and `bindAnalyticsProperty` use 3, `updateEnquiryStatusAction` uses 4. `GET /api/evidence/[id]` already shows the correct shape | `apps/platform/src/app/actions/*.ts` | −25 to −75 ms per mutation | low each, ~30 sites | low — **also closes a read-then-write race**, so this is a correctness improvement too |
| 2.4 | **Fold `loadSearchPerformance` into the `/seo` transaction** once the context is known | `apps/platform/src/lib/seo-workspace.ts:180-197,398-406`, `(app)/seo/page.tsx:13-16` | −17 ms | low | low |
| 2.5 | **One transaction for blog-media lookup + audit** | `apps/platform/src/app/api/blog-media/[id]/route.ts` | −25 ms per image per view | low | low |
| 2.6 | **`loading.tsx` for the remaining list routes** (only `/blog` and `/clients` have one, out of 70) | `apps/platform/src/app/(app)/**` | perceived speed only | low | none |
| 2.7 | **`Suspense` for the analytics panels and the SEO Google panel**, so the page frame and fast panels paint first | `analytics/*/page.tsx`, `(app)/seo/page.tsx` | perceived speed | medium | low |

---

## Stage 3 — Structural improvements

Larger work, most of it protective rather than immediately felt. Several items here are **volume traps**: they cost nothing against today's thin dataset (`tasks` 0, `seo_pages` 0, `report_snapshots` 0, external `enquiries` 0) and become the dominant cost as data arrives.

| # | Item | Files | Benefit | Complexity | Risk |
| --- | --- | --- | --- | --- | --- |
| 3.1 | **Replace `listSnapshots(limit: 20000)` with aggregates** — `select distinct period_start, period_end … limit N` (the shape `listPeriods` already uses) plus `max(updated_at)` | `apps/platform/src/lib/site-view.ts:37`, `packages/db/src/services/reports.ts:58-80` | ~0 today; prevents a multi-hundred-ms regression | low | low |
| 3.2 | **Push the SEO website filter and the task `related_type` filter into SQL.** Note `unassignedPages` is derived from the *unfiltered* page set and must be preserved | `apps/platform/src/lib/seo-workspace.ts:351-374` | ~0 today; removes an unbounded read | medium | medium — the in-memory filters encode real selection rules |
| 3.3 | **Pagination for the capped list pages.** `docs/PERFORMANCE.md` flagged this on 19 October: tasks 500, approvals 300, timeline 200, audit 300, snapshots 1,000. Rows beyond the cap are silently hidden | task/approval/timeline/audit list pages | correctness as much as speed | medium | low |
| 3.4 | **Content-addressed, immutable blog media URLs** so `Cache-Control: private, max-age, immutable` is safe. **Never make these public** — they are client-scoped | `api/blog-media/[id]`, `lib/storage.ts` | near-eliminates repeat image fetches | medium | medium |
| 3.5 | **Reconsider audit granularity for media byte fetches.** One `audit_events` row per image per view is a lot of write amplification; an article-level read event would cut it by an order of magnitude | `api/blog-media/[id]`, `api/evidence/[id]` | −1 write per image per view | low | **needs a recorded decision** — the audit trail is a compliance artefact under `12_MEDICAL_PRIVACY_APPROVALS.md` and `13_SECURITY_FOUNDATION.md`. Treat as a policy question, not an optimisation |
| 3.6 | **Object storage for evidence and blog media.** `lib/storage.ts` reads from a local `UPLOADS_DIR`; Vercel has no persistent filesystem. The file's own comment acknowledges this. `report-artifact.ts:34-46` has the same problem, walking up to 16 directories for `docs/DECISIONS.md` | `lib/storage.ts`, `services/report-artifact.ts` | **correctness in production**, not latency | high | high — **escalate per `16_BUILD_RULES.md`**: a new paid vendor and a change to how patient-adjacent files are handled |
| 3.7 | **Test pool saturation and size `pool.max` on evidence.** `max: 8` with 120–270 ms transactions means ~9 concurrent analytics loads queue. NOT MEASURED | `packages/db/src/client.ts:27` | unknown until measured | low to test | medium to change — Neon's pooled endpoint has its own limits |

---

## Stage 4 — Monitoring, and closing the measurement gap

**This stage should arguably run in parallel with Stage 0, because nothing else in this roadmap can currently be verified.**

The audit could not measure TTFB, FCP, LCP, INP, CLS, client-navigation duration, request counts, hydration cost, API percentiles under load, or concurrency behaviour. The reason is twofold: no authenticated session was obtainable in this environment, and **no monitoring of any kind is installed** — no APM, no RUM, no request telemetry, no custom metrics. `14_MONITORING_RECOVERY_HANDOVER.md` is not satisfied on this point.

| # | Item | Benefit | Complexity | Risk |
| --- | --- | --- | --- | --- |
| 4.1 | **Stand up a seeded staging database and point `e2e-batch08/` at it.** The tooling already exists (`prepare.mts`, `server.mts`, `support.ts` with its own session helper, `playwright.batch08.config.ts` on an isolated port and database). This single step unblocks every NOT MEASURED metric in this audit | makes the roadmap verifiable | medium | low — isolated by design, refuses non-`b08` database names |
| 4.2 | **Capture a Playwright + Lighthouse baseline** on that environment, desktop and mobile, cold and warm, for the 12 modules in the brief | first real browser metrics | medium | none |
| 4.3 | **Add real-user monitoring** for Core Web Vitals at p75. Lab Lighthouse numbers are not field data and must not be reported as such | makes the CWV targets meaningful | medium | **must not log lead, patient or client-identifying data** |
| 4.4 | **Add request-level timing** (route, transaction count, query count, external-call duration) | makes p50/p95/p99 real instead of derived | medium | low |
| 4.5 | **Adopt "round trips per route" as the reviewable budget.** Cheap to count in review, and it maps linearly to latency at a measured 8.5 ms each. Suggested ceilings: ≤ 8 queries and ≤ 1 transaction for a list route, ≤ 12 for a composed route, **0 external API calls on any render path** | prevents regression by construction | low | none |
| 4.6 | **Run the pool-saturation and concurrency tests** (1 / 5 / 10 sessions) that Phase 7 of the brief asked for and this audit could not perform | settles the largest open risk | low once 4.1 exists | low |
| 4.7 | **Increase the analytics worker cron frequency** if and only if Stage 1.4 Option A lands, to match the freshness the UI promises. Respect Wix rate limits | required by 1.4 | low | medium — third-party quota |

---

## Suggested ticket order

1. **0.1** — delete the debug `fetch` (security, three lines)
2. **0.2, 0.3, 0.4, 0.5, 0.6** — the rest of Stage 0, one ticket each
3. **4.1** — seeded staging database, so everything after this is verifiable
4. **1.1** — stream the dashboard (largest perceived win, no data change)
5. **1.2** — Wix kill switch
6. **2.1** — collapse `publishedReport` (compounds into 2.2)
7. **4.2** — Playwright and Lighthouse baseline
8. **2.3** — one transaction per server action
9. **1.3** — overlap Wix with the enquiry database
10. **2.2** — batch `composeReport`
11. **1.4** — Wix off the render path (after its recorded decision)
12. **1.5** — restore SQL pagination (only after 1.4)
13. Stage 3 items as data volume makes them real; **3.6 escalates** rather than being scheduled

---

## Guardrails for every ticket above

From `16_BUILD_RULES.md` and the audit brief:

- **Never remove a tenant filter, membership check, permission predicate or RLS policy to reduce query cost.** Every new table needs its own policies and grants.
- **Never edit an applied migration.** Add the next numbered `NNNN_name.sql`.
- Preserve the `available` / `unavailable` / `not_connected` distinction the analytics and enquiry UIs make. A missing value must never become a zero.
- Approval decisions, report snapshots and audit events stay append-only (D9).
- Do not copy enquiry message bodies into this platform.
- `ANALYTICS_LIVE_REPORTS` is a data-availability flag. Do not switch it off for speed.
- Do not revisit the RLS helper-function shape or add speculative indexes — both were measured and settled in `docs/PERFORMANCE.md` on 19 October.
- Add normal, failure, concurrency and unauthorised tests per ticket. Report exact lint, typecheck and test results.
- Nothing is "live" on the basis of a local demonstration.
