# V1 remediation status

Batch 04. 30 October 2026, Asia/Singapore.

Original audit files stay at `audits/V1_GO_NO_GO.md`, `V1_RELEASE_SCORECARD.md`, `V1_MODULE_PARITY.md`, `V1_BUG_REGISTER.md`, `V1_TEST_RESULTS.md` and `V1_REMEDIATION_PLAN.md`. They were not edited. Latest approved decision is D21. No D22 or later decision is in `docs/DECISIONS.md`.

Batch 01 started at `359502ce015d5b0555609a5311ff969b7c806a74`. Its implementation candidate `2ff49401703730a43dd6c4127cee95c319575d1f` was checked out clean and verified. Batch 02 starts at `fad5d9726496bdd071aae3aaff2ccd02b5aa59f5`. Batch 03 starts at `a7b27636501339c82e30a5f1a806daaa81fc520a`. Batch 04 starts at `7e8c3f37012f45aafe5b1fd17bae86e2d594f4fe` on `main`. None of these batches is pushed.

Statuses: Not checked, Reproduced, In progress, Fixed awaiting verification, Fixed and verified, Partially fixed, Blocked, or Not applicable.

| ID | Class | Status | Current evidence | Owner role | Batch |
| --- | --- | --- | --- | --- | --- |
| GW-001 | Code defect | Fixed and verified | Unused `Link` import removed from `BlogWorkflow.tsx`. `npm run typecheck` exit 0 and `npm run build` exit 0 on the candidate, repeated in the clean checkout. | Engineer | 01 |
| GW-002 | Missing verification | Fixed and verified | The candidate home page imports `AgencyOverview` and no longer has `LaunchDashboard`. Clean checkout on port 3401: unsigned `/` redirected to sign-in; a fictional local sign-in then received `/` with status 200, title `Dashboard \| Clinic Genie`, and the heading `Agency Overview`. | Engineer | 01 |
| GW-003 | Code defect | Fixed and verified | No `127.0.0.1:7835` ingest call remains in application source. The regression test covers the layout, session, shell, Back button and database client. The signed-in page had no resource entry for that host. | Engineer | 01 |
| GW-004 | Environment / configuration gap | Partially fixed | A fresh local database `clinic_genie_rehearsal` kept only `clinic-genie`, `harbourview-dental`, `meridian-skin` and `northgate-physio`. Fourteen imported directory clients were removed in that run, and website hosts and contact emails were `example.invalid` or empty. Applied migration files were not edited. `schema_migrations` on the existing local `clinic_genie` database still matches all 35 files. DEP-05 remains open, so the historical SQL is still in git. | Repository owner for the history decision; engineer for the fresh-setup strip | 02 |
| GW-005 | Environment / configuration gap | Partially fixed | Local queue, fixture and scheduler preparation are in place. The worker accepts GET and POST after a worker or cron bearer. Unauthenticated GET and POST on the rehearsal app returned 401. `vercel.json` prepares a daily GET at 02:00 UTC and was not deployed. Settings shows queue counts, the safe error, and the last succeeded sync run. A fixture row with `verified_at` of 2020-01-01 showed 15 Oct, 10:00 from the sync run. Fixture tests passed. No live provider was called. The live window and the hosted schedule stay blocked on DEP-01. | Engineer for the local worker; hosting and account owners for the live check | 04 |
| GW-006 | Environment / configuration gap | Reproduced | The clean-checkout configuration left `ENQUIRY_DATABASE_URL` empty. No enquiry rows were read. | Engineer for a local fixture; enquiry owner for a real source | 05 |
| GW-007 | Missing verification | Fixed and verified | Local `clinic_genie_rehearsal` backup and restore into `clinic_genie_rehearsal_restore_test` passed. Counts matched, including `blog_activity` 1 linked to the fictional `recovery-check` article. Migrations matched, 35 files. Relationship checks were 0. Specialists saw 11 and 3 of 14 tasks. Sessions, verification tokens and development magic links were 0 on the destination and remained on the source. The isolated app on port 3402 showed Restore test Passed and Last restore test passed. The destination database was dropped after those checks. `clinic_genie` `backup_runs` stayed 0. | Engineer on the local database only | 03 |
| GW-008 | Product decision | Reproduced | Report states were not changed. | Product owner | 06 |
| GW-009 | Code defect | Reproduced | `ensurePreviewSnapshots` was not changed. Seed was not run. | Engineer | 07 |
| GW-010 | Documentation problem | Reproduced | Both `0034` migration names remain. They were not renumbered. | Engineer | 07 |
| GW-011 | Code defect against D14 | Reproduced | `canManageRegistry` was not changed. | Engineer after the scope is confirmed | 06 |
| GW-012 | Code defect | Reproduced | The 390px header was not remeasured. | Engineer | 07 |
| GW-013 | Environment / configuration gap | Fixed and verified | Magic links and automatic Google admin creation require a local database and stay off for production, Vercel preview, an empty URL, a remote host, database name `neondb`, and port 54329. An unknown Google user is denied on a shared database. An existing staff record is still allowed. `AUTH_SECRET` rejects an empty value and the build placeholders, and skips that check only while `NEXT_PHASE` is `phase-production-build`. Covered by `runtime-policy.test.ts`. The port 3400 server was not restarted and was not pointed at a shared database. | Engineer configuring the rehearsal; release owner for any hosted environment | 02 |
| GW-014 | Code defect | Reproduced | The home page still has the agency heading, and the shell can also render a heading. This batch did not change heading structure. | Engineer | 07 |
| GW-015 | Code defect | Partially fixed | Lint was reproduced at exit 1 with 6 errors and 11 warnings. After the fix, `npm run lint` exits 0 in the working tree and the clean checkout. The 6 errors are gone. The same 11 warnings remain and were not suppressed. | Engineer | 01 and 07 |
| GW-016 | Documentation problem | Reproduced | `docs/BUILD_STATUS.md` and `README.md` were not edited. | Engineer | 07 |
| GW-017 | Code defect | Fixed and verified | `npm run test:decisions` exit 0. 8 passed, 0 failed. The obsolete empty-repository checks now expect the specification pack under `docs/` and the platform tree. The CG-01 match, denied-access checks and rejection checks are unchanged. | Engineer | 01 |

## Commands this batch

| Command | Exit | Notes |
| --- | ---: | --- |
| `npm test -w @clinic-genie/db -- test/analytics-sync.test.ts test/agency-overview.test.ts test/fixture-targets.test.ts` | 0 | 3 files, 20 tests. Local `clinic_genie`. |
| `npm test -w @clinic-genie/platform -- src/lib/analytics-worker.test.ts src/lib/analytics-board.test.ts` | 0 | 2 files, 12 tests. |
| `npm test` | 0 | Local `clinic_genie`. Database package 17 files, 93 tests. Platform 9 files, 41 tests. |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | 0 errors, 11 warnings. The warnings are the ones retained from Batch 01. |
| Unauthenticated `GET` and `POST /api/internal/analytics/worker` | 401 | Local rehearsal app on port 3403. Body `{"error":"Unauthorized"}`. |
| Signed-in Settings and home | 200 | Fixture connection showed last success 15 Oct, 10:00, one failed job, and the rate-limit sentence. Home stayed “Not yet synchronised” with the illustrative trend. |

Not run: a live Google or Wix call, a deployed cron, and a restart of the server on port 3400. The remote application database was not queried or written. Earlier command results stay in the Batch 01, Batch 02 and Batch 03 handovers.
