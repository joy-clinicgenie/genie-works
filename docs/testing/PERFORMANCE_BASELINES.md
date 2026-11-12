# Signed-in performance baselines on isolated infrastructure

How to measure signed-in Genie Works pages without touching a shared or production database, and what
the measurements do and do not say.

Everything here uses the `perf` suite: its own two databases, its own ports, its own fixture and a local
Wix mock. It reuses the batch-08 harness rather than adding a second one — same `targets.ts` guards,
same `prepare.mts`, same `server.mts`, same session helper in `support.ts`.

> Nothing in this document or in the generated baselines describes a client result or production
> behaviour. Every record is synthetic and labelled.

---

## 1. What exists

| Piece | File | Purpose |
| --- | --- | --- |
| Suite definitions and guards | `e2e-batch08/targets.ts` | Names the isolated databases and ports per suite; refuses any name not on the suite list |
| Create / migrate / seed / fixture | `e2e-batch08/prepare.mts` | `prepare.mts [b08\|perf] [drop]` |
| Isolated app server | `e2e-batch08/server.mts` | `server.mts [b08\|perf] [start\|dev]` |
| Session helper | `e2e-batch08/support.ts` | `openAs(browser, email, suite)` — a database session, as Auth.js would create |
| Measurement helpers | `e2e-batch08/measure.ts` | Navigation timings, transaction counters |
| Baseline runner | `e2e-batch08/perf-baseline.mts` | Drives the whole run and writes the report |
| Query counter | `e2e-batch08/perf-query-counts.mts` | Statement counts per server path, out of band |
| Platform fixture | `packages/db/src/testing/perf-fixture.ts` | Demo Clinic A, B and an empty clinic |
| Enquiry fixture | `packages/db/src/testing/perf-enquiry-fixture.ts` | 72 enquiries, every follow-up and notification state |
| Wix mock | `packages/db/src/testing/wix-mock.ts` | Seven provider scenarios on 127.0.0.1 |

### Suites

| Suite | Platform database | Enquiry database | Production build | Dev server |
| --- | --- | --- | --- | --- |
| `b08` | `clinic_genie_b08` | `clinic_genie_enquiry_test_b08` | 127.0.0.1:3408 | 127.0.0.1:3409 |
| `perf` | `clinic_genie_perf_baseline` | `clinic_genie_enquiry_test_perf_baseline` | 127.0.0.1:3418 | 127.0.0.1:3419 |

The Wix mock uses 127.0.0.1:3420.

---

## 2. Reproducible commands

Needs the embedded PostgreSQL running (`npm run db:start`) and nothing listening on 3418 or 3420.

```bash
# 1. Build the isolated databases from nothing: create, migrate, seed, load the fixture.
npm run perf:prepare

# 2. Build the platform into the suite's own distDir.
AUTH_SECRET="isolated-perf-suite-secret-not-a-real-credential" npm run perf:build

# 3. Measure. Starts the Wix mock, starts the server, signs in, measures, writes the report.
AUTH_SECRET="isolated-perf-suite-secret-not-a-real-credential" npm run perf:baseline

# Optional flags
npm run perf:baseline -- --warm=10                 # more warm runs per page
npm run perf:baseline -- --viewport=both           # desktop and mobile
npm run perf:baseline -- --skip-scenarios          # pages and concurrency only
npm run perf:baseline -- --skip-concurrency

# 4. Statement-level query counts per server path (what the browser run cannot measure).
npm run perf:query-counts

# 5. Remove the isolated databases when finished.
npm run perf:drop
```

To drive the isolated app by hand instead:

```bash
npm run perf:server                                        # production build on :3418
npx tsx e2e-batch08/server.mts perf dev                    # dev server on :3419
```

`AUTH_SECRET` is only needed because the platform refuses to run without one. The value above is a
throwaway for this isolated suite and is not a credential.

Results are written to `docs/testing/baselines/`:

| File | Content |
| --- | --- |
| `perf-baseline.json` / `.md` | Page timings, Wix scenarios, concurrency |
| `perf-query-counts.json` / `.md` | Driver query and round-trip counts per server path |

---

## 3. Isolation and safety

What stops this reaching anything shared:

- **Database names.** `assertBatchDatabase` in `e2e-batch08/targets.ts` refuses any name that is not on
  the suite list, and refuses `clinic_genie`, `clinic_genie_rehearsal`, `clinic_genie_enquiry_test`,
  `clinic_genie_enquiry_staging`, `neondb` and `postgres` by name. The check runs before a maintenance
  connection opens, so a typo cannot drop a shared database.
