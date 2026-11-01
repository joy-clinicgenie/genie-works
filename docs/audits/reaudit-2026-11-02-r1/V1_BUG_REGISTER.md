# Genie Works V1 re-audit findings

Original register: `audits/V1_BUG_REGISTER.md`, 30 October 2026, commit `359502ce015d5b0555609a5311ff969b7c806a74`. Those texts were not edited. Current judgement uses the uncommitted tree `db10022b0de6f78c1a747b59ef29535ce2a4d4ac` and decisions through D37.

GW-008 is judged against D23, not against the four states in D14. The historical directory files stay an accepted residual risk under D22. This audit did not rewrite history.

## Original issues

| ID | Original severity | Current status | Current evidence | Residual risk | Decision |
| --- | --- | --- | --- | --- | --- |
| GW-001 | P1 | Closed | `npm run typecheck` exited 0. The production build exited 0 after `npm ci`. `next start` became ready on port 3408. | None for the unused import. The tree is still uncommitted, which is GW-002. | None |
| GW-002 | P1 | Reopened | HEAD is `29bdb15`. The tested behaviour is dirty working-tree content, including migrations 0036 and 0037. | A release cannot name this tree. | Commit the intended tree, or audit a clean SHA instead. |
| GW-003 | P1 | Closed | `agency-overview.test.ts` passed and forbids `127.0.0.1:7835`. Lint exited 0. Server logs did not show that host. | None seen in this tree. | None |
| GW-004 | P1 | Partially fixed | A fresh migrate removed 14 imported directory clients and left `clinic-genie` and `meridian-skin`. Applied SQL files were not edited. The remote database still has 17 clients, of which 15 are outside the four known fictional slugs. | Accepted historical text in git, plus the still-present remote rows and untracked client-mark images. | D22. A history rewrite is not authorised. |
| GW-005 | P1 | Partially fixed | Queue, fixture sync and a cron file exist. Unsigned worker calls returned 401. The audit server had no connections. The remote database has 69 queued jobs and one success on 30 October 2026. | Live sync and a hosted schedule are open. | D25. DEP-01 and DEP-04. |
| GW-006 | P1 | Partially fixed | Native fixture reads work for October on the development server. Production mode refuses the fixture and export returns 503. Wix is described and not bound. | No approved source. The default month hides the current fixture. | D36. DEP-02. |
| GW-007 | P1 | Partially fixed | Covered tables restored, including `blog_activity` and a fictional article. Sign-in tables were empty. `enquiry_follow_ups` did not restore. Report files are outside the backup. | New follow-up rows and saved JSON can be lost. | Local restore is not DEP-08. See RA-001. |
| GW-008 | P2 | Closed for current scope | D23 replaces the four-state workflow. The browser saved draft, then saved, with no Approved or Final label. One version file was written. | Hosted durability and backup of the file are RA-001’s neighbour, not a missing approval state. | D23 |
| GW-009 | P2 | Closed | Two fresh seeds completed. The seed idempotence tests were not among the six failures. | Repeat-on-the-same-database was not given a separate manual run. | None |
| GW-010 | P2 | Closed | Fresh migrate applied both `0034_client_public_profiles.sql` and `0034_leads_forms.sql` once. Files were not renamed. | A tool that assumes unique numbers can still be confused. The runner records the full name. | Leave the applied names. |
| GW-011 | P2 | Closed | Secret-write tests passed. The browser denied manager, specialist and signed-out starts before a provider call. | None for the manager write. | D14 |
| GW-012 | P2 | Partially fixed | At 390 the official check found no page overflow and no overlapping header controls. At 1440 a follow-up measure found page overflow 0. At 768 page and header overflow were 289. | Tablet width still scrolls. | RA-003 |
| GW-013 | P2 | Closed on the audit server | Production mode returned 404 for `/dev/magic-links`. The development server on the local fictional database returned 200. | The workspace flag is still true. This run did not request the page on port 3400. | Keep the flag off for any shared database. |
| GW-014 | P3 | Closed | The keyboard journey required one `h1` on the checked pages and passed. | Not a full heading audit. | None |
| GW-015 | P3 | Closed | Lint exited 0. | None for those warnings. | None |
| GW-016 | P3 | Partially fixed | The nine modules and D23/D36 are visible in the product copy and in `docs/DECISIONS.md`. | `docs/BUILD_STATUS.md` still ends at D36 and still lists DEP-06 as open. | RA-005 |
| GW-017 | P3 | Closed | `npm run test:decisions` passed 8 and failed 0. | None for DAY-01. | None |

