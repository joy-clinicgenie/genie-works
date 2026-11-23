# Analytics Phase 2.2: worker execution, scheduling and queue recovery

> **Renumbered 23 Nov 2026** when this work moved onto `main` (branch `analytics-phase2`): migrations `0046_analytics_scheduling` and `0047_analytics_worker_invocations` in this record are now `0053` and `0054`, because main already used 0046 and 0048–0052. Decisions are cited by their new numbers D68–D72.

Date: 13 November 2026, Asia/Singapore.
Decision: D69 in `docs/DECISIONS.md`.
Branch: `analytics-phase1-closure`, working tree only. Nothing is committed, pushed, deployed or scheduled.
Environment: local embedded PostgreSQL (`127.0.0.1:54339`, `clinic_genie`), fictional provider, virtual clock, fictional data.

**Result: Stage 2.2 is implemented and tested locally. Under the stated latency assumptions (1, 2 and 4 seconds a request) a 30-minute schedule clears the whole day's queue for all 21 sources with a wide margin, in every simulated scenario, including partial provider failures. Nothing here is proven against a live provider: request latency, Google's own totals, and the real production queue have not been measured. Stage 2.3 has not started.**

## 1. Executive summary

The Phase 2.1 report ended with a constraint: one run a day cannot process 160 jobs. This stage answers it with a worker that is meant to be called many times a day, and with the controls that make that safe.

| Question | Answer |
| --- | --- |
| Can the daily queue be cleared inside hosting limits? | Yes, in simulation. At 4 s a request the 30-minute schedule needs about 12 busy runs a day of 48 and clears the worst burst in 5.1 hours. See section 4 |
| What stops a 30-minute schedule multiplying requests? | A window already fetched is not fetched again. Without this rule the Phase 2.1 code, scheduled every 30 minutes, would have queued every succeeded window again on every run (section 5) |
| How many jobs a day? | 160 at the start, 140 from day 7, 120 from day 30, **100 from day 90**, because a previous-period window that equals an earlier current one is reused where it had settled |
| Can the old queue be cleaned safely? | A read-only dry run lists what is obsolete. Cancelling needs an approval token naming the exact set. It deletes nothing |
| Does a failed provider hold anyone else up? | No. Tested for outage, rate limit, timeout, expired grant and bad body. A provider-wide fault now also holds that provider's healthy connections (the breaker) |
| What is still unproven? | Live latency, live parity, the real production queue, and the production schedule itself. Section 11 lists the exact access needed |

Five things I found and fixed while testing, because they would otherwise have caused real harm:

1. **Re-queue storm.** On the 2.1 code, every planning pass re-queued every succeeded window. Fine once a day, 48 times worse at a 30-minute cadence. Fixed by the reuse rule.
2. **A window reusing unsettled data.** A reappearing window can only be reused if it was fetched after the provider had finished it. GA4 and Wix take about two days to settle, so those are fetched again; Search Console is requested as final, so it is reused. Reusing a GA4 window blindly would have kept understated numbers.
3. **A queue recovery rule that would have cancelled previous-period windows.** My first definition of "obsolete" (a newer window of the same length exists) matches every previous-period window. Two redefinitions failed their tests before the final one: older than 36 hours, not one of today's windows, ends before today's plan, and a length the plans have used.
4. **Failed windows were never retried.** A provider outage longer than about 2.5 hours exhausted a job's five attempts and left that window unfetched until it rolled over. A window whose job failed for a transient reason now earns one fresh set of attempts after six hours; the failed row stays.
5. **Two of my own failure tests passed vacuously.** The outage was scheduled when no work was due. Both the simulation and the test now place faults just after each provider replans and assert that the faults were really hit.

## 2. Architecture changes