- **Enquiry fixture guards.** `assertEnquiryFixtureUrl` additionally requires a local host, a name
  containing both `enquiry` and `test`, refuses port 54329 (the sibling clinic website database), and
  refuses a target equal to `DATABASE_URL` or `DATABASE_ADMIN_URL`. The performance fixture adds one
  more: the name must contain `perf`.
- **Production is refused outright.** `assertNotProductionEnvironment` throws when `NODE_ENV` or
  `VERCEL_ENV` is production.
- **No production data is copied.** The fixtures generate rows; they never read a production database.
  The repository's own rule stands: never copy production patient or enquiry records into a test
  environment.
- **Authentication is not weakened.** The suite does not enable development magic links, does not relax
  any permission check, and does not change the deployed auth path. It creates a database session row
  directly, which is what `support.ts` has always done for the batch-08 suite, and only ever against a
  database whose name `targets.ts` has approved.
- **No real email.** Every contact is under `example.invalid`, which cannot deliver. Notification rows
  are *stored states only*; the platform does not send mail, and the fixture writes no outbound request.
  Controlled real recipients belong only in a separately configured delivery test, as
  `19_SEED_DATA_TEST_PLAN.md` requires — this suite is not that test.
- **No production Wix account.** Wix reads go to the local mock via `FORMS_WIX_BASE_URL`.
  `resolveWixApiBaseUrl` returns the real provider by default and accepts the override only when all
  three hold: the mock host is local, `VERCEL_ENV` is unset, and `DATABASE_URL` is a local database.
  The last condition is the same "local rehearsal" test the platform already applies to development
  sign-in links, and it is the strong one: a process pointed at the shared database is refused even
  when everything else looks local. `NODE_ENV` is deliberately not the gate, because `next start` sets
  it to production for the local production build a baseline needs to measure.
- **Excluded from production totals.** Every fixture client is `is_synthetic = true`, and every enquiry
  row is `is_synthetic = true`, which is the flag the enquiry board already uses to keep demonstration
  rows out of production totals and exports.

---

## 4. The fixture

Versioned: `FIXTURE_VERSION` in `perf-fixture.ts` and `PERF_ENQUIRY_FIXTURE_VERSION` in
`perf-enquiry-fixture.ts`. The loaded version is recorded in `audit_events` and returned by
`readPerfFixtureVersion`, so a stale database is detected rather than measured.

**Deterministic shape, run-date anchored dates.** The same version always produces the same clients,
websites, permissions, row counts and identifiers. Two deliberate exceptions:

- Analytics **dates** move with the run date, because the pages ask for "last 30 days" relative to
  today and would otherwise find nothing. The anchor is recorded in the report.
- Blog **article ids** are assigned by the `createArticle` service, because `blog_article_versions` is
  append-only and a fixed id cannot be forced afterwards. The ids a load produced are written to
  `e2e-batch08/.run/perf-context.json`, and the baseline runner reads them from there. The runner also
  checks the recorded fixture version against the version in the code and refuses to measure a stale
  database.

### Platform database

| Item | Content |
| --- | --- |
| Clients | Demo Clinic A, Demo Clinic B, Demo Clinic C — no data (all fictional, all `is_synthetic`) |
| Websites | A production (Next.js) and A preview, B production (Wix, bound to the mock), C none |
| Forms | 2 active and 1 proposed-inactive on A, 1 unverified on B |
| Staff scoping | specialist-a and reviewer → Clinic A only; specialist-b and read-only → Clinic B only; admin and manager are global |
| Second administrator | `perf-admin@example.invalid`, separately authorised from the seeded admin |
| Tasks | 80 on A, 40 on B, across every status and priority — enough to page and filter |
| SEO | 40 pages on A, 12 on B, with changes and 8 redirects |
| Analytics | GA4 and Search Console connected on A, Wix on B, one `reconnect_required` connection on A preview; published partitions and daily coverage for last 7, 30 and 90 days, current and previous |
| Report history | 3 saved reports, 6 versions, one draft and one saved |
| Blog | 2 draft articles created through the real `createArticle` service — one with a featured image and an in-body image, one plain — and two 1x1 PNG media files written under the suite's uploads directory so the media route can be measured |
| Snapshots | 12 monthly periods for A and B, with deliberate unavailable values |
| Empty cases | Demo Clinic C has no website, no analytics and no enquiries |

### Enquiry database

60 enquiries, all for Clinic A, spread over the 60 days before the anchor so both the current and the
comparison window have rows, and split across Clinic A's two website keys so the website filter has
options. Three pages at 25 per page.

