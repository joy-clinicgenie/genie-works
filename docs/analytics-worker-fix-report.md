# Analytics worker reliability fix

Date: 2 November 2026  
Scope: analytics job creation, claiming, provider execution, result promotion, retry recovery and backlog assessment.

## Outcome

The hosted worker path now claims and records an attempt in a short service-context transaction, performs GA4, Google Search Console or Wix requests without holding a database transaction, and commits the result and terminal job state in a separate short transaction. One failed job no longer stops the invocation from attempting later eligible jobs.

The existing provider request bodies, parsers, pagination caps, source time zones, fixture guard, credential encryption, RLS policies and client scope remain in place. `ANALYTICS_LIVE_REPORTS` was not enabled. No production credential was created, changed or displayed. No queued production job was executed, cancelled or deleted.

## Root cause

The D38 worker had already gained a batch loop, but `drainMaintenance` called the complete `runWorkerOnce` function inside `withContext`. That transaction included:

1. due-job creation;
2. lease acquisition and attempt increment;
3. credential loading and token refresh;
4. every provider request and pagination call;
5. partition promotion and job finalization.

An exception or function timeout could therefore roll back the lease, attempt and failure record together. The same oldest job could be selected again. The two-minute lease also had no renewal or deadline check, while one provider job could make several requests.

Job scheduling was repeated once per batch iteration. Active duplicates were prevented, but a completed range was represented by a new row on a later refresh. Queue labels also did not distinguish ready work, processing, delayed retry and permanent failure.

Affected implementation files were:

- `packages/db/src/analytics/sync.ts`
- `packages/db/src/analytics/maintenance.ts`
- `apps/platform/src/app/api/internal/analytics/worker/route.ts`
- `apps/platform/src/app/actions/analytics.ts`
- `apps/platform/src/components/modules/AnalyticsConnections.tsx`
- `packages/db/migrations/0020_analytics_connections.sql` (inspected, not edited)
- `vercel.json` (inspected, not edited)

## Changes

Migration `0042_analytics_job_reliability.sql` adds recovery timestamps, an administrator retry count and claim/connection-lease indexes. It does not replace tables or weaken grants or RLS.

The worker now:

- enqueues due windows once per invocation;
- uses `FOR UPDATE SKIP LOCKED` to claim one due job;
- allows only one leased job per provider connection, including across overlapping workers;
- increments the attempt and inserts a running sync record in the claim transaction;
- carries only the required connection, encrypted credential and capability snapshot out of that transaction;
- decrypts or refreshes credentials and calls the provider outside a database transaction;
- checks the worker deadline before every GA4 or GSC page and before Wix work;
- locks the claimed row by job id and lease owner before accepting results;
- atomically stores refreshed credentials, capabilities, partitions, rows, metrics, coverage and the succeeded state;
- persists provider failures in a separate transaction;
- continues draining after failed, retry-scheduled or reconnect-required jobs;
- rejects a late result from a stale lease owner;
- reuses the same job identity for a repeated completed reporting window instead of adding another row.

Result promotion and job success remain in one completion transaction. A crash before commit leaves the old published partition intact and the job leased for recovery. A crash after commit leaves the job succeeded. Repeating completion after ownership has changed is ignored.

## Queue and retry rules

The database keeps its compatible storage values. The interface presents them as:

- `queued` and due: **Queued**
- `leased`: **Processing**
- `queued` with `next_attempt_at` in the future: **Retry scheduled**
- `succeeded`: **Succeeded**
- `failed`: **Permanently failed**
- `reconnect_required`: connection recovery is required before work can continue
- `cancelled`: retained operational history

Attempts are incremented when a lease is acquired. Retryable 429 and 5xx responses honor `Retry-After` and use exponential backoff starting at 30 seconds, capped at 30 minutes. A worker-deadline stop uses the same bounded retry path. Five attempts cause permanent failure.

An expired lease is persisted as `lease_expired`. Before five attempts it is queued after backoff; at five attempts it becomes permanently failed. Any unfinished sync-run row for that lease is closed as failed.

An administrator can retry permanently failed jobs for a currently connected source. The same rows are reset for a new bounded attempt cycle, `manual_retry_count` is incremented, and an audit event is written. Specialists, managers and inactive administrators cannot invoke the database service successfully. Reconnect-required work is not bypassed.

## Scheduling and Vercel configuration

`vercel.json` still invokes `GET /api/internal/analytics/worker` at `0 2 * * *` in `sin1`. The route accepts either `CRON_SECRET` or `ANALYTICS_WORKER_SECRET` through its existing timing-safe bearer check.

The route explicitly sets `maxDuration = 120`. Current Vercel Fluid Compute documentation gives every plan a 300-second default, but the explicit route value is the effective repository configuration. The worker retains a 90-second overall maintenance budget, stops starting analytics jobs after 65 seconds, and leaves at least 30 seconds before the route limit. The linked Vercel project setting could not be inspected because the Vercel integration remained unavailable; deployment verification is still required.

`ANALYTICS_WORKER_JOB_LIMIT` optionally sets 1–100 jobs per invocation and defaults to 40. Time budget still wins over the count. Provider calls remain sequential, and jobs sharing a connection cannot overlap.

