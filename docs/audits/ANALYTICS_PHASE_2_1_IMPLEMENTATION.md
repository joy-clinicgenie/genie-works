# Analytics Phase 2.1: synchronisation architecture and queue optimisation

> **Renumbered 23 Nov 2026** when this work moved onto `main` (branch `analytics-phase2`): migrations `0046_analytics_scheduling` and `0047_analytics_worker_invocations` in this record are now `0053` and `0054`, because main already used 0046 and 0048–0052. Decisions are cited by their new numbers D68–D72.

Date: 12 November 2026, Asia/Singapore.
Decision: D68 in `docs/DECISIONS.md`.
Branch: `analytics-phase1-closure`, working tree only. Nothing is committed, pushed, deployed or scheduled.
Environment: local embedded PostgreSQL (`127.0.0.1:54339`, `clinic_genie`), fictional provider, fictional data.

**Result: Stage 2.1 is implemented and tested locally. It is not proven against live providers, and one daily run still cannot process the whole day's work (section 7). Stage 2.2 has not started.**

## 1. What was and was not touched

| Area | State |
| --- | --- |
| Production database, jobs, reports, connections | Not opened. No query, no migration, no cancelled job |
| Preview database | Not used |
| Vercel | Read-only documentation lookups. No deployment, no variable change, no schedule or Root Directory change |
| Provider calls | None live. Every provider answer in the tests is a local fictional response |
| Encryption keys | Not rotated. Token storage code is unchanged |
| Phase 1 | Still CONDITIONAL PASS. The Preview database is isolated, but the secrets backup and the editor-history decision are open. All work stayed on the local database |

Migration `0046` is applied to the local database only (`Applied: 47, Pending: none`).

## 2. The diagnostic findings, revalidated

| Finding in the diagnostic | Now |
| --- | --- |
| 21 connected sources | Unchanged: 1 GA4, 10 Search Console, 10 Wix. Not re-read from production |
| About 221 new jobs per daily run | **Confirmed from code and measured**: 31 GA4 + 10 × 18 Search Console + 10 × 1 Wix = 221. The capacity script queued exactly 221 under the old plan |
| Worker limited to 40 jobs per run | Unchanged (`ANALYTICS_WORKER_JOB_LIMIT`, default 40, maximum 100) |
| 91 queued jobs and one expired lease in production | **Not re-measured.** Production was deliberately not opened. The lease reaper that handles an expired lease already existed; it is now covered by a test |
| Search Console starvation | **Confirmed in code**: leasing ordered by `end_date desc`, and Search Console windows end three Pacific days back, so newer GA4 and Wix windows always went first. Fixed (section 4) |
| Reporting windows obsolete daily | **Confirmed.** Every window moves each day, and old queued windows were never retired. Fixed (section 4) |
| Missing production analytics credentials | **Changed.** `vercel env ls` now lists `ANALYTICS_*`, `PAGESPEED_API_KEY` and `CRON_SECRET` for Production. Values were not read |
| No registered production cron | **Unchanged**: Root Directory is `apps/platform`, so the `analytics-worker` schedule in the root `vercel.json` is not read |
| Historical data does not match dashboard periods | Addressed by D52. The new plan keeps every window the pages read, proven by contract tests (section 8) |

New findings, all fixed:

1. **A provider timeout failed the job permanently.** `providerFetch` aborts after 20 seconds, which throws; nothing mapped that to a retry, so the job landed in the `provider_rejected` branch and became `failed`.
2. **A malformed 200 replaced a good report.** A body like `{}` parsed to zero rows and was published as an `empty` partition over the previous good one.
3. **Reports were stored one row and one value at a time**: 25,016 statements for a 5,000-row report.
4. **Two workers could lease two jobs of one connection.** `leaseNext` checked for an existing lease, but the check is not atomic.

## 3. Architecture, before and after

