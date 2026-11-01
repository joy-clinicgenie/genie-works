# Remediation handover

2 November 2026, Asia/Singapore. This file records the focused fixes for the re-audit in this directory. The six re-audit reports were not edited. No full re-audit was repeated.

## Identity

| Item | Value |
| --- | --- |
| Candidate SHA | `53a876cdf042b73f04a24420a9f1f608b45ed337` |
| Tested checkout SHA | `53a876cdf042b73f04a24420a9f1f608b45ed337` |
| Branch | `main`, not pushed |
| Parent | `29bdb1564bad4d5483ba5ae7aa76deb5a87404bd` |
| This handover | A later local commit. It was not part of the tested checkout. |
| Runtime | Node v24.15.0, npm 12.2.1, Next.js 16.4.2 |
| Lockfile SHA-256 | `14853308e5f98f6a02eedf1d16eaaecdcaac9d17bb4442e8761fd8597efbc2d9` |

The candidate commit contains the previously uncommitted product tree plus these fixes. Untracked `.cursor/`, `apps/platform/public/client-marks/`, `audits/`, `docs/re-audit-pack/`, `docs/release-readiness/` and `reports/` were left unstaged. `apps/platform/next-env.d.ts` was restored after the temporary server wrote a generated path into it, and it is not in the commit. No `.env`, backup JSON or saved report JSON was committed.

## Findings fixed

### RA-001 — Recovery

`enquiry_follow_ups` is in the required backup table list. The backup also carries saved report JSON whose file exists, parses as `saved`, and matches the report id. Restore writes those files beside the restored database, in `{destination}-report-files`. It refuses a destination that is the source folder or inside it. It does not write over `docs/report`.

The migration classifier now includes the follow-up table. No other created table was missing from the backup or the explicit exclusion list.

Evidence: `packages/db/test/recovery-follow-up.test.ts` passed on a fresh local database. One fictional follow-up, its Wix website relationship, and one saved report file restored with no mismatches. The source artifact directory was not the destination. Shared, enquiry, remote, port 54329 and production database names stay refused by the existing guards. The test database names were dropped afterwards.

### RA-002 — Source onboarding

`enquiry_key` maps a website to enquiry rows in that website's own clinic database. It is `{client slug}-{environment}`, with a numeric suffix when needed. It is not a message copy. Staff who can manage the registry can set a key only when it belongs to that client and is not already used. An administrator can store one Wix site id, form id and form key. The namespace is fixed as `wix.form_app.form`, and `wix_counts_in_totals` stays false. A manager cannot change the Wix columns. The database trigger enforces that for the application role. The owner connection used by seed and existing tests is unchanged. Identifiers are stored. Enquiry answers are not.

Evidence: `packages/db/test/enquiry-source-binding.test.ts` and `packages/db/test/wix-enquiry-binding.test.ts` passed with fictional clients and UUIDs. No Wix API was called. `FORMS_WIX_NEW_INSTANCE_*` is still not read. DEP-02 is not resolved: no connection was approved and no live Wix access is claimed.

### RA-003 — Responsive layout

The clients header wraps below the desktop breakpoint instead of staying on one line at 768px. The clients table remains in a horizontal scroller. Search, status and a client link stay usable.

Evidence: Playwright on `127.0.0.1:3408`, page `/clients`, fictional seeded clients.

| Width | Page overflow | Header overflow | Overlaps |
| --- | --- | --- | --- |
| 390 | 0 | 0 | 0 |
| 768 | 0 | 0 | 0 |
| 1440 | 0 | 0 | 0 |

The 768px check also found the search field, the status filter, a client link, and `overflow-x: auto` on the table scroller.

### RA-004 — Browser fixture

The enquiry journey adds `from=2026-10-01&to=2026-10-31` to the fixture pages. The product date default was not changed. The production server still refuses the fixture before a read.

Evidence: Playwright `e2e-batch08/enquiries.spec.ts`, 2 passed. The specialist saved follow-up status `acknowledged` for `TEST-MS-NEW-004` and saw it after reload. The reviewer could not save. Specialist B could not see the row. The administrator retried the failed fixture notification and the pending row showed `Retry requested`. The export returned `text/csv` with a `Reference` header and did not contain the fixture reference or fixture address. The retry updated the fixture outbox only. No email was sent.

### RA-005 — Documentation

`docs/BUILD_STATUS.md` now says decisions run through D37 and the newest migration is `0038_enquiry_source_binding.sql`. D23 is recorded as the implemented report-state decision: draft and saved, not Approved or Final. Isolated recovery of the saved JSON is described separately from hosted disk or object-store durability, which remains unverified.