| | Phase 2.1 | Phase 2.2 |
| --- | --- | --- |
| Entry | `drainMaintenance`: plan, drain, maintenance, in one function | `runWorkerInvocation` (`worker-run.ts`): register, plan, drain, report; `drainMaintenance` is a thin wrapper that adds maintenance |
| Planning cost | One query per planned job (160 selects a run) | Two queries when nothing is to be added |
| Repeat invocations | Re-queued every succeeded window | A window is fetched once; partial-day windows once, or on an opt-in interval |
| Time budget | Stop starting jobs 25 s before the end | Same, plus the longest job seen in the run is held in reserve, so a slow provider does not push the last job past the limit |
| Overlap | Database prevents two leases on one connection | Same, plus at most 2 invocations at once (configurable); a third records `overlap` and exits |
| Record of a run | None | One row per run in `analytics_worker_invocations`: jobs, outcomes, remaining due and waiting, duration, stop reason |
| Stop reasons | `empty`, `limit`, `deadline` | `idle` (nothing to do at all), `empty`, `limit`, `deadline`, `overlap`, `error` |
| Provider fault | Per-connection pause | Per-connection pause, plus a provider breaker: three failing connections of one provider hold that provider's healthy ones |
| Failed windows | Left failed | One fresh set of attempts after six hours if the cause was transient |
| Maintenance (index inventory, URL inspection, PageSpeed) | Every invocation | At most once per 23 hours, so those Google calls stay at one pass a day |
| Old queue | Not addressed | Dry run and approved cancel (`queue-recovery.ts`) |

Job-level safety is unchanged and still lives in the database: a unique partial index allows one leased job per connection, and a unique partial index refuses a second queued copy of a window.

## 3. Scheduling strategy

### Vercel limits, checked 13 November 2026 against the official documentation

| Fact | Source page |
| --- | --- |
| Hobby: most frequent cron schedule is every 15 minutes; jitter window is always 15 minutes; shortest interval must be at least the jitter | `vercel.com/docs/schedules/limits` |
| Hobby: 5,000 runs per billing period, scheduled and manual together; over the limit Vercel skips scheduled runs | same |
| Function duration, fluid compute: Hobby default and maximum 300 s | `vercel.com/docs/functions/limitations` |
| Runs are independent; a slow run does not delay the next, so runs can overlap | `vercel.com/docs/schedules/concepts` |
| Path and function targets are not retried | same |
| After a delay, every occurrence that has not expired is delivered. An occurrence expires after its jitter window plus the shortest interval between runs, counted as at least 10 minutes. For `*/30` on Hobby that is 15 + 30 = 45 minutes, so at most two catch-up runs | same |
| Delivery is normally once, but a duplicate cannot be ruled out | same |
| Schedules are in beta; limits may change before general availability | same |

### Proposed cadence (not registered)

`*/30 * * * *` UTC, the existing schedule name `analytics-worker` (renaming resets its history), path target and `GET` as in D55. That is 48 runs a day, about 1,440 a month: 29% of the Hobby allowance, leaving room for manual runs and catch-ups. On Hobby each run starts somewhere in a 15-minute window after its slot; the simulation applies a deterministic 0 to 15 minute delay to each run.

The root `vercel.json` is **unchanged**: one schedule, `0 2 * * *`, no `crons`. A test (`leaves the repository schedule exactly as D55 set it`) fails if anything else is registered. The proposed entry is:

```json
"analytics-worker": { "schedule": "*/30 * * * *", "path": "/api/internal/analytics/worker", "requestMethod": "GET" }
```

### How one invocation behaves

1. Register in `analytics_worker_invocations` under an advisory lock. Rows still `running` after the budget plus two minutes are marked `abandoned` (the process died). If two others are running, record `overlap` and return.
2. Plan: read the connected sources and the jobs that already exist in two queries; queue only what is missing.
3. Work the queue one job at a time: priority first, then the connection served longest ago, then the newest window. Stop at the job limit, at the deadline (budget minus 25 s, minus the longest job seen so far), or when nothing is due.
4. If time remains and a maintenance pass is due (23 hours), run it.
5. Count what remains, split into **due** (the next run can start it) and **waiting** (backing off, connection cooling, or held by the breaker), and close the record.

### Cost of doing nothing

A run with nothing to do costs **12 database statements and no provider request** (measured by a test that counts statements). With 48 runs a day and about 12 of them busy at the slowest latency, most runs are of this kind.

## 4. Worker capacity measurements

### Method

