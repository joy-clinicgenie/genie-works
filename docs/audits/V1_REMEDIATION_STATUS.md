# V1 remediation status

Batch 01. 30 October 2026, Asia/Singapore.

Original audit files stay at `audits/V1_GO_NO_GO.md`, `V1_RELEASE_SCORECARD.md`, `V1_MODULE_PARITY.md`, `V1_BUG_REGISTER.md`, `V1_TEST_RESULTS.md` and `V1_REMEDIATION_PLAN.md`. They were not edited. Latest approved decision is D21. No D22 or later decision is in `docs/DECISIONS.md`.

Starting SHA `359502ce015d5b0555609a5311ff969b7c806a74`. Implementation candidate `2ff49401703730a43dd6c4127cee95c319575d1f` on `main`. That commit was checked out clean and verified. It is not pushed.

Statuses: Not checked, Reproduced, In progress, Fixed awaiting verification, Fixed and verified, Partially fixed, Blocked, or Not applicable.

| ID | Class | Status | Current evidence | Owner role | Batch |
| --- | --- | --- | --- | --- | --- |
| GW-001 | Code defect | Fixed and verified | Unused `Link` import removed from `BlogWorkflow.tsx`. `npm run typecheck` exit 0 and `npm run build` exit 0 on the candidate, repeated in the clean checkout. | Engineer | 01 |
| GW-002 | Missing verification | Fixed and verified | The candidate home page imports `AgencyOverview` and no longer has `LaunchDashboard`. Clean checkout on port 3401: unsigned `/` redirected to sign-in; a fictional local sign-in then received `/` with status 200, title `Dashboard \| Clinic Genie`, and the heading `Agency Overview`. | Engineer | 01 |
| GW-003 | Code defect | Fixed and verified | No `127.0.0.1:7835` ingest call remains in application source. The regression test covers the layout, session, shell, Back button and database client. The signed-in page had no resource entry for that host. | Engineer | 01 |
| GW-004 | Environment / configuration gap | Reproduced | `0031_clinic_websites.sql` and `0034_client_public_profiles.sql` still assign published directory fields by slug. History treatment is Blocked. This batch did not edit migrations. | Repository owner | 02 |
| GW-005 | Environment / configuration gap | Reproduced | Not rechecked. Batch 00 remains the evidence: live reports enabled, queued jobs, and no cron in `vercel.json`. | Engineer, then hosting owner for a real scheduler | 04 |
| GW-006 | Environment / configuration gap | Reproduced | The clean-checkout configuration left `ENQUIRY_DATABASE_URL` empty. No enquiry rows were read. | Engineer for a local fixture; enquiry owner for a real source | 05 |
| GW-007 | Missing verification | Reproduced | Backup and restore were not run. | Engineer on the local database only | 03 |
| GW-008 | Product decision | Reproduced | Report states were not changed. | Product owner | 06 |
| GW-009 | Code defect | Reproduced | `ensurePreviewSnapshots` was not changed. Seed was not run. | Engineer | 07 |
| GW-010 | Documentation problem | Reproduced | Both `0034` migration names remain. They were not renumbered. | Engineer | 07 |
| GW-011 | Code defect against D14 | Reproduced | `canManageRegistry` was not changed. | Engineer after the scope is confirmed | 06 |
| GW-012 | Code defect | Reproduced | The 390px header was not remeasured. | Engineer | 07 |
| GW-013 | Environment / configuration gap | Reproduced | The running app on port 3400 was not changed. The clean checkout enabled development magic links only against the local database. Shared-database sign-in was not reconfigured. | Engineer configuring the rehearsal; release owner for any hosted environment | 02 |
| GW-014 | Code defect | Reproduced | The home page still has the agency heading, and the shell can also render a heading. This batch did not change heading structure. | Engineer | 07 |
| GW-015 | Code defect | Partially fixed | Lint was reproduced at exit 1 with 6 errors and 11 warnings. After the fix, `npm run lint` exits 0 in the working tree and the clean checkout. The 6 errors are gone. The same 11 warnings remain and were not suppressed. | Engineer | 01 and 07 |
| GW-016 | Documentation problem | Reproduced | `docs/BUILD_STATUS.md` and `README.md` were not edited. | Engineer | 07 |
| GW-017 | Code defect | Fixed and verified | `npm run test:decisions` exit 0. 8 passed, 0 failed. The obsolete empty-repository checks now expect the specification pack under `docs/` and the platform tree. The CG-01 match, denied-access checks and rejection checks are unchanged. | Engineer | 01 |

## Commands this batch

| Command | Exit | Notes |
| --- | ---: | --- |
| `npm run lint` before the fix | 1 | 6 errors, 11 warnings. |
| `npm run typecheck` | 0 | After the fix. Repeated in the clean checkout. |
| `npm run lint` | 0 | 0 errors, 11 warnings. Repeated in the clean checkout. |
| `npm run test:decisions` | 0 | 8 passed, 0 failed. Repeated in the clean checkout. |
| `npm test` | 0 | Local database only. Database package 15 files, 81 tests. Platform 7 files, 36 tests. Repeated in the clean checkout. |
| `npm run build` | 0 | Repeated in the clean checkout. |
| Clean checkout signed-in `GET /` | 200 | Heading `Agency Overview`. No `LaunchDashboard`. No debug-ingest resource. |

Not run: Playwright, seed, backup, restore, provider calls, and a repeat of the 390px viewport. The remote application database was not queried or written.