## Remaining blockers

- The test suite is not green. On a fresh local database the clean checkout failed 4 tests, all left in place:
  - `packages/db/test/analytics-sync.test.ts`: the internal `clinic-genie` client has no website, so the test reads `.id` of an empty row.
  - `packages/db/test/enquiry-fixture.test.ts`: two tests, plus the suite setup, refuse to reset `clinic_genie_enquiry_test` because stored references are outside `TEST-%`.
  - `apps/platform/src/lib/form-submissions.test.ts`: the same fixture guard. The shared fixture still has 11 enquiries, 6 with a `TEST-` reference and 5 other synthetic rows.
- DEP-01 has no named non-production analytics property.
- DEP-02 has no approved connection for either source. This work does not close it.
- DEP-03 still has no inbox receipt for DEP03D-A72CDF. No mail was sent.
- DEP-04 has no deployment.
- DEP-05 and D22 keep the historical SQL. No history rewrite was done.
- DEP-06 report states are decided by D23. Hosted artifact durability is still unverified.
- DEP-07 has no consuming clinic site.
- DEP-08 names Joy and does not accept a rollback procedure.
- `npm run db:rehearse` was not run. It drops `clinic_genie_rehearsal` and then resets the shared enquiry fixture. That reset is refused while non-fixture rows are present. The guard was not weakened.
- No live Wix, Google, Resend or production provider call was made.

## Checkout

The clean checkout was a detached worktree of `53a876cdf042b73f04a24420a9f1f608b45ed337` at `/Users/joystyle/vsc/clinic-genie-remediation-check`. `git status --short` was empty. `npm ci` installed 428 packages from the lockfile. The worktree had no `.env`. Database URLs were supplied in the command and pointed only at local port 54339. The worktree was removed after the checks.

The browser journeys ran on the working tree immediately before that commit, using the same files. They were not repeated inside the worktree.

## Commands and results

Isolated databases were `clinic_genie_remediation_rehearsal`, `clinic_genie_b08` and `clinic_genie_enquiry_test_b08` on `127.0.0.1:54339`. The workspace `.env` remote database was not used. Port 3400 was not restarted. After the checks, `/sign-in` on port 3400 still returned 200. Ports 3408 and 3409 were stopped. `clinic_genie` is still at migration `0036_wix_enquiry_binding.sql`. `clinic_genie_rehearsal` is still at `0035_connection_secret_admin.sql`.

| Command | Where | Result |
| --- | --- | --- |
| `npm run typecheck` | Working tree, then the clean checkout | Exit 0 both times |
| `npm run lint` | Working tree, then the clean checkout | Exit 0 both times |
| `npm run test:decisions` | Working tree, then the clean checkout | 8 passed, 0 failed both times |
| `npm test` | Fresh `clinic_genie_remediation_rehearsal` | Database package: 22 files passed, 2 failed, 103 tests passed, 3 failed. Platform package: 11 files passed, 1 failed, 56 tests passed, 1 failed. Failures are the four blocker tests above |
| `npx vitest run` of backup coverage, enquiry source binding, report artifact, Wix binding and recovery | Same local database, before the suite was repeated | 5 files passed, 10 tests passed. Recovery took 3.3s and reported a restored follow-up and one report file |
| `npm run build` | Working tree, local database variables | Exit 0 |
| `NEXT_DIST_DIR=.next-batch08 npm run build -w @clinic-genie/platform` | Working tree | Exit 0 |
| `npx tsx e2e-batch08/prepare.mts` | Local only | Created the two `b08` databases, migrated, seeded, and loaded 6 fictional enquiries |
| Playwright `layout.spec.ts` and `enquiries.spec.ts` | Ports 3408 and 3409 | 4 passed in 7.3s |
| `npm ci`, typecheck, lint, decision checks and `npm test` | Clean checkout | Install, typecheck, lint and 8 decision checks passed. The first test run reused a database an earlier suite had written to, and `report-builder.test.ts` then failed on `report_snapshots_current_idx`. That database was recreated. The fresh run matched the four known failures and no others |

One earlier `npm test` was refused before it started because the shell still pointed at `clinic_genie_reaudit_rehearsal`. It did not migrate or write.

## Clean fictional rehearsal

A separate local recovery rehearsal is supported. The recovery test created its own database, restored one fictional follow-up with its Wix relationship, restored one saved report file beside that database, and left the source folder alone.

A clean rehearsal through `npm run db:rehearse` is not supported. That command targets the existing `clinic_genie_rehearsal` database and then the shared enquiry fixture. The fixture reset correctly refuses to continue. This is not a pilot or production candidate.