`packages/db/test/simulation.ts` runs the real worker against the real local schema and a fictional provider on a virtual clock. Each provider request advances the clock by the stated latency plus 250 ms for parsing and storing (an assumption: measured local processing is about 4 ms a job, a hosted database adds round trips). Production-sized set: 1 GA4, 10 Search Console, 10 Wix. Seven days, 336 invocations at a 30-minute cadence with 0 to 15 minutes of jitter, default settings (90 s budget, 40-job limit, up to 2 at once). The full output is `docs/audits/ANALYTICS_PHASE_2_2_SIMULATION.json`. Reproduce with `npm run analytics:simulate -w @clinic-genie/db` (about four minutes).

**Latency is an assumption, not a measurement.** No live provider was called.

### Results, seven days

| Scenario | Jobs queued | Completed | Backlog at end | Busy runs a day | Jobs per busy run (mean, max) | Run length, s (mean, max) | Longest time to clear | Max queue depth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 s a request | 1,230 | 1,230 | 0 | 5.3 | 33.2, 40 | 41.6, 50 | 1.6 h | 160 |
| 2 s | 1,230 | 1,230 | 0 | 7.4 | 23.7, 28 | 53.2, 63 | 2.6 h | 160 |
| 4 s | 1,230 | 1,230 | 0 | 12.1 | 14.5, 15 | 61.5, 63.8 | 5.1 h | 160 |
| 4 s, hourly cadence | 1,230 | 1,230 | 0 | 12.1 | 14.5, 15 | 61.5, 63.8 | 10.1 h | 160 |
| 4 s, 240 s budget, 100-job limit | 1,230 | 1,230 | 0 | 4.4 | 39.7, 50 | 168.6, 212.5 | 1.6 h | 160 |
| 2 s, partial failures | 1,170 | 1,154 (16 not completed, see below) | 0 | 9.1 | 18.9, 28 | 42.6, 63 | 10.2 h | 160 |
| 4 s, partial failures | 1,170 | 1,154 (same 16) | 0 | 13.3 | 13.0, 15 | 55.3, 63.8 | 11.5 h | 160 |
| 2 s, version 1 plan | 1,697 | 1,697 | 0 | 9.7 | 25.0, 28 | 56.2, 63 | 3.5 h | 221 |

"Longest time to clear" runs from the first run that finds queued work to the first run after which none is due, waiting or leased. Every run stayed inside the 90 s budget (the longest was 63.8 s with the default and 212.5 s with 240 s, which is below the 215 s working limit and the 300 s platform maximum).

Why 1,230 and not 7 × 160: GA4 and Wix replan at midnight Singapore, Search Console at midnight Pacific (16:00 Singapore), and from day 7 the previous-period windows are reused (section 5). The count is 160 + 6 × 30 + 7 × 130 − 20 = 1,230.

Requests per provider over seven days at any latency: GA4 140, Search Console 1,020, Wix 70, one request per job. Version 1 plan: 217, 1,410 and 70.

Requests per run are at most 28 (2 s) over about a minute. Search Console's documented limit is 1,200 queries a minute per site, and GA4's is 200,000 tokens a day per property, so neither is approached (Phase 2.1, section 7). Requests are sequential, so concurrency limits are not approached either.

### Capacity and break-even

Jobs per run is about min(40, 65 s ÷ (latency + 0.25 s)), less one when the reserve for the longest job stops the last one (at 16 s the real count is 3, not 4). With 48 runs a day:

| Seconds a request | Jobs per run | Jobs a day available | Needed (160, worst day 290) | Headroom on 160 |
| --- | --- | --- | --- | --- |
| 1 | 40 | 1,920 | 160 | 12× |
| 2 | 28 | 1,344 | 160 | 8.4× |
| 4 | 15 | 720 | 160 | 4.5× |
| 8 | 7 | 336 | 160 | 2.1× |
| 15 | 4 | 192 | 160 | 1.2× |
| 16 | 3 | 144 | 160 | **0.9× (does not fit)** |

Under the default settings the plan fits as long as the average request, including storing, takes under about 15 seconds. Raising the budget to 240 s extends that to about 50 seconds. A single request already has a 20 s timeout, and a job may need several pages, so the real figure to measure is the per-job time.

Execution time per run was never close to the 300 s platform limit. **Memory and CPU on Vercel were not measured**; the local figures are about 4 ms of our own processing a job and about 19 ms a job all-in (the whole seven-day simulation, 1,230 jobs and 336 runs, took 23 s of real time).

### Partial-failure scenario

Placed just after each provider replans, so it hits real work:

| Day | Fault | What the numbers show |
| --- | --- | --- |
| 2 onwards | Search Console property 10 loses its grant (401) | Marked `reconnect_required` once; its other jobs stop; nobody else affected |
| 3, 16:00 to 22:00 | Search Console down for every property (503) | 43 rejected calls in total (three probe connections trying on their own backoff), not one per queued job. The remaining healthy Search Console connections were held by the breaker, not called. GA4 and Wix finished on time. After the outage, 3 jobs that had run out of attempts were queued again and succeeded; **0 windows left unrecovered** |
| 4, 00:00 to 02:00 | Three Wix sites rate limited, `Retry-After` 900 | 12 rejected calls (four per site over two hours, one per run), then recovered |
| 5, 00:00 to 01:00 | GA4 times out | 2 extra requests, recovered |

Totals: 3 jobs reached `failed` (history kept), 41 retried, 1 connection needs a person, backlog 0 at the end. The 16 jobs not completed are the revoked connection's queued jobs and the 3 `failed` rows, which stay as history after their fresh replacements succeeded. I did not break the 16 down further.

## 5. Incremental synchronisation improvements

### Which reports need daily refresh

Readers match a report by its exact start and end date (`publishedReport`). The presets move one day every day, so every current window has to be fetched daily or the page finds nothing for that period. Nothing that a page reads today can be refreshed less often without changing what the page shows.

| Provider | Jobs per connection | Daily? | Notes |
| --- | --- | --- | --- |
| GA4 | 20 | All 20 | Current windows need it. `ga4.traffic_daily` (1) is a 181-day series ending today and is fetched once per window. Six `ga4.traffic_range` jobs (7, 30, 90 days and their previous periods) are exact-range because distinct users cannot be added across days (D13). Four bundles derive channel, landing page, device and country windows. Nine engagement, page and new-or-returning jobs are exact-range because rates and averages are not additive |
| Search Console | 13 | 7 now, 13 until day 90 | One daily bundle (clicks, impressions, CTR and position by day) derives `gsc.totals` for six windows. Pages and queries are exact-range because top-N lists cannot be rebuilt from daily rows. The six previous-period windows are reused once an earlier current window equals them (day 7, 30 and 90) |
| Wix | 1 | Yes | One 62-day request, all four measures |

### What is now avoided

| Duplicate | Rule | Effect |
| --- | --- | --- |
| The same window on every run of the day | A window fetched today is not queued again. A window that includes the provider's current day is fetched once, or every `ANALYTICS_PARTIAL_REFRESH_MINUTES` if set | In the test clinic (one source of each kind): 34 requests for the first run, 0 for the next 47. Proven: 4 further invocations the same day queue 0 and request 0 |
| A previous-period window that equals an earlier current window | If it had **settled** when fetched, it is not fetched again | Search Console only, from day 7. See below |
| Old windows nobody will read | A newer window of the same class retires the older queued one (Phase 2.1) | Queue stays bounded |

Settling: GA4 and Wix report a day's data for up to about two days after it ends, so a window fetched earlier (always, for a window ending yesterday) is fetched again if it ever returns. The test shows this exactly: when a week has passed, the two Search Console windows that reappear are not requested and the one GA4 window that reappears is. Search Console windows end three Pacific days back and are requested with `dataState: final`.

### Steady-state job count

`npm run analytics:steady -w @clinic-genie/db` applies the planner and the reuse rule over 400 days with no database (a 100-day database run was too slow to finish, so this is a calculation, not a database run). It agrees with the database run where they overlap (day 7 is 140 in both).