Closed: 10. Partial: 6. Reopened: 1.

## New defects

### RA-001 — Backup drops Wix follow-up rows

| Field | Detail |
| --- | --- |
| Module | Admin / recovery |
| Severity | P1 |
| Affected environment | Any restore of a database that uses migration 0036 |
| Type | Demonstrated defect |
| Expected | Every table created by a migration is either in the backup or in the explicit exclusion list. A follow-up row survives restore. |
| Observed | `enquiry_follow_ups` is in neither list. The coverage test failed. Source count 1, restored count 0. Saved report JSON is also outside the backup. |
| Reproduction | On the isolated rehearsal database, insert one fictional follow-up, run `db:backup`, then `restore-test`. Compare the table count. |
| Evidence | `packages/db/test/backup-coverage.test.ts` failure and the restore counts in `V1_TEST_RESULTS.md`. |
| Impact | A recovery that otherwise passes silently loses Wix follow-up status. |
| Proposed fix | Add the table to `BACKUP_TABLES` and cover saved report files in the recovery note or the archive. Do not weaken the coverage test. |
| Prerequisite | None |
| Effort | Under half a day |
| Retest | Coverage test passes. Restored follow-up count equals the source. The report file is named in the recovery steps and a copy restore is shown. |

### RA-002 — A fresh website cannot be bound to Wix

| Field | Detail |
| --- | --- |
| Module | Leads and forms |
| Severity | P1 for the current two-source scope |
| Affected environment | Fresh seed and any website created after migration 0034 |
| Type | Demonstrated gap |
| Expected | Staff can attach one Wix form to one website. The page can read that form. The message is not stored. |
| Observed | Migration 0034 sets `enquiry_key` only for websites that already exist. Seed creates Meridian afterwards, so the key is null. `createWebsite` does not set it. No action writes `enquiry_source` or the Wix ids. The Wix test looks up `meridian-skin-production` and receives no row. Instance environment variables are documented and are not read. |
| Reproduction | Migrate and seed an empty local database. Select `enquiry_key` for Meridian. Run `packages/db/test/wix-enquiry-binding.test.ts`. |
| Evidence | Fresh `clinic_genie_b08` website query and the test failure at `expect(site).toBeTruthy()`. |
| Impact | The Wix connector cannot be turned on through the product. A database constraint also rejects a Wix source until the key and the ids are all present. |
| Proposed fix | Set a stable `enquiry_key` when the website is created. Add an administrator form that stores the instance id, form id, namespace and form key. Keep answers at Wix. |
| Prerequisite | A live form still needs a separate DEP-02 approval. The local fix does not. |
| Effort | One to two days for the local path |
| Retest | Fresh seed has the key. The Wix follow-up test passes. The enquiries page still stores no message. |

### RA-003 — The clients page overflows at 768px

| Field | Detail |
| --- | --- |
| Module | UI |
| Severity | P2 |
| Affected environment | Browser at 768px width |
| Type | Demonstrated defect |
| Expected | The official layout check allows at most 1px of page or header overflow, and no overlapping controls. |
| Observed | 390: page overflow 0, overlaps 0. 1440 follow-up: page overflow 0. 768: page overflow 289 and header overflow 289. The journey stopped there. |
| Reproduction | Run `e2e-batch08/layout.spec.ts` against the production-mode server. |
| Evidence | Playwright log line `viewport 768: pageOverflow=289`. |
| Impact | Tablet width scrolls sideways on Clients. |
| Proposed fix | Let the header and filters wrap inside the viewport, as the 390 layout already does. |
| Prerequisite | None |
| Effort | A few hours |
| Retest | The same journey passes at 390, 768 and 1440. |