| | Before (D52) | After (D68) |
| --- | --- | --- |
| Planning | Every preset window requested directly | Plan version 2: daily-grain "bundle" jobs derive the exact windows; exact-range jobs only where the metric is not additive |
| Queue hygiene | Duplicates blocked; old windows left queued forever | A newer window of the same class retires the older **queued** job (`cancelled`, code `superseded`) |
| Leasing order | Newest `end_date` first | Priority, then the connection served longest ago, then newest window |
| Provider fault | Each of a connection's jobs tried and failed in turn | The connection pauses with exponential backoff; other connections continue |
| One lease per connection | Query check only | Query check plus a unique partial index |
| Timeouts | Permanent failure | Retried with backoff up to 5 attempts |
| Invalid response | Stored as an empty report | Retried, never stored |
| Report storage | 5 statements per row | About 36 statements per 5,000 rows |
| Current-day coverage | `complete` | `partial` until the day ends |
| Worker visibility | Counts only | Also why it stopped: `empty`, `limit` or `deadline` |

## 4. Job scheduling strategy

Priorities, lowest first. Within a priority the connection served longest ago goes next, so one provider or client cannot keep the worker busy while another waits.

| Priority | Jobs |
| --- | --- |
| 10 | GA4 `traffic_daily`; Search Console daily bundle; Wix daily data |
| 20 | GA4 `traffic_range` (sessions and distinct users, exact range) |
| 30 | GA4 channel bundle; Search Console pages and queries |
| 40 | GA4 landing page, device and country bundles |
| 50 | GA4 engagement, pages, new or returning (exact range) |

Window classes (`p7`, `prev30`, `b180`, `daily180`, `wix62`) decide what a new job replaces. Only `queued` jobs of the same connection, template and class with an earlier end date are retired. A leased job, a finished job, a stored report and a job with no class are left alone.

Retry rules: 5 attempts per job. Delay is the larger of `30 × 2^(attempt−1)` seconds and the provider's `Retry-After`, capped at 30 minutes. A rate limit, a 5xx, a timeout or an invalid response also pauses the **connection** until the same kind of delay passes, rising with consecutive failures. Running out of worker time (`worker_deadline`) pauses nothing. A missing server setting keeps the job queued for 6 hours without using an attempt. A revoked grant marks the connection `reconnect_required`, as before. A success clears the pause.

## 5. Provider request strategy

| Provider | Request | What it serves |
| --- | --- | --- |
| GA4 | `traffic_daily`: sessions by date, 180 days, with zero days kept | Daily chart and coverage |
| GA4 | Bundle by channel: sessions by date and channel, 180 days | `ga4.acquisition` for 7, 30, 90 days and each previous period (6 windows) |
| GA4 | Bundles by landing page, device, country: 90 days | The matching report for 7, 30, 90 days (3 windows each) |
| GA4 | `traffic_range`: sessions and distinct users, exact range | 6 windows. Distinct users cannot be added across days (D13) |
| GA4 | Engagement, pages, new or returning: exact range | 3 windows each. Rates, averages and per-page figures are not additive |
| Search Console | Daily bundle: clicks, impressions, CTR, position by date, 180 days | `gsc.totals` for 6 windows |
| Search Console | Pages and queries: exact range | 6 windows each. Top-N lists cannot be rebuilt from daily rows |
| Wix | One request for the last 62 days, all four measures | Unchanged. Sessions, unique visitors, contact clicks and form submissions stay Wix definitions and are never merged with GA4 (`refuseCombinedTraffic`) |

Derivation rules (`scheduling.ts`): sessions, clicks and impressions are added across days. CTR is clicks divided by impressions. Average position is weighted by impressions. Neither ratio is summed or averaged, and with no impressions both are stored as unavailable. A recorded zero-session day stays 0 and a day the provider did not return stays unavailable. Search Console asks for `dataState: final` and ends three Pacific days back; row limits, paging and truncation handling are unchanged for the pages and queries jobs. A derived report is an ordinary partition under the existing template key, so readers, exports and the UI are untouched.

**Parity**: a test runs the bundle, then asks the fictional provider for the same windows directly, and compares. GA4 channel rows are identical. Search Console clicks and impressions are identical and CTR and position agree to 9 decimal places. That proves the derivation, not that Google's own totals match the sum of its daily rows; see section 12.

## 6. Original versus optimised job counts

| Per connection per day | v1 | v2 |
| --- | --- | --- |
| GA4 | 31 | 20 |
| Search Console | 18 | 13 |
| Wix | 1 | 1 |
| **21 connections (1 + 10 + 10)** | **221** | **160** (−28%) |