| Day | Jobs a day, all 21 sources |
| --- | --- |
| 0 | 290 (160 plus Search Console's own midnight) |
| 1 to 6 | 160 |
| 7 to 29 | 140 |
| 30 to 89 | 120 |
| 90 onward | **100** (GA4 20, Search Console 70, Wix 10) |

Compared with the diagnostic's 221 a day, that is −28% now and −55% at steady state, with no change to what any page can read.

### Not done, and why

True day-by-day incremental fetching (fetch only the last few days and merge with stored daily rows) would cut the remaining volume further. It needs a store of daily facts, which does not exist (partitions are per window), and its totals would need the live parity comparison first. It is a Stage 2.3 candidate, not a Stage 2.2 change. Metric definitions are unchanged. CTR and position derivations are untouched (Phase 2.1).

## 6. Queue recovery design

`queue-recovery.ts` and `npm run analytics:recover -w @clinic-genie/db`.

| Concern | Design |
| --- | --- |
| Identify obsolete queued jobs | A queued, unleased job with no window class (written by the version 1 plan) is obsolete only if all hold: older than 36 hours; not one of today's plan windows (so previous-period windows are kept); ends before today's plan does; and its length is one the plans have used (so a hand-picked range is left alone). Everything else is counted as "needs review" and left queued |
| Recover expired leases | The worker's reaper already requeues them (or fails the last attempt). The dry run counts them; `--apply` runs the same reaper under the same approval |
| Preserve completed reports | Only `queued` rows are touched. No partition, row, metric or coverage record is read for writing |
| Prevent duplicates | Cancelled jobs keep their row; the unique active index and the planner's reuse rule are unchanged |
| Preserve failed history | `failed` and `reconnect_required` rows are never changed. The dry run lists them by code |
| Read-only dry run | The default. It runs inside `set transaction read only`; a test shows an `update` is refused with SQLSTATE 25006 |
| Explicit approval | `--apply` needs `ANALYTICS_RECOVERY_APPROVAL` equal to the token the dry run printed: `recover:<eligible>:<expired leases>:<12-hex digest of the exact job ids>`. A stale token, an empty token or a token for a different set is refused, and a token cannot be reused after it has been applied |
| Non-local database | Needs `ANALYTICS_RECOVERY_REMOTE_CONFIRM=<host>` even to read, and `--apply` also needs `ANALYTICS_RECOVERY_BACKUP_REFERENCE` |
| Never deletes | The application role has no `DELETE` on these tables; cancellation is `state = 'cancelled'`, `safe_error_code = 'superseded_recovery'` |

Tests: the dry run changes nothing and lists 100 of 150 queued legacy jobs; an empty or wrong token is refused; the correct token cancels exactly the listed jobs and no other, leaves failed and finished rows and the row count unchanged, and cannot be reused; a leased job, a version 2 job, today's own window, its previous-period window, a hand-picked range and a recently queued job are all left alone and an expired lease is recovered rather than cancelled.

**It has not been run against production.** Section 11 says what is needed.

## 7. Failure-handling verification

Every item in the brief has a test. The first column is the brief's wording.

| Case | Test (`analytics-worker-capacity.test.ts` unless stated) | Observed |
| --- | --- | --- |
| Provider timeouts | `retries a timeout, honours a rate limit's Retry-After…` | One GA4 attempt, connection paused, other providers finished; recovered. Retry limits and `failed` after five: `analytics-scheduling.test.ts` |
| Rate limits | same, and simulation day 4 | `Retry-After` honoured; one attempt per site per run |
| Expired credentials | `marks only the connection with an expired grant…` | Only that connection becomes `reconnect_required`; 47 of 47 other jobs succeed |
| Missing production configuration | `keeps jobs queued without spending attempts when the server is not configured…` | 34 of 34 `not_configured`, 0 provider requests, attempts unchanged, recorded; waiting, not backlog |
| Invalid API responses | `never stores a malformed answer over a good report` | Retried, nothing stored, yesterday's report keeps its generation |
| Database connection failures | `records a database failure against the invocation and recovers the lease…` | The invocation row closes as `error`/`worker_error`; the job stays leased; the next run reaps and completes it; 34 of 34 |
| Concurrent workers | `lets two overlapping invocations share the queue…`, `refuses to run more invocations at once…`; nine simultaneous leases in `analytics-scheduling.test.ts` | No window taken twice; third invocation records `overlap`; stale `running` rows are abandoned |
| Worker interruption | the two tests above | Lease expires after 150 s and the next run takes the job |
| Retries and recovery | `gives a window whose jobs ran out of attempts…`, simulation outage | Fresh row after six hours, failed row kept, a rejected request is not retried |
| Provider-specific cooldowns | `holds a provider's healthy connections while three of its connections fail…` | Exactly three Search Console properties were tried; GA4 and Wix finished everything; on recovery everything completed (20 + 1 + 65 jobs) |
| Failed provider does not block others | all of the above, and the 7-day failure simulations | GA4 and Wix requests were exactly their planned counts through a six-hour Search Console outage |

## 8. Files changed

New:

| File | Purpose |
| --- | --- |
| `packages/db/migrations/0047_analytics_worker_invocations.sql` | Invocation record table |
| `packages/db/rollback/0047_analytics_worker_invocations.down.sql` | Rollback |
| `packages/db/src/analytics/worker-run.ts` | Invocation, drain, remaining work, environment readers |
| `packages/db/src/analytics/queue-recovery.ts` | Dry run and approved apply |
| `packages/db/scripts/analytics-queue-recovery.ts` | Recovery command |
| `packages/db/scripts/analytics-simulate.ts` | Capacity simulation command |
| `packages/db/scripts/analytics-steady-state.ts` | Steady-state job count (no database) |
| `packages/db/test/simulation.ts` | Simulation harness |
| `packages/db/test/analytics-worker-capacity.test.ts` | 28 tests |
| `docs/audits/ANALYTICS_PHASE_2_2_SIMULATION.json` | Simulation output |
| this report | |

Changed:

| File | Change |
| --- | --- |
| `packages/db/src/analytics/sync.ts` | Injectable clock; success time from the worker's clock; `enqueueJob` options (`now`, `refreshAfterSeconds`, `retryFailedAfterSeconds`); batched `enqueueDue` with the reuse and retry rules; provider breaker in `leaseNext`; `SETTLE_HOURS`, `windowWasSettledWhenFetched`, `partialRefreshSeconds`, `TRANSIENT_FAILURE_CODES` |
| `packages/db/src/analytics/maintenance.ts` | Rewritten as a wrapper over `runWorkerInvocation`; maintenance at most every 23 hours |
| `packages/db/src/backup.ts` | New table added to the backup inventory (a test requires every table be classified) |
| `packages/db/src/index.ts`, `packages/db/package.json` | Exports; `analytics:simulate`, `analytics:steady`, `analytics:recover` |
| `packages/db/scripts/analytics-work.ts` | Passes `trigger: "cli"` |
| `apps/platform/src/app/api/internal/analytics/worker/route.ts` | Uses the shared environment readers; passes trigger (`vercel-cron` user agent means `schedule`), concurrency cap and recording switch; answers `remainingDue`, `remainingWaiting`, `durationMs` |
| `packages/db/test/analytics-maintenance.test.ts`, `analytics-scheduling.test.ts` | Two deadline expectations changed (below) |
| `.env.example`, `docs/ENVIRONMENT.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md` (D69), `docs/BUILD_STATUS.md` | Documentation |

Behaviour change in two existing tests: a drain now declines to start a job the longest job so far says cannot finish before the deadline. Before, after a 60-unit job against a deadline of 100, a second 60-unit job started and ended at 120. That is the intended fix, and the tests now say so.

Unchanged: the root `vercel.json`, every provider module, the encrypted token code, all read paths and the Analytics UI.

## 9. Database migration effects

`0047_analytics_worker_invocations.sql`, additive only: one table, two indexes, row level security, no change to any existing object.

| Aspect | Detail |
| --- | --- |
| Table | `analytics_worker_invocations`: owner, trigger, state, start and finish, stop reason, budget, job limit, counts by outcome, remaining due and waiting, duration, `maintenance_ran`, safe error code. No client or secret data |
| Access | Service context writes; global staff (admin, manager) read; specialist, reviewer and read-only staff see nothing (tested) |
| Grants | Default privileges give the application role select, insert and update; it cannot delete. Rows are never pruned (about 48 a day, 17,500 a year) |
| Backup | Added to `BACKUP_TABLES`; the existing coverage test enforces it |
| Rollback | `packages/db/rollback/0047_analytics_worker_invocations.down.sql` drops the table and its migration record. A test runs it in a rolled-back transaction, checks job, connection and partition counts are identical, and re-applies the migration |
| Order | 0047 can be rolled back without 0046. To remove both, roll back 0047 first |
| Applied | Local database only (`Applied: 48, Pending: none`) |
| Switch | `ANALYTICS_RECORD_INVOCATIONS=off` stops writing the table and the overlap cap, so the code runs without the migration |

## 10. Test results

Environment: `ANALYTICS_FIXTURE_MODE=1`, hosted enquiry URLs blanked, local database.

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, all workspaces |
| `npm run lint` | exit 0 |
| `npm test` in `packages/db` | **39 files, 272 passed, 0 failed** (Phase 2.1: 38 files, 244) |
| `npm test` in `apps/platform` | **22 files, 135 passed, 0 failed** (unchanged) |
| `npm run test:decisions` | 8 passed, 0 failed |
| `npm run analytics:simulate -w @clinic-genie/db` | 8 scenarios, all backlog 0 |
| `npm run analytics:steady -w @clinic-genie/db` | 160 / 140 / 120 / 100 |
| `npm run analytics:recover -w @clinic-genie/db` (local, empty queue) | Dry run, exit 0, nothing changed |

`next build` was not run; the route change is an import swap and extra response fields, and typecheck and the route tests cover it. `maxDuration` is still the literal `300`.

Production environment guard: `database-environment.test.ts` and the Phase 2.1 guard tests pass unchanged, and a new test confirms the worker still refuses a database marked production outside the production deployment. The local `.env` points only at the local database. **Phase 1 is still CONDITIONAL PASS** (the secrets backup and the editor-history decision are open); nothing in this stage depended on it.

The 28 new tests cover: repeat invocations queue and request nothing; planning cost; partial-day refresh opt-in; settle rule by provider; Search Console reuse against GA4 re-fetch; manual refresh unchanged; failed-window retry; deadline stop and resume with no repeated request; job-limit stop; overlap cap and abandoned runs; concurrent invocations; database failure; missing configuration; provider breaker; expired grant; timeout and rate limit; invalid body; queue recovery dry run, approval, safety and cross-client isolation; two simulations (21 sources, three days; outage and revoked grant); guard refusal; schedule unchanged; read-only report; rollback.

## 11. Production deployment prerequisites

Nothing below has been done. None is a code change in this stage.

1. **Phase 1 reaches PASS** (secrets backup, editor-history decision).
2. **The Vercel Root Directory.** The Phase 2.1 report found it set to `apps/platform`, which means the root `vercel.json` (and so the schedule) is not read. This must be settled first, or no schedule will ever fire. Not re-checked in this stage.
3. **Production migrations 0046 then 0047** under `docs/DEPLOYMENT.md`: restore point first, `db:migrate:status`, the lease pre-check for 0046, `MIGRATE_PRODUCTION_CONFIRM` and `MIGRATE_BACKUP_REFERENCE`. The code needs 0046's columns, so 0046 cannot be skipped. 0047 can be deferred by setting `ANALYTICS_RECORD_INVOCATIONS=off`.
4. **Production environment variables** (names only; values not read or changed): `ANALYTICS_TOKEN_KEY`, `ANALYTICS_GOOGLE_CLIENT_ID`/`_SECRET`, `ANALYTICS_WIX_APP_ID`/`_SECRET`, `CRON_SECRET` or `ANALYTICS_WORKER_SECRET`. Phase 2.1 saw them listed for Production. Optional new ones are in section 12.
5. **Queue inventory and recovery**, in this order, with your approval at each step: (a) take the restore point; (b) run `npm run analytics:recover` against that restore point or a branch of it, not the live database; (c) review the report; (d) decide; (e) only then run `--apply` with the printed token.
6. **Live measurements** (section below), before the schedule is enabled.
7. **Schedule change**: edit `schedule` to `*/30 * * * *` in the root `vercel.json`, keep the name. Enable in Preview first (new static schedules start inactive there), run one manual invocation, read the answer (`stopped`, `remainingDue`, `durationMs`) and the invocation table, then promote.
8. **Plan limits**: confirm the account is on Hobby with the limits above, or Pro. A Pro plan would allow shorter cadences and 800 s runs; neither is needed.

### Access required for the measurements I could not make

| Need | Exact access | Safer route |
| --- | --- | --- |
| Read-only inventory of the real queue | Production `DATABASE_URL` supplied for one command, with `ANALYTICS_RECOVERY_REMOTE_CONFIRM` set to its host. The script opens a read-only transaction | Run it against a restore-point branch. That needs no access to the live database |
| Provider latency, rows per request, quota use | Read-only grants on one GA4 property and one Search Console site for a **Preview** deployment using the **Preview** database. Authorisation to make about 160 requests once | Use a test property, not a client's |
| Parity of derived and direct totals | The same read-only access, comparing a bundle's derived windows with direct requests for a handful of windows | |

## 12. Required configuration

Nothing is required to keep today's behaviour. Optional, all in `.env.example` and `docs/ENVIRONMENT.md`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `ANALYTICS_WORKER_BUDGET_MS` | 90000 | Working time per run, 30000 to 240000 |
| `ANALYTICS_WORKER_JOB_LIMIT` | 40 | Jobs per run, 1 to 100 |
| `ANALYTICS_WORKER_MAX_CONCURRENT` | 2 | Invocations at once, 1 to 5 |
| `ANALYTICS_PARTIAL_REFRESH_MINUTES` | unset | Refetch a partial-day window within the day, 15 to 1440 |
| `ANALYTICS_MAINTENANCE_INTERVAL_MINUTES` | 1380 | Index inventory, URL inspection and PageSpeed pass |
| `ANALYTICS_RECORD_INVOCATIONS` | on | `off` for rollback of 0047 |
| `ANALYTICS_PLANNER` | `v2` | `v1` restores the D52 plan |

Recommended starting point for the first live trial: defaults, 30-minute cadence, and look at `durationMs` and `remainingDue`.

## 13. Rollback procedure

1. Disable or remove the `*/30` schedule (the previous entry was `0 2 * * *`). Nothing is lost: windows already fetched are not fetched again, and the queue keeps its state.
2. Set `ANALYTICS_RECORD_INVOCATIONS=off` if the table is to go.
3. Deploy the previous release. The previous code runs on the migrated schema (columns and the new table are ignored).
4. To remove the table: run `packages/db/rollback/0047_analytics_worker_invocations.down.sql` as the owner role, after step 3. Then, if required, 0046's rollback.
5. Queue recovery cannot be undone by the script, but it deletes nothing: a cancelled job keeps its row with `safe_error_code = 'superseded_recovery'`. If one is wanted again, the planner queues the window the next time it is current.
6. Local: `npm run db:reset && npm run db:migrate && npm run db:seed`.

## Risks and limitations

1. **Latency, parity and the real queue are unmeasured.** Every capacity figure rests on a stated latency. The break-even is about 15 s a request under defaults.
2. **The reuse rule rests on assumed settling times.** The 48 hours for GA4 and Wix and the three days for Search Console `final` data are assumptions drawn from provider behaviour, not measured here. If Search Console data can still change after three days, a reused previous-period window would keep the older number. A GA4 or Wix window is only reused when fetched at least 48 hours after it ended, so a longer real settling time would also matter. The live comparison should check both.
3. **Hobby is a beta product.** Schedules limits "may change before general availability", and a run can start up to 15 minutes late.
4. **Overlap is bounded, not impossible.** Two runs may overlap; a third exits. After an outage, up to two catch-up runs can arrive together.
5. **A provider breaker can hold healthy connections up to two hours past the last failure** if the failing connections stop being retried.
6. **The queue recovery definition is conservative.** Legacy queued jobs it cannot prove obsolete stay queued and are reported. It treats a hand-picked range of exactly a plan length that ends before today's plan, and is over 36 hours old, as obsolete.
7. **No pruning.** Invocation rows (about 17,500 a year) and job rows (about 36,500 to 58,000 a year) grow without bound. Pruning would delete history and needs a decision.
8. **Only the route's own tests cover the hosted path.** The route calls `drainMaintenance`; the HTTP handler and Vercel's delivery were not exercised.
9. **Maintenance (URL inspection, PageSpeed) is gated by wall-clock interval** and was not re-tested against Google. It runs on a run with spare time.
10. **No true incremental daily store** (section 5).

## Readiness for Stage 2.3

**Ready to start, if you want it, on these conditions:**

1. You decide the scope. Candidates this stage surfaced: live read-only validation of latency and parity on a test property in Preview; the production queue inventory on a restore point; enabling the 30-minute schedule in Preview; a daily-fact store for true incremental fetching.
2. Phase 1 reaches PASS, and the Root Directory question is answered.
3. Authorisation for the specific access in section 11.

Stage 2.3 has not started and will not without your instruction.
