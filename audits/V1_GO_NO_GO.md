# Genie Works V1 go / no-go

## Audit identity

| Item | Value |
| --- | --- |
| Audit date | 30 October 2026, Asia/Singapore |
| Repository | `clinic-genie-internal-platform` |
| Branch | `main` |
| Commit | `359502ce015d5b0555609a5311ff969b7c806a74` (`Merge preview/v1-platform into main`, 30 Oct 2026 14:21 +08) |
| Working tree | Dirty. The running app includes uncommitted and untracked files. `HEAD` still renders the previous dashboard (`LaunchDashboard`). This audit judged the working tree that `next dev` is serving. |
| App | Next.js 16.4.2, development server `http://127.0.0.1:3400`, label `development` |
| Runtime | Node v24.15.0, npm 12.2.1, darwin |
| App database | Managed Postgres in `ap-southeast-1` (`neondb`). Read-only aggregates only. No patient records were opened. |
| Test database | Local embedded Postgres `127.0.0.1:54339` / `clinic_genie`, used only for Vitest. Five pending migrations were applied there so the suite could run. The seed command then failed and was not retried. |
| Enquiry source | `ENQUIRY_DATABASE_URL` is empty |
| Analytics flag | `ANALYTICS_LIVE_REPORTS` is on. Fixture mode is off. |

Functional source of truth: the nine-module V1 register in `docs/audits/GENIE_WORKS_V1_REQUIREMENTS.csv`, as narrowed by decisions D11–D21 in `docs/DECISIONS.md`. D21 (30 Oct 2026) is the current home-page specification. Blog Performance (BL-15–BL-20) and report blog-performance (RP-05) stay deferred. D20 removes the form-builder screens. D11 keeps crawlers, bulk redirects, direct Google Business Profile API, `llms.txt` and NLWeb out of this release.

## 1. Overall score

**53 / 100. NO-GO.**

The score is already below the shipping band. Failed release gates would override a higher score.

## 2. Category scores

| Category | Points | Score |
| --- | ---: | ---: |
| Functional completeness | 20 | 13 |
| Security and permissions | 20 | 13 |
| Data integrity and analytics | 15 | 7 |
| Forms and enquiries | 10 | 5 |
| Integrations and publishing | 10 | 4 |
| UI, UX and accessibility | 7 | 4 |
| Performance and stability | 5 | 2 |
| Automated testing and code quality | 5 | 2 |
| Deployment and recovery | 5 | 1 |
| Documentation and handover | 3 | 2 |
| **Total** | **100** | **53** |

## 3. Module completion

Percentages are release readiness of the running working tree, not lines of code. Deferred rows are excluded. 100% would mean browser-verified happy and negative paths on an isolated fictional environment.

| Module | Readiness | Grade (0–5) | Notes |
| --- | ---: | ---: | --- |
| Agency Overview | 80% | 4 | D21 command centre loads. Counts and blanks match the database. |
| Client Management | 75% | 4 | Directory, services text, file links and registry rules are in code and tests. Browser create/edit was not performed. |
| Website Analytics | 40% | 2 | Screens load and refuse to invent session totals. Sync is not keeping up with the connections. |
| SEO | 60% | 3 | Soft-launch records and honest “not available” states. Live site consumption was not proven. |
| Blog | 75% | 4 | Native workflow is implemented and tested. The connected database has no live revision. |
| Leads and Forms | 45% | 2 | Enquiry architecture matches D18–D20. The running app is disconnected. |
| Reports | 55% | 3 | Builder rules are tested. Approved/Final states are absent. The connected library is empty. |
| Settings | 70% | 3 | Display name and connections exist. D14 correctly leaves password and alerts unset. |
| Admin | 60% | 3 | Users, audit and session revoke exist. Backup history on the connected database is empty. |

## 4. Pass / fail / unverified

Counted against the applicable V1 checks after D11–D21, not against the frozen 28 October audit.

