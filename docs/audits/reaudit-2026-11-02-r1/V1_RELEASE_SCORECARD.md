# Genie Works V1 re-audit scorecard

Candidate tree `db10022b0de6f78c1a747b59ef29535ce2a4d4ac`, uncommitted, parent HEAD `29bdb1564bad4d5483ba5ae7aa76deb5a87404bd`. Local isolated databases on `127.0.0.1:54339`. No category was excluded. Applicable weight 100.

Pass means the named behaviour was fully verified. A grade of 4 is Partial: the main path and a negative case were seen, and one material gap remains. Blocked rows stay in the denominator. Grade 0 means no usable evidence for that row, not proof of a defect.

| Check ID | Status | Grade | Evidence | Limitation |
| --- | --- | --- | --- | --- |
| FN-01 | Partial | 3 | Admin home on the production-mode server returned Agency Overview. Role journeys opened the fictional client. Operations status reported no analytics connections. | Counts are seed and fixture data. No live source total was shown. |
| FN-02 | Partial | 4 | Browser: admin created, edited and archived a fictional client. Manager can open creation. Specialist cannot. Fresh seed membership matches D37. | `createWebsite` does not set `enquiry_key`. Fresh Meridian websites were `database` with a null key. |
| FN-03 | Partial | 2 | Analytics screens and fixture sync tests exist. 11 of 12 analytics-sync tests passed. The twelfth crashed because the internal client has no website. | No live GA4, Search Console or Wix window was reconciled. |
| FN-04 | Partial | 3 | SEO routes exist. Deferred items in D11 were not built and were not scored as missing. Admin `/seo` returned 200. | This run did not walk a redirect or checklist save in the browser. Live SEO publication is DEP-07. |
| FN-05 | Partial | 4 | Browser blog journey passed: in-app review, protected preview, and a token-gated published API read. Wix blog publishing stays deferred. | No external website rendered the article. |
| FN-06 | Partial | 2 | The enquiries page states both connectors and says Genie Works does not send mail. Native October rows were visible on the development server. Production mode showed the refusal and no fixture reference. | Wix rows were not read. The default November window showed 0 fixture rows. |
| FN-07 | Partial | 3 | Browser: draft stayed `draft` with no JSON file; Save for review became `saved` and wrote `docs/report/<id>-v1.json`. A separate fictional file kept its bytes after copy, delete and restore, and a second write left the first file unchanged. A draft write was rejected. | The page names the file path. There is no authorised download route. The database backup does not contain the file. Hosted disk was not tested. |
| FN-08 | Partial | 4 | Settings returned 200. The browser denied manager, specialist and signed-out Google starts before a provider call. Secret-write tests passed in the suite. | No connection was configured on the audit database, so the success path of a real binding was not shown. |
| FN-09 | Partial | 3 | Deactivation revoked a session. Unsigned operations status returned 401. Admin status returned 200 and classified the process as local rehearsal. | The admin screen on the journey database had no backup row. The successful backup was on the other audit database. |
| SC-01 | Partial | 4 | Unsigned `/` and `/enquiries` on port 3408 returned 307. `/dev/magic-links` returned 404 in production mode and 200 on the local development server. Worker GET and POST without a bearer returned 401. | The user’s existing server on port 3400 was not used. The workspace flag `AUTH_DEV_MAGIC_LINKS` is true; the shared-database predicate was covered by unit tests, not by a request to the remote database. |
| SC-02 | Partial | 4 | Browser: specialist sees assigned clients only; specialist B received 404 for Meridian’s fixture enquiry; reviewer cannot save follow-up; read-only export is denied; manager is denied admin and secret writes. Restore isolation: specialist A saw 4 tasks, specialist B saw 0, total 4. | One analytics isolation test did not reach its assertion. |
| SC-03 | Partial | 4 | Connection-secret tests passed and were not in the failure list. Operations JSON reported `authSecret: "set"` and did not contain a secret value. `.env` is gitignored and was excluded from the tree hash. | Token rotation against a provider was not exercised. |
| SC-04 | Partial | 3 | Production export returned 503 with “The enquiry database target was refused.” Read-only export denial passed in the browser. Artifact file names reject a non-UUID and a draft. | CSV formula safety was not re-tested with a downloaded file. Report JSON is not served through an authorised route. |
| SC-05 | Partial | 4 | Worker rejected a missing bearer. Blog and SEO API reads without a token returned 404. The blog journey read the API with a token created for that test. Webhooks stay off under D31. | No inbound Wix call was attempted. |
| SC-06 | Partial | 3 | The Wix follow-up test confirmed the new table has no name, email, phone or message column before it failed the website lookup. Fresh migrate removed 14 imported directory clients. D22 is recorded. | The remote database still has 15 other clients. Seed source still names three historical short codes. Twelve untracked client-mark images are in the dirty tree. |
| DA-01 | Partial | 3 | Report and enquiry code keep sessions, clicks, starts, submissions and bookings apart. D13 forbids adding Wix and GA4. The home page does not invent a live total when no connection exists. | No provider extract was compared with a screen total. |
| DA-02 | Blocked | 0 | D25 names no property and no date window. This audit did not call Google or Wix. | A succeeded sync row on the remote database is not a reconciliation. |
| DA-03 | Partial | 2 | The audit server reported `freshness: "no-connections"` and `lastSuccessAt: null`, which matched its empty connection table. | The remote database’s only succeeded run finished at 2026-10-30 05:36 Asia/Singapore and fetched 1 row. Sixty-nine jobs have been queued since 2026-10-30 01:48 Asia/Singapore. That queue was not labelled on a screen in this run. |
| DA-04 | Partial | 3 | Fixture worker tests largely passed. Unsigned worker calls returned 401. The remote queue was read and not drained: succeeded 1, cancelled 3, queued 69. | Idempotent retry of a live job was not run. |
| DA-05 | Partial | 3 | Enquiry comparison leaves demonstration rows out of the production total. A zero previous period is specified as a number without a percentage. The October screen said the comparison leaves demonstration submissions out. | No live range was checked. |
| EQ-01 | Partial | 1 | `wix-enquiries.ts` can query Wix Forms when a database binding and app credentials exist. Follow-up is stored by website and external id. | Fresh websites have a null `enquiry_key`, and no application code writes a binding. The env instance variables are not read. No live form was fetched. |
| EQ-02 | Partial | 3 | Development server, specialist, `from=2026-10-01&to=2026-10-31`: the fixture reference was visible and the summary said 1 matching enquiry. Production mode refused the same database before a read. | The default month, November 2026, showed 0. The shared `clinic_genie_enquiry_test` was not reset. |
| EQ-03 | Partial | 2 | Status values and the concurrency guard exist in code and in the fixture tests. Those tests did not run, because the shared fixture reset was refused. | This run did not save a follow-up. No Wix write-back is claimed. |
| EQ-04 | Partial | 2 | D36 says the same external id on two connectors is two enquiries. The Wix reader stops after 500 submissions and says so. | No paging reconciliation against a source count was done. |
| EQ-05 | Partial | 2 | The page says each website keeps its sender. `sent` remains provider acceptance under D19. Historical D32/D33 and D35 were not treated as a new receipt. | No notification row was opened in the browser. DEP03D-A72CDF still has no receipt record. |
| EQ-06 | Partial | 2 | Export denial and the production refusal passed. Wix retry is intentionally absent. | The fixture retry click did not run, because the November list did not show the row. |
| IN-01 | Blocked | 1 | Token-gated blog API read passed inside the app. Unsigned blog and SEO API calls returned 404. | D28’s URL is the platform sign-in page. No clinic website rendered an article or a saved SEO value. |
| IN-02 | Blocked | 1 | Forms credentials and analytics credentials are separate environment names. The audit processes left both empty. | Neither permission set was exercised against Wix. |
| IN-03 | Blocked | 1 | `vercel.json` schedules `GET /api/internal/analytics/worker` at 02:00 UTC. Local unsigned GET and POST returned 401. | No hosted invocation was observed. A manual call was not made. |
| IN-04 | Partial | 2 | D32 is provider acceptance of DEP03-8E4DC5. D33 is the user’s receipt confirmation for that one message. D35 is acceptance from `hello@clinic-genie.com` without a receipt. The sender is the clinic-website dispatcher, not Genie Works. | This audit did not re-read the provider or the mailbox. It is not production delivery proof. |
| UX-01 | Fail | 2 | Official journey: 390 page overflow 0, header overflow 0, overlaps 0. Follow-up: 1440 page overflow 0. At 768 the page and header overflow were 289. | The clients table box is wider than 390 but did not increase document scroll width. Inner clipping was not measured. |
| UX-02 | Partial | 4 | Keyboard journey passed: one tab stop had a 3px solid `rgb(19, 108, 114)` outline, the mobile menu moved to Dashboard then Clients, and the checked pages had one `h1` and labelled controls. | The sample is four routes plus sign-in. |
| UX-03 | Partial | 2 | The same journey is the manual focus and label evidence. | No axe run, no contrast measurement, no screen reader. This is not a conformance claim. |
| UX-04 | Partial | 4 | Disconnected analytics said no connections. Production enquiries said the database was refused and that a Wix form is a separate connection. Empty export was 503, not an empty success file. | Stale remote jobs were not shown on the audit server, because that server had no connections. |
| PS-01 | Pass | 5 | After `npm ci`, `npm run build` exited 0 and `next start` on `127.0.0.1:3408` reported Ready. The first build failed only because a symlink to `node_modules` sat outside Turbopack’s root. | The built tree is uncommitted. |
| PS-02 | Partial | 4 | The second browser run completed 16 launches. Server logs showed the expected administrator denial for operations status, not an uncaught page crash. The debug ingest host is rejected by `agency-overview.test.ts`, which passed. | Two journeys failed on assertions. Those failures are recorded under UX-01 and EQ-02. |
| PS-03 | Partial | 3 | Production-mode `fetch` on this machine, five samples, signed-in admin. Home 10.3–155.8 ms. Clients 8–20.1 ms. Enquiries 6.4–7.9 ms. Reports 6.3–8.2 ms. SEO 6.6–10.9 ms. Settings 9.2–23.8 ms. Admin 6.6–11.1 ms. | Local loopback, warm process, not a throttled device and not field Core Web Vitals. No Lighthouse figure was reused. |
| QA-01 | Pass | 5 | `npm run typecheck` exited 0. `npm run lint` exited 0 with no warnings printed. | Lint exists in `apps/platform` only. |
| QA-02 | Partial | 2 | Domain tests ran: 98 passed, 5 failed, 22 files. Platform tests ran: 56 passed, 1 failed, 12 files. Decision checks: 8 passed. Assertions were not edited. | The suite is red. Three failures are the fixture guard. Three are missing seed shape or the new table. |
| QA-03 | Partial | 3 | Chromium launched on the second run: 14 passed, 2 failed, 33.3 s. The first run failed all 16 because the browser executable was absent. That run is not a journey result. | Enquiry follow-up and the 768px layout failed. |
| QA-04 | Partial | 2 | `npm audit --omit=dev` reported 0 vulnerabilities. The full tree reported 16 moderate findings in development tooling. The only workflow is `Node.js Package`, on release, Node 20, `npm ci` and `npm test`. | There is no pull-request check for lint, typecheck or build. Dependency audit is not a secret scan. |
| OP-01 | Fail | 2 | HEAD, the dirty file list, the lockfile hash, the runtime and the source tree hash are recorded. The worktree was isolated. | The tested behaviour is not a commit. A release cannot point at this tree. |
| OP-02 | Partial | 2 | Audit processes used a local database whose name contains `reaudit_rehearsal` or `b08`. Provider secrets from the workspace were not copied into the audit environment. Production mode refused the fixture. | The workspace application URL is a remote `neondb`. `ANALYTICS_LIVE_REPORTS` is true and `ANALYTICS_ALLOW_REMOTE_WORKER` is 1 there. No hosted project was verified. |
| OP-03 | Partial | 3 | Logical backup of 64 tables restored with matching migration count 38, the fictional article, empty sign-in tables and RLS. A fictional follow-up row was 1 before restore and 0 after. A saved JSON file was recovered only by a separate file copy. | `enquiry_follow_ups` is not in `BACKUP_TABLES` or `BACKUP_EXCLUDED_TABLES`. The coverage test failed on that omission. |
| OP-04 | Partial | 2 | The admin operations report described local rehearsal, a missing worker bearer and no backup on the journey database. D29 names Joy. | No hosted monitor and no accepted rollback procedure. |
| DC-01 | Partial | 3 | D23 and D36 are in `docs/DECISIONS.md`. The enquiries page states the two-source rule. D37 matches a fresh seed. | `docs/BUILD_STATUS.md` still says decisions run through D36 and that DEP-06 is open. |
| DC-02 | Partial | 2 | Setup, fixture and local recovery commands exist. Several DEP owners are named. | Clinic owner, content approver and security reviewer are unnamed. The rollback path is not accepted. |
| DC-03 | Partial | 4 | This directory records the commands, exits and the tree that was tested. Blocked checks are marked blocked. | The evidence is for an uncommitted tree, so it cannot be replayed from HEAD alone. |