Clinic B has **no** database enquiries on purpose: its production website is Wix-sourced, and D31 gives
a website one source. Clinic B's enquiries come from the Wix mock. Together that covers D36 — two
connectors on one page, Clinic A from the database and Clinic B from Wix.

| Follow-up status | Count |
| --- | --- |
| New | 20 |
| Acknowledged | 20 |
| Closed | 20 |

Notification states cycle across the 60 rows, so each appears 8 or 9 times:

| Notification state | How it is stored |
| --- | --- |
| Sent | `status = 'sent'` |
| Failed | `status = 'failed'` |
| Exhausted | `status = 'exhausted'` |
| Pending | `status = 'pending'`, no lease |
| Processing | `status = 'pending'` with `leased_until` in the future — "processing" is **derived**, not a stored status (see `notificationBoundary`) |
| Not configured | `status = 'unconfigured'` |
| No notification recorded | no outbox row at all |

The exact counts for a run are recorded in the prepare output and in `perf-baseline.json`.

"Retry requested" is also derived, from a staff retry rather than from stored state, so it is not part of
the fixture's stored rows.

---

## 5. Wix provider scenarios

The mock binds to 127.0.0.1 and answers the four endpoints the platform calls. Scenarios switch at
runtime through `POST /__mock/scenario`, so one mock serves a whole run.

| Scenario | Behaviour |
| --- | --- |
| `normal` | One page of submissions, answered immediately |
| `slow` | A normal response delayed by `delayMs` (default 1,500 ms) |
| `timeout` | No response at all, so the caller's own 15 second `AbortSignal` decides. This scenario alone takes around a minute, because the page makes several provider calls and each waits out its own timeout — that compounding is the point of measuring it |
| `provider-error` | HTTP 500 from the submissions query |
| `multi-page` | Three cursor pages, so sequential paging is measured |
| `expired-auth` | HTTP 401 `invalid_grant` on **both** the token call and the query, because the caller caches a token for minutes and an expired credential usually surfaces on the query |
| `zero-submissions` | HTTP 200 with a genuinely empty list, which is not the same as a failure |

Payload shapes follow `apps/platform/src/lib/wix-form-map.ts`. Every submission it returns is synthetic
and labelled.

Scenarios are measured by the server's own response time and the state the page reached, **not** by
waiting for a table. Several of these scenarios legitimately render "no enquiries are available", and
waiting for a table there measures a selector timeout rather than the platform — an earlier version of
this runner did exactly that and reported 40 seconds for a page the server had answered in 8.

What the measurements show: Genie Works answers a failed-provider load in **8–10 ms** and says so on the
page. A slow provider costs what the provider costs (1,525 ms for a 1,500 ms delay). A genuine empty
result renders the list with no rows, which is correctly distinguished from a failure.

**One caveat on the failing scenarios.** In this suite a Wix failure empties the Enquiries page, because
the production build cannot read the fixture enquiry database either (section 5a), so Wix is the only
connector with rows. Do not read that as "a Wix outage blanks the page": with a readable database
connector the page would show its database enquiries alongside the failure notice. What these rows do
establish is the **server cost** of a provider failure, which is what they are here to measure.

## 5a. One thing the production build cannot measure: the enquiry database connector

`assertEnquiryFixtureUrl` refuses a *fixture* enquiry database whenever `NODE_ENV` is `production`, and
`next start` sets exactly that. So under the production build on 3418:

- `enquiryPool()` returns null, `readEnquiry` returns null, and the enquiry **database** connector reads
  nothing. This is the guard working as designed — a fixture database is not meant to be read by a
  production build.
- The Enquiries page therefore shows the **Wix** connector only. When the mock succeeds the list is
  25 mock submissions; when it fails the page correctly shows "no enquiries are available".

Two consequences worth stating plainly:

1. The Enquiries measurements from `npm run perf:baseline` exercise the **Wix connector**, including its
   filtering and paging. They do **not** exercise the enquiry-database connector.
2. There is a second, independent reason the database connector would stay empty here: the enquiry
   fixture schema has `check (is_synthetic)`, so every fixture row is synthetic, while
   `listEnquiryBoard` hard-codes a production-only filter. Synthetic enquiries are deliberately hidden
   from that list (D40). A fixture cannot populate it at all.

To measure the enquiry-database connector, run the suite's **dev** server, where `NODE_ENV` is
`development` and the guard allows a fixture database:

```bash
WIX_MOCK_URL=http://127.0.0.1:3420 npx tsx e2e-batch08/server.mts perf dev   # :3419
```