| Result | Count | Meaning in this audit |
| --- | ---: | --- |
| Pass | 18 | Direct runtime or automated evidence on this date |
| Partial | 22 | Present, with an important gap |
| Fail | 8 | Required behaviour absent or contradicted |
| Unverified | 11 | Code or prior notes exist; this audit did not exercise the path |
| Out of scope | 16 | Explicitly deferred or superseded (BL-15–BL-20, RP-05, D20 form builder, D11 backlog, D14 inactive settings) |

Pass examples include the D21 home counts, unauthenticated redirects, worker 401, public API 404 without a token, and the Vitest permission, blog, report-measurement and enquiry-fixture suites.

## 5. Issue counts

| Severity | Count |
| --- | ---: |
| P0 | 0 |
| P1 | 7 |
| P2 | 6 |
| P3 | 4 |

No P0 was proven. P1 findings are enough to block both pilot and production. Detail is in `audits/V1_BUG_REGISTER.md`.

## 6. Mandatory release gates

| Gate | Status |
| --- | --- |
| No unresolved P0 or P1 | Fail |
| Releasable git revision matches what was tested | Fail. `HEAD` is not the running tree. |
| Production build | Fail. `npm run build` exits 1. |
| Typecheck and lint | Fail |
| Server-side authorisation and client isolation | Pass for the automated suite on the local database (116 tests). |
| Enquiry source connected, and a failed notification cannot delete the enquiry | Fail for the running app (source unset). Preservation is covered by the local fixture test, not by a live mailbox. |
| Analytics shown to staff are either live and fresh, or clearly not synchronised | Partial. The home page is honest. The worker is not draining the queue. |
| Backup and isolated restore evidence for the current schema | Fail. Connected database has no `backup_runs` rows. This audit did not run a restore. |
| Staging/production separation, scheduler, monitoring, rollback | Fail. `vercel.json` only. |
| No patient-record testing | Pass. Enquiry detail was not opened. |
| External provider calls proven | Unverified. Connections exist. This audit did not call Google or Wix. |
| Secrets left out of this report | Pass. `.env` is gitignored. Values were not copied here. |

## 7. Top 10 fixes

1. Remove the unused import so `npm run build` and `npm run typecheck` pass, then commit the audited tree as one revision.
2. Delete the localhost debug ingest calls in the layout, session, shell and database client.
3. Stop shipping real clinic directory values in migrations `0031_clinic_websites.sql` and `0034_client_public_profiles.sql`. Decide whether those rows belong only in the private database.
4. Run the analytics worker on a schedule and confirm queued jobs finish or record a safe error. Until then, keep live reports from looking more complete than they are.
5. Point Leads at an approved non-production enquiry database and retest status, retry and export. Leave production mail and patient rows untouched.
6. Record a backup and an isolated restore against the current schema, and show that run in Admin.
7. Align report states with D14 (Draft, In review, Approved, Final) or record a new decision that `draft` / `saved` is the V1 workflow.
8. Add a Vercel project, environment split, secret check, and a documented rollback before any shared deploy. Do not rely on the `preview-build-only` build fallback.
9. Repair the narrow-viewport header so Reports, the environment label and Add do not collide.
10. Refresh `docs/BUILD_STATUS.md`, `docs/HANDOVER.md` and the 28 October tracker so they describe this tree.

## 8. Internal pilot

**Not ready.**

The home page, navigation and permission tests are far enough along for a supervised demo of fictional data. They are not far enough for staff to rely on enquiry follow-up, website sessions, or a recoverable database. The running configuration already points at the shared client directory and has development magic links enabled.

## 9. Production release

**Not approved.**

There is no successful production build, no committed revision of the audited UI, no scheduler, no monitoring, no restore evidence, and no verified provider sync.

## 10. Recommendation

**NO-GO.**

Conditional go is not appropriate. A conditional internal pilot would still need the P1 gates above to pass first, on a fictional or otherwise approved dataset, with the enquiry source and analytics worker actually running.
