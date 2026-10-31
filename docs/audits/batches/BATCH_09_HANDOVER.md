# Batch 09 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 09 — Local deployment, monitoring and rollback preparation |
| Date | 31 October 2026, Asia/Singapore |
| Starting SHA | `dfdc8c85065416f012c770927b017feebc19a6e8` |
| Implementation SHA | `b6fe84b5c04eb6521a8bd333b2a26399d67a87e0` |
| Tested checkout SHA | `b6fe84b5c04eb6521a8bd333b2a26399d67a87e0` |
| Branch | `main`, not pushed |
| Evidence commit | The documentation commit whose parent is the implementation SHA. No push. |

Hosted staging was not started. No project was created or deployed. Untracked `.cursor/`, `apps/platform/public/client-marks/`, `audits/`, `docs/release-readiness/` and `reports/` were left unstaged. No decision was added. Latest approved decision remains D21. GW-008 stays blocked. GW-004, GW-005 and GW-006 stay partially fixed.

## Environment

| Alias | What it is |
| --- | --- |
| `repo` | This repository at the implementation SHA. |
| `configured-db` | The `DATABASE_URL` already present in the local environment. Its host is not this machine. The name and host were not printed. No test connected to it. |
| `local-postgres` | Port 54339 was not listening. It was not started. |
| `app-dev` | Port 3400 was not listening. The previously reported PID 40673 was absent. No server was started. |

No provider was called. No mail was sent. `.env` was not edited. Port 54329 was not used.

## Files changed

Implementation commit, 15 files:

- `packages/db/src/analytics/sync.ts` — `platformSyncHealth` returns queue counts and a short safe error code.
- `apps/platform/src/lib/operations-readiness.ts` — environment class, secret presence, and the sentences on the report.
- `apps/platform/src/lib/operations-status.ts` and `apps/platform/src/app/api/internal/operations/status/route.ts` — administrator-only status.
- `apps/platform/src/app/(app)/admin/page.tsx` — the same sentences on Admin.
- Tests for the report, the sync counts, the worker bearer, the cron path, the lease retry text, and the production fixture refusal.
- `docs/DEPLOYMENT.md`, `docs/STAGING_ACTIVATION.md`, `docs/14_MONITORING_RECOVERY_HANDOVER.md`, `docs/ENVIRONMENT.md`, `docs/HANDOVER.md`, `docs/BUILD_STATUS.md`, `README.md`.

Applied migration files were not edited.

## Prepared and exercised

| Capability | Prepared | Exercised this batch |
| --- | --- | --- |
| Repository deployment inventory | Yes. `docs/DEPLOYMENT.md` | Read from the files in the repository. External accounts were not opened. |
| Environment classes | Yes. Local rehearsal, connected staging, production, and unassigned remote. | Unit tests. A local production process stays local rehearsal. A remote development database is not called staging. |
| Placeholder runtime secrets | Already rejected by `assertRuntimeAuthSecret`. The report now says missing or placeholder without copying the value. | Unit tests. `preview-build-only` does not appear in the report. |
| Enquiry fixture production refusal | Unchanged. | `assertEnquiryFixtureUrl` still throws when `NODE_ENV` is production. |
| Operations report | Yes. Admin page and `GET /api/internal/operations/status`. | Assembled in unit tests. No HTTP request was made. |
| Enquiry source, failed notifications, failed or stale analytics, stalled worker lease | Sentences in the report. | Unit tests with fixture counts. No live source, no mail, no provider. |
| Scheduler | `vercel.json` cron, GET and POST handler, bearer check, lease retry before five attempts. | Source and function tests. No manual worker call and no hosted run. |
| Rollback instructions | Yes. Application revision and database restore are separate. Roles are named. People are not. | Not executed. The Batch 03 restore was not repeated. |
| Staging checklist | Yes. `docs/STAGING_ACTIVATION.md` | Not activated. |

## Fixed and verified

No GW row changed status. The new report and the runbooks are local preparation. They do not close a gate.

## Partially fixed

GW-004, GW-005 and GW-006 stay partially fixed. DEP-05, DEP-01, DEP-02 and DEP-03 are still open. Batch 09 did not add live evidence.

## Blocked

| ID | Why it stays blocked |
| --- | --- |
| DEP-04 | No authorised staging project, team, or permission to connect this repository. |
| DEP-01 | No named non-production property and no provider call. |
| DEP-02 | No approved enquiry source. The local fixture is not that source. |
| DEP-03 | No sender, no recipient, and no message. |
| DEP-05 | No repository-owner choice about the historical migration files. This is not a hosting setting. |
| GW-008 / DEP-06 | No report-state decision and no final artifact. |
| DEP-07 | No clinic website was shown calling the API. |
| DEP-08 | No person accepted the rollback path. The role table does not name one. |

## Unverified

- Hosted monitoring, a hosted cron invocation, and any setting that exists only outside this repository.
- Mail delivery, live analytics, and a clinic website rendering an article or SEO setting.
- WCAG conformance. Batch 08’s browser pass was not repeated and was not a conformance claim.
- The full test suite, ESLint, and a browser check of the Admin operations card.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `npm test -w @clinic-genie/platform -- src/lib/operations-readiness.test.ts src/lib/analytics-worker.test.ts src/lib/runtime-policy.test.ts` | 0 | 3 files, 11 tests. |
| `npm test -w @clinic-genie/db -- test/operations-health.test.ts test/fixture-targets.test.ts` | 0 | 2 files, 8 tests. |
| `npm run typecheck -w @clinic-genie/platform` | 0 | |
| `npm run typecheck -w @clinic-genie/db` | 0 | |

The first typecheck failed because the new test assigned `NODE_ENV` directly. The test was changed to use a mutable view of the environment. Typecheck and the tests above were then run again and passed. That assignment change is in the implementation SHA.

## Next batch

Batch 10 can perform a local re-audit of the evidence already recorded. Its file asks for a clean checkout, typecheck, lint, tests, the decision checks, a build, and the applicable browser and recovery checks.

It cannot close DEP-01 through DEP-08, approve a connected pilot, or treat hosted staging as done. Production remains a separate decision. This session does not start Batch 10.
