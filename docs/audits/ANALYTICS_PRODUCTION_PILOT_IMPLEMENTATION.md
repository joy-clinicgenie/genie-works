# Analytics Production Pilot Implementation (C1 and C2)

> **Renumbered 23 Nov 2026** when this work moved onto `main` (branch `analytics-phase2`): migrations `0046_analytics_scheduling` and `0047_analytics_worker_invocations` in this record are now `0053` and `0054`, because main already used 0046 and 0048–0052. Decisions are cited by their new numbers D68–D72.

Date: 2026-11-13. Branch: `analytics-phase1-closure` (uncommitted working tree).
Scope: local implementation and testing only. Nothing was deployed. No production credentials, migrations, worker invocations or schedules were touched. No production database was read.

Evidence labels: [C] code, [T] local automated test, [R] local rehearsal against a throwaway database, [D] documentation, [N] not verified.

## 1. Exact files changed

Pre-existing work was snapshotted (68 files hashed) before editing; afterwards 0 files were missing.

Modified:
- `packages/db/src/analytics/sync.ts`: C1 error taxonomy (`ServerCredentialError`), refresh and API-disabled classification, `failClaimedJob` branches, lease scoping (`LeaseScope`, `onlyConnectionId`, `onlyJobIds`), connected-only leasing, scoped lease reaping, `probeConnectionCredentials`.
- `packages/db/src/analytics/worker-run.ts`: exported `registerInvocation` / `closeInvocation`; `remainingWork` accepts a connection filter and ignores disconnected connections.
- `packages/db/src/client.ts`: `withReadOnlyContext` (read-only transaction with RLS context).
- `packages/db/src/index.ts`: exports `analytics/pilot`.
- `.env.example`, `docs/ENVIRONMENT.md`: `ANALYTICS_PILOT_ALLOWED_CONNECTIONS`, `ANALYTICS_HEALTH_REMOTE_CONFIRM`.
- `docs/DECISIONS.md` (D72), `docs/BUILD_STATUS.md`.

New:
- `packages/db/src/analytics/pilot.ts`: allow-list, request parsing, plan, probe, bounded run.
- `apps/platform/src/app/api/internal/analytics/pilot/route.ts`: protected route.
- `apps/platform/src/app/api/internal/analytics/pilot/route.test.ts` (10 tests).
- `packages/db/test/analytics-credential-safety.test.ts` (18 tests).
- `packages/db/test/analytics-pilot.test.ts` (31 tests).
- `packages/db/scripts/analytics-connection-health.ts` (read-only health check, `npm run analytics:health`) and its `package.json` script.
- `docs/audits/ANALYTICS_PRODUCTION_CONNECTION_RECOVERY_PLAN.md` (updated note) and this file.

Not changed: no migration (still 0001 to 0047), no `vercel.json`, no `.env`, Vercel Root Directory untouched.

## 2. C1 test results (non-destructive credential failures)

Behaviour [C][T]:
- Server-side credential problems no longer flag a connection `reconnect_required`: unreadable sealed token or wrong encryption key (`token_unreadable`), OAuth client rejected on refresh with 400/401/403 (`oauth_client_rejected`), provider API disabled (`provider_api_disabled`), and missing server configuration (`ConfigurationError`).
- For these, the connection status and sealed token are unchanged. The job goes back to `queued` without consuming an attempt, waits 2 hours, and the connection gets a 2-hour cooldown with `consecutive_failures` incremented.
- Genuine revocations still disconnect: `invalid_grant`, no stored token, no refresh token, no Wix site reference, data-API UNAUTHENTICATED/403 access withdrawn.
- When a connection is flagged, its other queued jobs are resolved as `reconnect_required` instead of being retried. The worker also no longer leases jobs for non-connected connections.

Results [T]: `analytics-credential-safety.test.ts` 18/18 pass. This covers 9 server-side failure cases (connection and secret byte-identical, 2h wait, at most one provider request per connection), missing configuration, genuine revoked-grant cases still disconnecting, recovery after the key is fixed without using attempts, and the provider breaker holding remaining jobs after 3 failures.

## 3. C2 test results (one-connection pilot route)

Route: `POST /api/internal/analytics/pilot` [C].
- Auth: same bearer check as the worker (`ANALYTICS_WORKER_SECRET` or `CRON_SECRET`); 401 before anything else.
- Disabled unless `ANALYTICS_PILOT_ALLOWED_CONNECTIONS` lists at least one reference (403 "The pilot is not enabled.").
- The connection is identified by a reference (first 8 hex of sha256 of the connection UUID) that must be on the allow-list. Unlisted and unknown connections get an identical refusal message and an audit entry.
- Body is strict JSON, at most 2048 bytes. Modes: `probe` (read-only; token-endpoint refresh only, token discarded) and `run` (at most 12 fixed-window jobs, optional `maxJobs`, `requeueWaiting`).
- Run is idempotent (`refreshAfterSeconds: null`), uses an invocation record `pilot:<ref>`, refuses overlap, and writes `analytics.pilot.refused|probe|run` audit events.
- `GET` returns 405; responses are `no-store`.

