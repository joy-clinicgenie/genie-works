# V1 release retest

31 October 2026, Asia/Singapore. This follow-up does not replace the original audit files in `audits/`. Those files remain the 30 October 2026 record of commit `359502ce015d5b0555609a5311ff969b7c806a74`.

## Candidate

| Item | Value |
| --- | --- |
| implementation_candidate_sha | `85b99c7d11a11feae4d5da93068d754a9dfcd5b4` |
| tested_checkout_sha | `85b99c7d11a11feae4d5da93068d754a9dfcd5b4` |
| Branch | `main`, not pushed |
| Checkout | Detached worktree of that SHA. Removed after the checks. |
| Runtime | Node v24.15.0, npm 12.2.1, darwin |
| Next.js | 16.4.2 |
| Playwright | 1.64.1 |
| Vitest | 4.1.12 |
| Lockfile SHA-256 | `14853308e5f98f6a02eedf1d16eaaecdcaac9d17bb4442e8761fd8597efbc2d9` |
| Latest approved decision | D21. No D22. |

The parent of the candidate, `a0af5a74461883a4523f3198b25fef8390933600`, points the report and form tests at the fictional clients. The candidate itself leaves the append-only sessions row in place. `npm ci` in the worktree installed 428 packages from that lockfile.

## Environments

| Alias | Use |
| --- | --- |
| `rehearsal-db` | New local database `clinic_genie_b10_rehearsal` on `127.0.0.1:54339`, in a data directory that belonged only to the worktree. Migrated, seeded, backed up, then dropped. |
| `restore-db` | `clinic_genie_b10_rehearsal_restore_test`. Created by the restore, checked, then dropped. |
| `journey-db` | `clinic_genie_b08`. Browser journeys. Dropped. |
| `enquiry-db` | `clinic_genie_enquiry_test_b08`. Fixture rows only. Dropped. |
| `journey-prod` | `next start` on `127.0.0.1:3408`. Stopped. |
| `journey-dev` | `next dev` on `127.0.0.1:3409`. Stopped. |

The configured application database was not used. Port 3400 was not listening. PID 40673 was absent. No provider was called. No mail was sent. No project was deployed.

## Commands

Two earlier suite runs are not the official result.

| Checkout | Command | Exit | Result |
| --- | --- | ---: | --- |
| `4acb0a585a2b033ecf33acca891fb276f57558a8` | `npm test` | 1 | Four database tests looked up the removed directory client `SUNRISE` or directory-era form rows. One platform test failed because that invocation had no `DATABASE_ADMIN_URL`. |
| `a0af5a74461883a4523f3198b25fef8390933600` | `npm test` | 1 | The report assertions passed, then cleanup tried to delete an append-only snapshot. Platform tests: 52 passed. |