Measured with `npm run analytics:capacity` (fictional provider, rolled back): 221 jobs and 221 requests under v1, 160 and 160 under v2. A page of more than 10,000 GA4 rows or 25,000 Search Console rows needs more than one request for that job; the landing-page bundle is the likeliest to do so.

Queue growth over seven days with no worker running: v1 reached more than 100 queued jobs for one GA4 connection; v2 stayed at 20 with older windows retired.

## 7. Execution capacity

Measured locally (our work only, instant provider): v1 683 ms for 221 jobs, v2 603 ms for 160, about 4 ms per job. **Local processing is not the constraint. Provider latency and the job count are, and provider latency was not measured** because no live call was made. The table uses stated seconds per request (including the database round trip) as scenarios, not findings.

Hosting limits, from Vercel's current documentation (read 12 Nov 2026):

| Limit | Value |
| --- | --- |
| Hobby function duration, fluid compute | Default and maximum 300 s |
| Hobby Schedules | At most every 15 minutes, 15-minute jitter, 5,000 runs per billing period |
| Hobby Cron Jobs (legacy) | Once a day, within the hour |
| Current route | `maxDuration` was 120 s with a 65 s job window; now `maxDuration = 300` with the same 90 s working budget unless `ANALYTICS_WORKER_BUDGET_MS` raises it (30 000 to 240 000) |

Runs needed per day for the v2 plan (160 jobs); v1 in brackets:

| Seconds per request | Current settings (40 jobs, 65 s window) | Maximum settings (100 jobs, 215 s window) |
| --- | --- | --- |
| 1 | 4 runs (v1 6) | 2 runs (v1 3) |
| 2 | 5 runs (v1 7) | 2 runs (v1 3) |
| 4 | 10 runs (v1 14) | 4 runs (v1 5) |

**Constraint: the day's work does not fit one invocation under any allowed setting.** The job limit tops out at 100 and the plan has 160 jobs; even at 1 second a request the current settings do 40. The D55 schedule runs once a day, so it would leave most of the work undone. Stage 2.2 needs several runs a day (for example every 30 minutes for three hours is 6 runs, 180 a month against the 5,000 limit), which the Hobby Schedules limits allow. That has not been configured or tested.

Provider quotas, from Google's documentation: GA4 allows 200,000 tokens per property per day and 14,000 per project per property per hour, 10 concurrent requests, and blocks a project after 10 server errors per property per hour; a typical request costs about 10 tokens, so 20 requests a day is nowhere near the limit. The connection pause matters for the error limit: it spaces retries instead of firing one per job. Search Console allows 1,200 queries per minute per site and 40,000 per minute per project; its load quota is higher for page or query grouping over long ranges, so the pages and queries jobs are the ones to watch. Requests run one at a time, so concurrency limits are not approached.

Storage: batching cut a 5,000-row report from 25,016 statements to 36 and from 1,263 ms to 99 ms locally. On a hosted database each statement is a network round trip, so the unbatched figure would have been tens of seconds (the per-statement latency is an assumption; the statement counts are measured).

## 8. Retry and failure behaviour, as tested

| Case | Behaviour |
| --- | --- |
| Timeout or dropped connection | `retry`, code `provider_unavailable`, job back to `queued` with backoff, connection paused. After 5 attempts: `failed` |
| 429 with `Retry-After: 900` | `retry`, code `rate_limited`, job and connection wait at least 900 s |
| Body not JSON, not an object, or `rows` not a list | `retry`, code `invalid_response`. The previously published report keeps its generation |
| Expired lease | Requeued with backoff by the reaper. On the last attempt: `failed`, code `lease_expired` |
| Missing server setting (token key, Google client) | Stays queued, no attempt used, connection status unchanged, no provider call |
| Failed write during storing | Nothing is published, the job stays `leased`, and the next worker takes it after the lease expires |
| Revoked grant | Connection becomes `reconnect_required`, as before |

## 9. Database effects and recovery

Migration `0046_analytics_scheduling.sql`, additive only:

| Object | Purpose |
| --- | --- |
| `analytics_jobs.window_class`, `priority` | Retire superseded windows, order the queue. Existing rows get `null` and 50 |
| `analytics_connections.last_served_at`, `cooldown_until`, `consecutive_failures` | Fair rotation and connection pause |
| `analytics_jobs_class_idx` | Finds the queued job a new window replaces |
| `analytics_jobs_one_lease_idx` (unique, where `state = 'leased'`) | One leased job per connection, enforced by the database |

