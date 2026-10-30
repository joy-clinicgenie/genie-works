# Batch 04 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 04 — Analytics synchronisation |
| Date | 30 October 2026, Asia/Singapore |
| Starting SHA | `7e8c3f37012f45aafe5b1fd17bae86e2d594f4fe` |
| Implementation SHA | `da3b119ba6d3f454fabbfc137509bd8db04429f9` |
| Branch | `main`, ahead of `origin/main` by the local commits from Batches 01, 02, 03 and 04 |
| Evidence commit | The documentation commit whose parent is the implementation SHA. No push. |

Batch 03’s completion gate was confirmed from its handover. The implementation SHA `ba9d2b3eb34317c71ffa1422583b24e4799577af` is an ancestor of the starting SHA. DEP-01 stays open. No production property was selected.

## Environment aliases

| Alias | What it is |
| --- | --- |
| `local-db` | Embedded Postgres `127.0.0.1:54339`, database `clinic_genie`. Used for `npm test`. Tests roll back. Not seeded or migrated in this batch. |
| `rehearsal-db` | Local database `clinic_genie_rehearsal`. Used only for the Settings and home check. |
| `rehearsal-app` | Next.js on `127.0.0.1:3403`, pointed at `rehearsal-db`. Stopped after the check. |
| `app-dev` | The server on port 3400 and the remote application database. Not used. |

No remote application database was queried or written. No provider host was called.

## Files changed

Implementation commit, 13 files:

- `apps/platform/src/app/api/internal/analytics/worker/route.ts` serves GET and POST through one handler. A missing or wrong bearer returns 401 before any job runs.
- `apps/platform/src/lib/analytics-worker.ts` accepts `ANALYTICS_WORKER_SECRET` or `CRON_SECRET`.
- `vercel.json` adds a daily cron, `GET /api/internal/analytics/worker` at 02:00 UTC (10:00 Asia/Singapore). The file was not deployed.
- `packages/db/src/analytics/sync.ts` returns an expired lease to the queue until five leases, then fails it with `lease_expired`. `listConnectionSyncStatus` reads the last succeeded sync run and the queue. It does not read `verified_at`.
- Settings shows queued, leased and failed counts, the safe error in words, and the last successful sync. The connection badge stays the connection status.
- Tests cover the timezone window, duplicate queueing, the five-attempt cap, website isolation, a repeat that replaces rather than adds, an unavailable metric, and GA4 and Wix sessions left uncombined.
- `docs/analytics/LIVE_SYNC_VERIFICATION.md` is the remaining live procedure. `docs/ENVIRONMENT.md` and `.env.example` name `CRON_SECRET`.

Applied SQL files were not edited.

Left untracked and unstaged:

- `.cursor/`
- `apps/platform/public/client-marks/`
- `audits/` (the original six reports)
- `docs/GENIE_WORKS_V1_STAFF_SOP.md`
- `docs/release-readiness/`
- `reports/page-speed-audit.md`

## Scheduler preparation and verified execution

Prepared: the repository cron path matches the worker route, and that route handles GET, which is the method Vercel Cron sends. The same route still accepts POST. An empty secret does not authorise either method.

Not verified: no cron has been deployed, and no hosted invocation was observed. The local 401 responses show that an unauthenticated request does not run the worker. They do not show that a schedule ran. The `crons` entry on its own is not evidence that the hosted scheduler works.

## Fixture check

On `rehearsal-db`, one fictional connection used property id `fixture-1001`. Its connection check was `2020-01-01T00:00:00.000Z`. Its succeeded sync run finished at `2026-10-15T02:00:00.000Z`. There was one failed job with safe error `rate_limited`, and no coverage rows.

`harbourview-dental` was archived, so Settings did not list it. It was set active for the page check and set back to archived afterwards. The signed-in Settings page then showed:

- Last successful sync: 15 Oct, 10:00
- Queue: 0 queued, 0 leased, 1 failed
- “The provider asked us to wait. Retry stops after five attempts.”
- The sentence that a connection check is not a successful data sync

It did not show 1 Jan from the connection check. The home page, for the same period, still said “Not yet synchronised” and “Illustrative trend only.” Enquiries stayed “Connection required,” with the existing line that counts are stored submissions, not clicks or bookings.

The fixture connection, its jobs and its sync run were then removed. `analytics_connections` and `analytics_jobs` were 0. One append-only audit row, `analytics.connection.bind` at 30 Oct, 22:42, remains on `rehearsal-db`. `rehearsal-app` was stopped.

These rows were fixture data. They do not prove a live Google or Wix integration.

## Issues

| Result | Issues |
| --- | --- |
| Partially fixed | GW-005. Local claiming, retry, queue display and the GET handler are in place. The live window and the hosted schedule stay blocked. |
| Unchanged | GW-001, GW-002, GW-003, GW-007, GW-013 and GW-017 stay Fixed and verified. GW-004 and GW-015 stay Partially fixed. |
| Reproduced | GW-006, GW-008, GW-009, GW-010, GW-011, GW-012, GW-014, GW-016. This batch did not work on them. |
| Blocked | DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06, DEP-07, DEP-08. DEP-01 still blocks the live sync. DEP-04 still blocks an observed hosted cron. |

## Commands

| Command | Where | Exit |
| --- | --- | ---: |
| Analytics sync, agency overview and fixture-target tests | `local-db` | 0 (20 tests) |
| Worker and analytics-board tests | Working tree | 0 (12 tests) |
| `npm test` | `local-db` | 0 (93 database tests, 41 platform tests) |
| `npm run typecheck` | Working tree | 0 |
| `npm run lint` | Working tree | 0 (11 warnings, 0 errors) |
| Unauthenticated GET and POST to the worker | `rehearsal-app` | 401 |
| Signed-in Settings and home | `rehearsal-app` | 200 |

## Live check still blocked by DEP-01

The exact procedure is `docs/analytics/LIVE_SYNC_VERIFICATION.md`. It needs a named non-production GA4 or Wix property and a separate non-production Search Console property, permission to read them, and confirmation that the configured OAuth client may be used. The comparison uses one completed window, the connection timezone for GA4 and Wix, and `America/Los_Angeles` for Search Console. Sessions are compared for one traffic source. Clicks, form starts, enquiries and bookings stay separate. A missing day stays unavailable.

Expected evidence is a succeeded sync run, the property alias, the window, the timezone, and both figures, with no secrets. DEP-01 stays open until that evidence exists. A production property is not a substitute.

## Next batch

`docs/release-readiness/05_ENQUIRIES_AND_RETRY.md`

Batch 04’s local gate is met for the fixture worker and the prepared scheduler. The live and hosted-schedule parts of GW-005 stay open. Batch 05 can start: its prerequisites are Batches 02 and 03, which are met. Its live enquiry work stays blocked on DEP-02 and DEP-03. This session stops here.