Required hosted values remain:

- `DATABASE_URL`
- `ANALYTICS_TOKEN_KEY`
- applicable Google/Wix provider credentials
- `CRON_SECRET` or `ANALYTICS_WORKER_SECRET`

`ANALYTICS_FIXTURE_MODE=1` continues to reject non-local provider hosts. `ANALYTICS_LIVE_REPORTS` remains off by default and was not changed.

## Read-only backlog assessment

The configured Neon database was queried only with `BEGIN READ ONLY`. No worker or mutation was run.

At 2 November 2026:

- 69 jobs were queued;
- GA4: 5 queued and 1 succeeded;
- Search Console: 54 queued and 3 cancelled;
- Wix: 10 queued;
- 0 processing;
- 0 retry scheduled;
- 0 failed;
- 0 reconnect required;
- the oldest queued job was created at 30 October 2026 01:48:02 UTC.

The queue contains 24 Search Console jobs whose reporting window is older than a newer queued window for the same connection and report type. They are retirement candidates, not automatic deletions. The Wix queue contains nine jobs for 2 September–2 November and one job for 30 August–30 October; the older job must be checked against its connection and website before any retirement approval.

Only one GA4 `traffic_range` partition, covering 23–30 October for one website, is currently published. There is no daily analytics coverage in the inspected database.

Consequences for dashboard periods:

- **Last 7:** run the newest GA4 `traffic_daily` and relevant Wix daily jobs first. Search Console needs a matching verified range if it is to drive a seven-day report.
- **Last 30:** the newest Wix 62-day job can provide daily traffic after verification. GA4 and Search Console need approved 30-day range/backfill jobs; the current queued GA4 and GSC windows are shorter.
- **Last 90:** Wix cannot recover the oldest 28 days through its 62-day endpoint unless those dates were already stored. No such stored daily coverage was found. GA4 and Search Console require explicit approved 90-day backfill/range jobs.

Missing days must remain unavailable. They must not be converted to zero.

## Safe backlog recovery

1. Deploy the migration and worker to an authorized non-production environment.
2. Verify the function duration, region, secrets and provider permissions without changing `ANALYTICS_LIVE_REPORTS`.
3. Run one authenticated worker invocation and confirm that attempts, sync runs and queue counts move as expected.
4. Process newest required jobs first: GA4 daily/range, newest Wix daily windows, then newest GSC totals/pages/queries.
5. Compare stored figures with provider consoles for identical dates and time zones:
   - Wix total sessions by Asia/Singapore source date;
   - GA4 sessions and exact-range users in the bound property time zone;
   - GSC clicks, impressions, CTR and average position using Pacific dates;
   - GSC page and query rows against the same final-data range.
6. Queue approved 30- and 90-day GA4/GSC backfills where source retention permits.
7. Review the 24 older GSC jobs and the older Wix job. Cancel or retire them only after explicit approval and after newer-window coverage is verified.
8. Keep live reporting off until dashboard totals reconcile with source figures. A fixture pass is not live-provider verification.

Repeated manual worker calls may be used for controlled catch-up after the first invocation is verified. Do not run more than one catch-up operator per connection and do not alter production credentials during recovery.

## Reporting validation

Automated fixtures verify:

- Wix daily sessions, including a genuine zero and an absent metric that remains absent;
- the exclusive Wix API end-date conversion;
- GA4 daily sessions and exact-range users without summing distinct users;
- GSC pagination failure preserving the previous complete partition;
- missing GA4 provider metrics stored as `unavailable`, not zero;
- published partition replacement without adding the previous value;
- provider-time-zone and GSC Pacific due windows;
- cross-client connection, queue and result isolation;
- one provider connection cannot execute two jobs concurrently.

Live source figures were not available for reconciliation. Therefore Wix, GA4 and GSC production totals, dashboard parity and hosted cron execution remain unverified.

## Tests and actual results

- Analytics database suites: 29/29 passed after the final rollback-recovery test.
- Analytics platform suites: 14/14 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed for all workspaces.
- `npm run build`: passed with Next.js 16.4.2.
- `npm run test:decisions`: 8/8 passed.
- `npm test`: platform 60/60 passed; database 126/127 passed.

The one full-suite failure is pre-existing and unrelated: `backup-coverage.test.ts` reports that `seo_index_checks` and `seo_speed_checks` from migration `0039_search_checks.sql` are not classified by the backup policy. This was already recorded in `docs/performance-optimisation-report.md` and was not changed as part of the analytics worker fix.

All database tests and migration work used the embedded local PostgreSQL on port 54339. The new migration was not applied to Neon or any production database.

## Remaining blockers

- Apply migration `0042` through the approved deployment process.
- Confirm the linked Vercel project’s function setting and observe a hosted invocation.
- Verify provider credentials and source-side figures in an authorized non-production property.
- Approve any historical job retirement.
- Approve and run the range backfills needed for Last 30 and Last 90.
- Resolve the unrelated Site Health backup classification failure separately.
- Keep `ANALYTICS_LIVE_REPORTS` disabled until reconciliation is signed off.