No new table, no policy change; existing grants and RLS apply to the new columns. No table is added to the backup inventory.

**Before production**: run `select connection_id from analytics_jobs where state = 'leased' group by 1 having count(*) > 1`. If it returns a row the unique index will fail to build; reap those leases first. The migration is transactional, so a failure leaves nothing behind. Production also needs the controlled procedure in `docs/DEPLOYMENT.md` with a restore point.

**Rollback**: `packages/db/rollback/0046_analytics_scheduling.down.sql`, run as the owner after the previous code is deployed (or `ANALYTICS_PLANNER=v1` is set). It drops the two indexes and five columns and removes the `schema_migrations` row, and deletes no data. A test runs it inside a rolled-back transaction, checks the objects are gone and the row counts are unchanged, then re-applies the migration.

## 10. Tests

Commands: `npm test` (both workspaces), `npm run typecheck`, `npm run lint`, `npm run test:decisions`, with `ANALYTICS_FIXTURE_MODE=1` and the hosted enquiry URLs blanked, against the local database.

| Command | Result |
| --- | --- |
| `npm test` `packages/db` | **38 files, 244 passed, 0 failed** (was 37 files, 217) |
| `npm test` `apps/platform` | **22 files, 135 passed, 0 failed** (was 131) |
| `npm run typecheck` | Exit 0, all three workspaces |
| `npm run lint` | Exit 0 |
| `npm run test:decisions` | 8 passed, 0 failed |

`next build` was not run; the only route change is the exported `maxDuration` constant and the worker budget helper, which the route tests exercise.

New file `packages/db/test/analytics-scheduling.test.ts` (27 tests) plus 4 contract tests in `apps/platform/src/lib/analytics-window-contract.test.ts`:

| Required case | Test |
| --- | --- |
| 1 Normal daily synchronisation | GA4, Search Console and Wix: 34 jobs, 34 requests, all succeeded, derived figures checked |
| 2 Multiple clients and websites | Two clinics, 40 jobs, partitions never cross clients |
| 3 Duplicate-job prevention | Planning three times queues 20 once; the database refuses a second queued copy |
| 4 Fair scheduling | First four leases go to four different connections; priority never goes backwards across providers |
| 5 Seven consecutive days | A worker each day: 34 of 34 succeed each day, earlier reports stay published |
| 6 No unbounded growth | Seven days, no worker: v2 holds 20 queued, v1 exceeds 100 |
| 7 Timeout and retry | Retry, backoff, connection pause, healthy connection unaffected, `failed` at 5 attempts |
| 8 Expired lease | Recovered and re-leased; last attempt fails |
| 9 Missing credentials | Both missing Google client and missing token key |
| 10 Invalid responses | Four kinds, prior report not replaced |
| 11 Zero-session dates | Zero stored as 0, unreturned day absent and uncovered |
| 12 Incomplete periods | Current day `partial`, then `complete` the next day |
| 13 API rate limiting | `Retry-After` honoured by job and connection |
| 14 Concurrent workers | Nine simultaneous leases from separate transactions: no job twice, no connection twice, the database rejects a second lease. Uses a committed fixture, removed afterwards (checked: 0 left) |
| 15 Cross-client isolation | Partitions, jobs and runs invisible to staff without access |
| 16 Database transaction failure | A failed store publishes nothing and recovers |
| 17 Production guard refusal | Test and worker guards refuse a host marked production, and an unlisted remote host |

Also: window contract (every window v1 made available is still stored, for four time zones and boundary dates, and for the real period selector); derivation arithmetic; capacity arithmetic; the stop reasons; rollback.

Two existing tests were changed. After a rate limit the connection now pauses, so the next lease in those tests moves the clock forward past the pause (`analytics-sync.test.ts`, `provider-fixtures.test.ts`). That is the intended new behaviour.

## 11. Files changed