Official commands on `85b99c7d11a11feae4d5da93068d754a9dfcd5b4`:

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run typecheck` | 0 | |
| `npx eslint . --max-warnings 0` in `apps/platform` | 0 | |
| `npm test` | 0 | 20 database files, 99 tests. 11 platform files, 52 tests. |
| `npm run test:decisions` | 0 | 8 passed, 0 failed. |
| `npm run build` | 0 | Next.js 16.4.2 production build. |
| `npx tsx e2e-batch08/prepare.mts` | 0 | 36 migrations, 14 directory clients removed, seed 6 staff, 3 clients, 14 tasks. Enquiry fixture: 6 enquiries, 6 notifications. |
| `npx playwright test --config=playwright.batch08.config.ts` | 0 | 16 passed, 20.3s. |
| `npm run db:recovery-fixture` | 0 | One fictional `recovery-check` article. |
| `npm run db:backup -- backups/b10` | 0 | Clients 4, `blog_activity` 1, `blog_articles` 1. |
| `npx tsx scripts/restore-test.ts <that file> --keep` | 0 | Restore test passed. |
| `npm audit --omit=dev` | 0 | 0 findings in production dependencies. |
| `npm audit` | 1 | 16 moderate findings in the full tree, including development dependencies. Not triaged here. |

`npm run db:restore-test -- <file> --keep` exited 1 before the script started, because npm treated `--keep` as its own flag. The direct `tsx` command above is the restore result.

Administrator `GET /api/internal/operations/status` on the production-mode journey server: unsigned 401, manager 403, admin 200. The admin body classified the process as `local-rehearsal`, with the runtime process `production`, the enquiry fixture not permitted, the enquiry source refused, the auth secret set, the database local, and no secret value in the JSON.

## Restore check

Source and destination slugs were `clinic-genie`, `harbourview-dental`, `meridian-skin` and `northgate-physio`. Blog slug `recovery-check`. Activity 1. Orphan checks 0. Migrations 36 and matched. RLS enabled. Specialists saw 11 and 3 of 14 tasks. Destination sessions, verification tokens and development magic links were 0. The source still had the disposable sign-in rows from the recovery fixture. The internal client’s contact fields were empty. The three seed clinics still have their seed contact fields; those rows are the fictional seed, and the 14 imported directory clients had already been removed.

## Issue follow-up

| ID | Original finding | Remediation | Current evidence | Remaining gap | Role and next action |
| --- | --- | --- | --- | --- | --- |
| GW-001 P1 | Production build failed on an unused `Link` import. | Import removed. | Fixed and verified. Typecheck and build exited 0 on this candidate. | None for this defect. | None. |
| GW-002 P1 | The audited screen was not the git revision. | The command centre was committed and checked out clean. | Fixed and verified. This re-audit used a clean checkout of one SHA. | None for this defect. | None. |
| GW-003 P1 | Debug ingest calls ran on signed-in requests. | The calls were removed. | Fixed and verified. The regression test is in the passing suite. | None for this defect. | None. |
| GW-004 P1 | Migrations stored a real clinic directory. | A fresh migrate removes those clients. Applied files were not edited. | Partially fixed. This batch again removed 14 imported clients from a new database. | The historical SQL remains in git. DEP-05 is open. | Repository owner records the history choice in `docs/DECISIONS.md`. |
| GW-005 P1 | Connected analytics were not synchronising, and there was no cron. | Queue, fixture sync, bearer checks and a cron file exist. | Partially fixed. Code and fixture checks passed. This batch did not call a provider or observe a hosted run. | DEP-01 and DEP-04. A prepared cron is not a hosted schedule. | Account owner names a non-production property. Hosting owner authorises a project. |
| GW-006 P1 | Enquiry screens had no source. | Local fixture behaviour is implemented, and production mode refuses it. | Partially fixed. Browser status, retry and export passed on the isolated fixture. The production server refused that fixture before a read. | DEP-02 and DEP-03. A fixture retry is not mail delivery. | Enquiry-source owner approves a source. Sender owner names the recipient. |
| GW-007 P1 | No backup or restore evidence for the schema. | Logical backup includes blog activity and leaves sign-in tables empty. | Fixed and verified for a local fictional database. This batch’s restore passed on the current 36-file schema. | This is not a hosted backup, and no person has accepted the rollback path. DEP-08. | Release owner names the person and the path. |
| GW-008 P2 | Reports do not use the D14 states. | No schema or decision change. | Blocked. The browser saved a draft and a review copy. The page did not show Approved or Final. | DEP-06. | Product owner records the workflow and where the final artifact lives. |
| GW-009 P2 | Demo seed was not idempotent. | Snapshot inserts skip an existing current row. | Fixed and verified. The suite passed, including the seed checks. | None for this defect. | None. |
| GW-010 P2 | Two files share the number 0034. | Both names are documented. The files were not renamed. | Fixed and verified. A fresh migrate applied 36 files, including both 0034 names. | A later tool that assumes unique numbers can still be confused. The runner applies both. | None inside this pack. |
| GW-011 P2 | Managers could store connection credentials. | Secret writes are administrator-only. | Fixed and verified. The suite passed, and the browser denied manager, specialist and signed-out Google starts before a provider. | None for this defect. | None. |
| GW-012 P2 | The narrow header overlapped. | Header actions collapse and show a focus outline. | Fixed and verified. At 390, 768 and 1440 the journey found no header overflow and no overlapping controls. | This sample is not a WCAG conformance claim. | None for the overlap defect. |
| GW-013 P2 | Development sign-in was enabled against the shared database. | Magic links and automatic admin creation stay off for production and shared databases. | Fixed and verified. The production-mode server had no email form, no Google button, and `/dev/magic-links` returned 404. | A future hosted project must leave the development flag unset. | Release owner confirms that on the hosted project. |
| GW-014 P3 | The home page had two `h1` elements. | The greeting is a paragraph. | Fixed and verified. The checked pages each had one `h1`. | Not a full WCAG audit. | None for the heading defect. |
| GW-015 P3 | Lint reported 11 warnings. | The warnings were removed without disabling a useful rule. | Fixed and verified. ESLint exited 0 with `--max-warnings 0`. | None for those warnings. | None. |
| GW-016 P3 | README and build status described an older product. | Those documents now describe the nine launch modules and the open limits. | Fixed and verified by the Batch 07 documentation review. This batch did not find a claim that live analytics, mail or website consumption is done. | Hosted operations remain open in the staging checklist. | None for the stale-document defect. |
| GW-017 P3 | `test:decisions` failed DAY-01. | The empty-repository checks now expect the specification pack. | Fixed and verified. 8 passed, 0 failed. | None for DAY-01. | None. |

Code that is fixed is not the same as an integration that was verified. GW-005, GW-006 and GW-007 show that split: the local code and fixtures passed, while the live provider, the mailbox and a hosted backup did not run.

## Score

The original rubric is in `audits/V1_RELEASE_SCORECARD.md`: feature grades 0–5, category points are the average divided by 5 times the weight, then rounded to the nearest point. Unverified work cannot score 5. A failed mandatory gate overrides the number. The original total was 53.

| Category | Weight | This retest | Why it moved, or why it did not |
| --- | ---: | ---: | --- |
| Functional completeness | 20 | 13 | Client creation was exercised in the browser, so that feature moves from 4 to 5. Leads on the isolated fixture move from 2 to 3. Analytics stays 2 and reports stay 3. Average 3.33 gives 13, the same category point. |
| Security and permissions | 20 | 14 | Debug ingest moves from 1 to 5. Production-mode development sign-in moves from 2 to 4. Directory text in git moves from 1 to 2 because a fresh database is fictional and the history is still present. The seven printed original grades sum to 18, while the published category was 13. This follow-up scores those printed grades after the changes: 25 / 7 = 3.57, which gives 14. |
| Data integrity and analytics | 15 | 7 | Freshness stays 1. No live window was compared. The original reduction to 7 still applies. |
| Forms and enquiries | 10 | 6 | The six graded features now average 3.83, which would be 8. It is reduced to 6 because the approved source is still absent and the production-mode server refused the fixture. |
| Integrations and publishing | 10 | 4 | The cron file moves the scheduler grade from 0 to 1. It was not invoked on a host, so the category stays 4. Mail stays 0. |
| UI, UX and accessibility | 7 | 5 | Narrow layout and the sampled keyboard focus move up. WCAG stays 2 because the sample is not a conformance claim. Average 3.67 gives 5. |
| Performance and stability | 5 | 4 | The production build moves from 0 to 5 and the debug request path moves from 1 to 5. Core Web Vitals stay 1. Average 3.6 gives 4. |
| Automated testing and code quality | 5 | 4 | Typecheck, lint, Vitest and the decision checks passed. Playwright’s 16 journeys score 4. Production `npm audit` was 0, with 16 moderate findings still present once development dependencies are included, so that feature stays 4. Pull-request CI stays 1. Average 4 gives 4. |
| Deployment and recovery | 5 | 3 | Local restore and the 36-file migrate move up. The repository cron and administrator report are prepared. There is still no staging project and no named rollback owner, so the category is 3 rather than a passing deployment grade. |
| Documentation and handover | 3 | 2 | The current documents match the nine modules and the open limits. Average 3.75 of the weight gives 2.25, which rounds to 2. |

13 + 14 + 7 + 6 + 4 + 5 + 4 + 4 + 3 + 2 = **62 / 100**.

62 is below the original 70-point band. The open P1 gates override the number in any case. This score is a judgement under the original rubric. It is not a production or pilot approval.

## Gates

| Gate | Result |
| --- | --- |
| No unresolved P0 or P1 | Fail. GW-004, GW-005 and GW-006 remain partially fixed. |
| Tested revision matches the candidate | Pass. One clean SHA was tested. |
| Production build | Pass. |
| Typecheck and lint | Pass. |
| Server-side authorisation and client isolation | Pass on the automated suite and the five-role browser journeys. |
| Enquiry source connected, and a failed notification cannot delete the enquiry | Fail for a connected source. The fixture preservation checks passed. Production mode refused the fixture. |
| Analytics are live and fresh, or clearly not synchronised | Partial. The screens stay blank without a sync. No live window was compared. |
| Backup and isolated restore for the current schema | Pass for the local fictional database. Not a hosted backup. |
| Staging separation, scheduler, monitoring and rollback | Fail for hosted operation. Local classification, the administrator report and the rollback notes exist. No project and no named owner. |
| No patient-record testing | Pass. |
| External provider calls | Blocked. No provider was called. |
| Secrets left out of the report | Pass. |

## Counts

| Status | P1 | P2 | P3 | Total |
| --- | ---: | ---: | ---: | ---: |
| Fixed and verified | 4 | 5 | 4 | 13 |
| Partially fixed | 3 | 0 | 0 | 3 |
| Blocked | 0 | 1 | 0 | 1 |
| P0 | 0 | 0 | 0 | 0 |

There is no next batch file in this pack. The connected-pilot inputs remain DEP-01 through DEP-08.