Those numbers are a development build and are not comparable with the production-build figures. Nothing
in the generated baseline currently reports them: **the enquiry-database connector is NOT MEASURED.**

---

## 6. What is measured, and what is not

Recorded separately in the report:

| Measurement | Source |
| --- | --- |
| Browser navigation duration | Wall clock around `page.goto` |
| Primary data visible | Wall clock from before `goto` until the page's own primary selector is visible — not just the frame |
| Server request duration | `PerformanceNavigationTiming.responseStart` (time to first byte) and `responseEnd` |
| First contentful paint | `performance.getEntriesByName("first-contentful-paint")` |
| Cumulative layout shift | A `layout-shift` PerformanceObserver installed before navigation |
| Request count and transferred bytes | `PerformanceResourceTiming` entries |
| Database query and transaction counts | **Not from the browser run** — see below. Exact per-path counts come from `npm run perf:query-counts` |
| Connection pressure under concurrency | `pg_stat_activity` sampled every 40 ms during the burst: peak connections, peak active, peak idle-in-transaction |
| External API duration and call count | The mock's own per-request record |
| Cold versus warm | Cold is the first measurement of a route after the server starts; warm are the runs after it |
| Mocked versus real provider | Mocked only |

Pages covered: Dashboard; Enquiries with status filter, pagination and clinic scope (via the Wix
connector — see section 5a); Analytics Overview,
Traffic and Behaviour; SEO Overview; Reports library, the report builder form and a saved report; the
blog list, the editor for a published and a draft article, the preview with media, and the media route
itself; Clients; a client with no data; and the dashboard as a clinic-scoped specialist rather than an
administrator.

**Explicitly NOT MEASURED:**

- **Database query and transaction counts per navigation.** Two instruments were tried and both
  rejected:
  - `pg_stat_statements` needs `shared_preload_libraries`, which the embedded server does not set, and
    this work did not change the shared development cluster's configuration to get it.
  - `pg_stat_database.xact_commit` is flushed on a timer rather than at commit, and the lag is longer
    than any usable settle delay. Measured on this fixture: 50 statements produced a delta of **1**,
    and the next window of 6 statements produced a delta of **52** as the earlier batch finally
    flushed. It cannot attribute transactions to a request, so it is not reported.

  Exact counts come from `npm run perf:query-counts` instead, which calls the real service functions
  with the `pg` client's `query` method wrapped — the technique recorded in
  `docs/audits/platform-performance/CG_API_DATABASE_PERFORMANCE.md`. That gives driver query and
  round-trip counts per server path, which is the figure worth tracking anyway because it does not
  depend on machine speed.

  `pg_stat_activity` *is* usable, because it is a live view rather than a cumulative counter, so the
  concurrency runs sample it.
- **Real-provider Wix latency.** By design: contacting a production Wix account from a test suite is
  exactly what this setup exists to avoid. The audit's single manual probe remains the only real-provider
  figure, and it is recorded in the audit, not here.
- **Interaction to next paint.** No interaction workload is driven yet.
- **Largest contentful paint.** Not collected; FCP and primary-data-visible are.
- **The enquiry-database connector.** See section 5a: the production build cannot read a fixture
  enquiry database, and a synthetic enquiry is hidden from that list by design.
- **The blog publish workflow and the published-article path.** Both fixture articles are drafts. The
  submit, approve and publish steps are enforced by database triggers and need approval records; the
  fixture creates drafts through the real service rather than forging a published state. The public
  blog API is therefore not exercised either.
- **Anything about production.** This is an isolated local environment on one machine.

### Reading the numbers

These are local figures from one machine against a local PostgreSQL, so they are **not** production
latency. Their value is comparative: the same command before and after a change, and the query,
round-trip and provider-call counts, which are deterministic and independent of machine speed.

**The query counts are higher than the November audit reported, and the fixture is why.** The audit ran
its probe against the shared database, where `report_snapshots`, `seo_pages` and `tasks` were empty and
most analytics partitions were missing, so several loops exited early. With a populated fixture:

| Server path | Audit, shared database | This fixture |
| --- | --- | --- |
| `loadLiveBundle` GA4 | 15 queries | **17** |
| `composeReport`, single period | 20 queries | **28** |
| `composeReport`, with comparison | 28 queries | **44** |

Report generation is therefore worse than the audit measured: 46 round trips, not 30. At the 8.5 ms
per-round-trip cost the audit measured against Neon, that is roughly 390 ms of database time rather than
255 ms. The audit's P1-6 recommendation stands, and its expected benefit was understated.