| Category | Weight | Applicable checks | Grade sum | Unrounded points | Display points |
| --- | ---: | ---: | ---: | ---: | ---: |
| Functional completeness | 20 | 9 | 28 | 12.4444444444 | 12.44 |
| Security and permissions | 20 | 6 | 22 | 14.6666666667 | 14.67 |
| Data integrity and analytics | 15 | 5 | 11 | 6.6000000000 | 6.60 |
| Forms and enquiries | 10 | 6 | 12 | 4.0000000000 | 4.00 |
| Integrations and publishing | 10 | 4 | 5 | 2.5000000000 | 2.50 |
| UI, UX and accessibility | 7 | 4 | 12 | 4.2000000000 | 4.20 |
| Performance and stability | 5 | 3 | 12 | 4.0000000000 | 4.00 |
| Automated testing and code quality | 5 | 4 | 12 | 3.0000000000 | 3.00 |
| Deployment and recovery | 5 | 4 | 9 | 2.2500000000 | 2.25 |
| Documentation and handover | 3 | 3 | 9 | 1.8000000000 | 1.80 |

Unrounded total: 55.4611111111. Final half-up one-decimal score: **55.5**.
Adding the two-decimal display column gives 55.46. That sum is not the score. The score uses the unrounded column.

Status reconciliation: Pass 2, Partial 40, Fail 2, Blocked 4, Unverified 0, Out of scope 0. Total 48.
Verification coverage: 2/48 passed checks.

The original 53 and the later 62 used other check lists and rounded category points. They are context. They are not the previous value of this formula, and this 55.5 is not a 2.5-point or a 6.5-point quality change.

Failed gates override the score. The uncommitted tree, the backup omission and the absent Wix binding block a local rehearsal sign-off. Missing provider, source, hosting and consumer evidence block pilot and production regardless of the 55.5.