### RA-004 — The default enquiry month hides the fixture the browser journey opens

| Field | Detail |
| --- | --- |
| Module | Leads and forms / tests |
| Severity | P2 for the red journey. The product filter itself matched the clock. |
| Affected environment | Development server on 2 November 2026 |
| Type | Demonstrated test failure and a stale fixture window |
| Expected | The journey can see `TEST-MS-NEW-004` and can save follow-up. |
| Observed | `/enquiries?q=TEST-MS-NEW-004` showed 0 matching enquiries. The same reference with `from=2026-10-01&to=2026-10-31` showed 1 matching enquiry. Follow-up was not clicked. |
| Reproduction | Open the development enquiries page as Specialist A with and without the October parameters. |
| Evidence | Supplemental browser check in `V1_TEST_RESULTS.md`. |
| Impact | `npm` browser evidence for status, retry and export did not run. Staff who open “this month” in November will not see October fixture rows, which is the stated period rule. |
| Proposed fix | Point the journey at the fixture’s month, or refresh the fixture dates as part of seed. Do not remove the period filter. |
| Prerequisite | None |
| Effort | Under two hours |
| Retest | The enquiry journey passes without changing the production refusal test. |

### RA-005 — Build status still describes DEP-06 as open

| Field | Detail |
| --- | --- |
| Module | Documentation |
| Severity | P3 |
| Affected environment | Readers of `docs/BUILD_STATUS.md` |
| Type | Demonstrated contradiction |
| Expected | The status page matches D23 and D37. |
| Observed | It says decisions run through D36 and that the report-state choice is still missing. D23 and D37 are already in `docs/DECISIONS.md`. |
| Reproduction | Read both files. |
| Evidence | Those files in the candidate tree. |
| Impact | A handover can revive the four-state workflow or miss the removed fictional clinics. |
| Proposed fix | Update the status page, the dependency header and the staff SOP where they still say DEP-06 is undecided. |
| Prerequisite | None |
| Effort | Under two hours |
| Retest | A reader can name draft/saved, the two enquiry connectors, and the two remaining fictional clients from the status page. |

## Unresolved verification, not defects

These block a gate. They are not claims that the system was breached.

| Item | What is missing | What was not done |
| --- | --- | --- |
| DEP-01 | A named non-production property, site and date window, plus both figures | No provider call |
| DEP-02 | One approved database source and one approved Wix form | The local fixture was not treated as approval |
| DEP-03 | Receipt of DEP03D-A72CDF, and a saved from-address that matches the domain that was tested | No email sent |
| DEP-04 | A deployment of a committed SHA and one observed cron call | No deploy |
| DEP-07 | A clinic website that renders one article and one SEO setting | Token use is not authorised |
| DEP-08 | Joy’s acceptance of a written rollback path | The name alone does not close it |
| Hosted report storage | A durable store other than the local `docs/report` disk | Not tested |
| Shared fixture reset | The suite cannot reset `clinic_genie_enquiry_test` while five synthetic non-`TEST-` rows remain | The guard refused, and the rows were left in place |

## Accepted residual risk

D22. The repository owner kept `0009_client_master_list.sql`, `0031_clinic_websites.sql` and `0034_client_public_profiles.sql` in git. A fresh install removes the imported clients. The text is still in history. This audit did not rewrite history and does not describe the exposure as erased.

The remote application database still contains 15 clients outside the known fictional slugs. That is current data, not only history. Removing it is a separate operation and was not done here.

Twelve untracked images under `apps/platform/public/client-marks/` match the committed `ClientMark` map. They were not opened for this report. They are not fictional seed clients.

## Counts

Demonstrated new defects: RA-001, RA-002, RA-003, RA-004, RA-005. Two are P1, two are P2, one is P3.
Reopened original issue: GW-002. It is not also given an RA number.
Unresolved verification gates: DEP-01, DEP-02, DEP-03 remainder, DEP-04, DEP-07, DEP-08, hosted report storage.
Accepted risk: D22, still true.