---

### What the first runs showed

Recorded here because these are the observations the harness exists to produce, not because they are
production numbers. The committed artefact holds one run; where two runs disagreed, both are given.

- **Connection waiting is real, and the mechanism is idle-in-transaction.** The connection counts are
  the stable part:

  | Sessions | Peak `cg_app` connections | Peak active | Peak idle in transaction |
  | --- | --- | --- | --- |
  | 1 | 3 | 0 | 0 |
  | 5 | **8** (the pool ceiling) | 5 | 3 |
  | 10 | **8** | 3 | **8** |

  At ten sessions every pooled connection is held open *inside a transaction while not running a
  query*. That is the shape the November audit predicted: `/analytics` keeps one connection checked out
  across 19 sequential queries plus the work between them, so connections are occupied rather than busy.

  The **latency** is not stable. Two runs of the same command gave p50 of 3,917 ms and 8,866 ms at ten
  sessions, against 234–296 ms at one session. So: an order of magnitude worse at ten sessions, with a
  two-fold spread between runs on a laptop also running the browser and the database. Treat the
  direction as established and the magnitude as indicative only. Pool limits were not changed.
- **A failed provider is cheap; a slow one is not.** Genie Works answers a failed Wix read in 8–10 ms
  and shows the failure notice. The `timeout` scenario cost 15,030–15,057 ms across runs, which is the
  application's own `AbortSignal.timeout(15_000)` doing its job — the ceiling is the client's, not the
  provider's. Scenario figures reproduced closely between runs (normal 13–14 ms, slow 1,525–1,527 ms).
- **The blog editor fetches media per image and it shows.** The editor for an article with media made
  **34 requests** against 17 for the article without it, with a warm p50 around 350 ms versus roughly
  50 ms for the other blog pages. That is the audit's P1-7 finding — two transactions and an audit write
  per image, with `Cache-Control: no-store` — visible in a measurement for the first time.
- **Cold is the first load of a route, and it is mostly route loading.** Dashboard cold was 398 ms
  against a 64 ms warm p50; most routes settle to 40–70 ms warm on this machine.
- **Two pages are warm-slower than cold**, consistently across runs: the blog list and both blog editor
  pages show a warm p95 of roughly 820 ms against a cold figure near 120 ms. That is backwards from
  every other route and is not explained yet — it is recorded as an observation to investigate, not a
  conclusion.

## 7. Concurrency

`perf-baseline.mts` runs 1, 5 and 10 concurrent signed-in sessions against `/analytics` on the isolated
server only, after warming the route so compilation is not counted as contention. It records wall time,
per-session p50 and p95, and — sampled from `pg_stat_activity` every 40 ms during the burst — the peak
number of `cg_app` connections, how many were active, and how many sat idle in transaction.

Idle-in-transaction is the one to watch: a connection held open while the request does something else
is the shape that turns into waiting as sessions rise.

**Pool limits were not changed.** `APP_POOL_OPTIONS.max` is 8 per server process
(`packages/db/src/client.ts`). The audit's arithmetic suggests about nine concurrent heavy requests
begin to queue; the concurrency rows are the measurement to compare that against. Do not raise `max`
on the strength of these runs alone — Neon's pooled endpoint has its own limits, and the observation to
act on is connection waiting, not a round number.

---

## 8. Housekeeping

- `npm run perf:drop` removes both isolated databases. `prepare` drops and recreates them anyway, so a
  run always starts from nothing.
- **A stale server is the trap to watch for.** `perf-baseline.mts` spawns the server in its own process
  group and stops the group, because killing only the immediate child leaves the `next start`
  grandchild holding the port. If a server is somehow still listening, the runner's pre-flight check
  refuses to measure rather than silently reporting numbers from an old build and an old fixture —
  which is exactly what happened once while this harness was being written. If you see
  `Something is already serving http://127.0.0.1:3418`, stop that process and run again.
- `.next-perf`, `.next-perf-dev` and `.data/uploads-perf` are suite-local build and upload directories.
  They are ignored by git along with the other `.next*` directories.
- The batch-08 suite is unchanged: `npx tsx e2e-batch08/prepare.mts` and
  `npx tsx e2e-batch08/server.mts` still default to `b08`, and the existing specs still run against
  127.0.0.1:3408 with `playwright.batch08.config.ts`.
- The directory is still called `e2e-batch08` although it now serves two suites. Renaming it would
  invalidate the commands recorded in `docs/audits/batches/BATCH_08_HANDOVER.md`, so the name was left
  alone deliberately.