New: `packages/db/migrations/0046_analytics_scheduling.sql`, `packages/db/rollback/0046_analytics_scheduling.down.sql`, `packages/db/src/analytics/scheduling.ts`, `packages/db/src/testing/fictional-analytics-provider.ts`, `packages/db/scripts/analytics-capacity.ts`, `packages/db/scripts/analytics-heavy.ts`, `packages/db/test/analytics-scheduling.test.ts`, this report.

Changed: `packages/db/src/analytics/sync.ts` (planner switch, enqueue and supersede, fair lease, connection pause, resilient fetch and response checks, bundle derivation, batched storing, partial coverage), `.../maintenance.ts` (stop reason), `.../providers/ga4.ts` (bundle templates), `packages/db/src/index.ts`, `packages/db/package.json` (two scripts), `apps/platform/src/app/api/internal/analytics/worker/route.ts` (`maxDuration` 300, budget setting, `stopped` in the answer), the contract test, two adjusted tests, `.env.example`, `docs/ENVIRONMENT.md`, `docs/DECISIONS.md` (D68), `docs/BUILD_STATUS.md`.

## 12. Risks and limitations

1. **Not validated against live providers.** Parity is proven against a fictional provider that is consistent by construction. Whether Search Console's property totals equal the sum of its daily rows, and whether GA4's range totals equal the sum of its daily rows (sampling, thresholding, attribution by session start), must be compared on real data before the schedule is enabled.
2. **Provider latency is unmeasured**, so the run counts in section 7 are scenarios.
3. **Existing production queue is not retired.** Jobs already queued have no window class, so supersession never touches them. Retiring them is a data change that needs your approval and is not implemented or run. Proposed for Stage 2.2: a dry run that counts queued, unleased jobs whose end date is before the current plan's, then a separate approved cancellation.
4. **One daily run cannot do the work** (section 7).
5. **The unique lease index can fail to build** if production holds two leased jobs on one connection (pre-check in section 9).
6. **No pruning.** Finished and cancelled job rows grow by about 160 a day (about 58,000 a year), and every refresh adds a partition generation. This matches the previous behaviour and is small, but it is unbounded. Pruning would delete history and needs a decision.
7. **Provider-level pause is per connection.** A Google-wide outage pauses each of the 21 connections after its own first failure, so up to 21 early failures can occur before all are paused. GA4's limit is 10 server errors per property per hour, and each property is paused after its own first.
8. **Landing-page bundle size.** 90 days of landing pages can exceed one 10,000-row page. Paging exists (up to 20 pages), but one job can then take several requests.
9. **`maxDuration` is 300 in code.** It takes effect only at deployment. The working budget stays 90 s unless set.
10. **Definitions.** No metric definition changed. The Search Console totals are now derived from daily rows; they are the same measures, computed from their parts. Recorded as D68 and flagged for the live comparison.

## 13. Required configuration

Nothing is required to keep the current behaviour. Optional:

| Setting | Meaning |
| --- | --- |
| `ANALYTICS_PLANNER` | `v2` default; `v1` restores the D52 plan |
| `ANALYTICS_WORKER_BUDGET_MS` | 30 000 to 240 000; default 90 000 |
| `ANALYTICS_WORKER_JOB_LIMIT` | 1 to 100; default 40 |

## 14. Rollback

1. Set `ANALYTICS_PLANNER=v1` to stop queueing the new plan. Jobs already queued run as queued.
2. To remove the code, restore the previous commit. The new code and the old code both run on the migrated schema.
3. To remove the schema, deploy the previous code first, then run the rollback script (section 9).
4. Local only: `npm run db:reset && npm run db:migrate && npm run db:seed`.

## 15. Readiness for Stage 2.2

**Not ready to start until these are decided or done:**

1. Phase 1 reaches PASS (secrets backup in the password manager, editor-history decision).
2. Approval to compare derived and direct reports on real data, read-only, for a small number of connections, and to accept or reject the derived Search Console totals.
3. Approval to retire the existing queued production jobs, after a dry-run count.
4. A schedule that runs several times a day, since one run cannot finish the work, and a decision on its cadence. Hobby allows every 15 minutes.
5. A production migration under the `docs/DEPLOYMENT.md` procedure with a restore point and the lease pre-check.
6. Real request latency from a controlled run, to replace the scenarios in section 7.

Nothing here enables a schedule, changes the Root Directory, or touches production. Stage 2.2 will not start without your instruction.
