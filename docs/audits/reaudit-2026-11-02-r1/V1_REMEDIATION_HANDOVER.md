# Remediation handover

2 November 2026, Asia/Singapore. This file records the test-isolation batch that followed the re-audit in this directory. The six re-audit reports were not edited. No score was added, and no live integration was marked verified.

## Identity

| Item | Value |
| --- | --- |
| Reported candidate | `53a876cdf042b73f04a24420a9f1f608b45ed337` |
| State at the start of this batch | `add38c4382d74d70c7616758b251b188594a2d7c`, the previous handover. That commit was kept. |
| Tested checkout SHA | `d658cd82d2cecf51b02fc38012e961cd83b0a7c0` |
| Parent of the tested checkout | `add38c4382d74d70c7616758b251b188594a2d7c` |
| Branch | `main`, not pushed |
| This handover | A later local commit. It was not part of the tested checkout. |
| Runtime | Node v24.15.0, npm 12.2.1, Next.js 16.4.2 |
| Lockfile SHA-256 | `14853308e5f98f6a02eedf1d16eaaecdcaac9d17bb4442e8761fd8597efbc2d9` |

The reported candidate is the parent of the previous handover. This batch did not rewrite it. The tested checkout adds disposable fixture and rehearsal targets on top of that history, including the earlier recovery, source-binding and layout changes.

## What this batch changed

The analytics isolation test creates a fictional Clinic Genie website inside its own rolled-back transaction. The tenant split and the repeat-sync replacement stay asserted. No seed row was added.

`npm test` creates and drops `clinic_genie_enquiry_test_suite_db` for the database package and `clinic_genie_enquiry_test_suite_app` for the platform package. Those tests do not read `ENQUIRY_DATABASE_URL` as their reset target. A reset still throws before it changes rows when a stored reference is outside `TEST-%`. The platform test still refuses the platform database and port 54329 before a connection, and demonstration rows still stay out of production totals and the production export.

`npm run db:rehearse` checks the admin host and the target names before any drop. It then replaces only `clinic_genie_rehearsal_isolated` and `clinic_genie_enquiry_test_isolated`. A remote host, port 54329, production, a shared name, and an admin connection that is itself one of those targets are refused first. `enquiry:seed`, `enquiry:reset` and `enquiry:link` still refer to the stored fixture. They were not run.

## Commands and results

Database URLs were supplied in the command and pointed only at `127.0.0.1:54339`. The workspace `.env` remote database was not used. `APP_DB_PASSWORD` for these commands was the existing local application password. No mail was sent.

### Working tree, before the tested commit

| Command | Result |
| --- | --- |
| `npm run db:migrate` and `npm run db:seed` on `clinic_genie_isolation_rehearsal` | 39 migrations applied, 14 imported directory clients removed, seed 6 staff, 1 client, 4 tasks |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npm run test:decisions` | 8 passed, 0 failed |
| `npm test` | Database package: 24 files passed, 108 tests passed. Platform package: 12 files passed, 57 tests passed |
| `npm run build` | Exit 0 |
| `npm run db:rehearse` | Replaced only the two isolated databases. Clients `clinic-genie` and `meridian-skin`. Enquiry database `clinic_genie_enquiry_test_isolated`, 6 synthetic enquiries, 6 notifications |

### Clean checkout of `d658cd82d2cecf51b02fc38012e961cd83b0a7c0`

The checkout was a detached worktree at `/Users/joystyle/vsc/clinic-genie-isolation-check`. `git status --short` was empty and the worktree had no `.env`. `npm ci` installed 428 packages. The worktree was removed after the checks.

| Command | Result |
| --- | --- |
| `npm run db:migrate` and `npm run db:seed` on fresh `clinic_genie_checkout_rehearsal` | 39 migrations applied, seed 6 staff, 1 client, 4 tasks |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npm run test:decisions` | 8 passed, 0 failed |
| `npm test` | Database package: 24 files passed, 108 tests passed. Platform package: 12 files passed, 57 tests passed |
| `npm run build` | Exit 0 |
| `npm test -w @clinic-genie/db -- test/recovery-follow-up.test.ts` | 1 file passed, 1 test passed, 2.64s. One fictional follow-up restored, `follow_ups_without_wix_website` was 0, one saved report file restored, and both mismatch lists were empty |
| `npm run db:rehearse` | Same isolated result as the working tree: two fictional clients, 6 synthetic enquiries, 6 notifications, database `clinic_genie_enquiry_test_isolated` |
| `npx tsx e2e-batch08/prepare.mts` | Created only `clinic_genie_b08` and `clinic_genie_enquiry_test_b08`, then loaded 6 fictional enquiries |
| `NEXT_DIST_DIR=.next-batch08 npm run build -w @clinic-genie/platform` | Exit 0 |
| Playwright `layout.spec.ts` and `enquiries.spec.ts` on ports 3408 and 3409 | 4 passed in 8.5s |

Layout overflow on `/clients`:

| Width | Page overflow | Header overflow | Overlaps |
| --- | --- | --- | --- |
| 390 | 0 | 0 | 0 |
| 768 | 0 | 0 | 0 |
| 1440 | 0 | 0 | 0 |

The production server refused the fixture before a read. The fixture journey saved follow-up status, retried the failed fixture notification, and exported a CSV that did not contain the fixture reference. No email was sent.

## Existing fixture

`clinic_genie_enquiry_test` was counted before the suite, after both rehearsal runs, and after the disposable databases were dropped. It stayed at 11 enquiries, 6 with a `TEST-` reference and 5 other synthetic rows. It was not reset, seeded or restored.

`clinic_genie` is still at migration `0036_wix_enquiry_binding.sql`. `clinic_genie_rehearsal` is still at `0035_connection_secret_admin.sql`. Port 3400 was not restarted. After the isolated servers stopped, `/sign-in` on port 3400 still returned 200. Ports 3408 and 3409 were stopped. The disposable databases from this batch were dropped. Left in place: `clinic_genie`, `clinic_genie_rehearsal` and `clinic_genie_enquiry_test`.

## Clean fictional rehearsal

A clean fictional rehearsal through `npm run db:rehearse` is supported. The command uses disposable local databases, checks them before any drop, and does not replace `clinic_genie`, `clinic_genie_rehearsal` or `clinic_genie_enquiry_test`. It was run once before the commit and again in the clean checkout. Both runs left the stored fixture at 11 enquiries.

This is not a pilot or production candidate. The manual enquiry fixture commands still name the stored fixture.

## Remaining live and hosted blockers

- DEP-01 has no named non-production analytics property.
- DEP-02 has no approved connection for either source. No live Wix access is claimed.
- DEP-03 still has no inbox receipt for DEP03D-A72CDF. No mail was sent.
- DEP-04 has no deployment.
- DEP-05 and D22 keep the historical SQL. No history rewrite was done.
- DEP-06 report states are decided by D23. Hosted artifact durability is still unverified. The local recovery check above does not close it.
- DEP-07 has no consuming clinic site.
- DEP-08 names Joy and does not accept a rollback procedure.

No live Wix, Google, Resend or production provider call was made. Nothing was pushed or deployed.