Results [T]: `analytics-pilot.test.ts` 31/31 pass (request and plan parsing, allow-list, read-only probe including real DB read-only enforcement, GA4/GSC/Wix runs, idempotence, `maxJobs`, isolation, retry, rate-limit, invalid response, credential failure, revoked grant, DB failure, overlap cap, audit completeness and no-leak, committed-fixture lease concurrency). `route.test.ts` 10/10 pass.

Full suite [T]:

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:decisions` | 8 pass, 0 fail |
| `packages/db` tests | 46 files, 400 tests pass (previously 44 / 351) |
| `apps/platform` tests | 24 files, 155 tests pass (previously 23 / 145) |
| `db:migrate:status` | 48 applied, none pending |

## 4. Security verification

- Authentication precedes all work; secret comparison reuses the worker's existing check [C][T].
- Allow-list is explicit; empty list means the route is off. Refusals for unlisted and unknown connections are indistinguishable [T].
- Responses and audit metadata contain no tokens, secrets, property or site identifiers, or client data; asserted by a no-leak test over audit metadata and results [T].
- Probe runs inside a read-only transaction and the database rejects writes there [T]. It discards the access token.
- Encrypted tokens are never rewritten by failure paths (byte-identical check) [T].
- Row-level security still applies; the route uses the service context only for trusted server work, as the existing worker does [C].
- Credential key-shape scan of the working tree: clean.
- Request size and shape are bounded; unexpected errors return a generic 500 [T].
- [N] Behaviour against real Google and Wix endpoints is unverified.

## 5. One-connection isolation evidence

Unit and integration [T]: a snapshot of every other connection's row, its queued backlog and its expired leases is identical before and after a pilot run. Only the selected connection's expired leases are reaped. Tokens used for data requests belong only to the selected connection.

End-to-end rehearsal [R] (temporary test through the real route handler against a throwaway migrated and seeded database, since dropped; temporary test file deleted):
- Wrong bearer: 401. Unlisted ref from another clinic: 403 with the identical message.
- Probe: ready, 1 token-endpoint request.
- Run with `maxJobs: 1`: 1 job. Then the rest: 10 jobs (11 total). Repeat: 0 jobs, 0 requests.
- All 11 data requests carried connection A's refreshed token; none carried connection B's.
- Connection B's 2 queued jobs untouched, 0 sync runs for B, both connections still `connected`.
- Audit: 1 refused (denied), 1 probe (success), 3 run (success); invocation rows `pilot:<ref>`.

## 6. Production prerequisites

1. Run the production health check (`npm run analytics:health`) under owner authorisation, and record the result and the connection reference. Nothing here has read production.
2. Phase 1 security conditions closed (secret backup file, editor history).
3. A restore point taken.
4. Review and commit the working tree (the repository is public; confirm no secrets or real data).
5. Migrations 0046 and 0047 applied to production with owner approval. Production code's own analytics tests passed against a schema with both applied.
6. Deploy C1 to C3 as one release.
7. Set `ANALYTICS_PILOT_ALLOWED_CONNECTIONS` to the single reference from the health check; confirm `ANALYTICS_LIVE_REPORTS=true`.
8. Pilot order: probe, then run `maxJobs: 1`, then full run, then reconcile figures with GA4.
9. Only afterwards add the schedule via `apps/platform/vercel.json` (new static schedules start active in production; check the location in a Preview first). Do not change the Root Directory.

## 7. Rollback procedure

1. Remove `ANALYTICS_PILOT_ALLOWED_CONNECTIONS`; the route returns 403 immediately.
2. Vercel instant rollback to `dpl_94dGLXaQZxLe51DCBqGWa2zHkHS8` (commit fcdc846).
3. Unpublish pilot report partitions (generation 1, count 11) rather than deleting.
4. Revert the code. Migration rollback files for 0046 and 0047 are in `packages/db/rollback`.
5. If a connection was flagged wrongly, reset it by admin SQL only after the cause is fixed.

## 8. Readiness for a controlled production pilot

Code readiness: ready for review. C1 and C2 are implemented, and the automated suite, typecheck, lint and decision tests pass.

Not yet ready to run in production until section 6 is done. Known limitations:
- Wix uninstall is no longer auto-detected as a revocation (treated as a server-side failure).
- The probe confirms the OAuth client only against the real provider; [N] until run in production.
- The 3-day capacity simulation test was slow once (284 s timeout in Phase 2.3A); it has passed on re-runs and the cause is not established.
- Live behaviour with real Google and Wix responses is unverified.

Recommendation: proceed to a controlled single-connection pilot only after the owner completes prerequisites 1 to 7. Stop here until then.
