# Genie Works V1 follow-up remediation

Recommendations only. This audit did not change application code.

The candidate is uncommitted. No batch below authorises a commit by itself. The repository owner decides whether to commit. None of the batches adds a Genie Works mail sender, an Approved or Final report state, or a rewrite of the SQL files kept by D22.

| Priority | Finding or gate | Concrete next action | Owner role | Prerequisite | Effort | Closure evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | GW-002 | Commit one intended tree, or discard the dirty product files and re-audit HEAD. | Repository owner | None | Under an hour once the tree is chosen | `git status` clean on that commit, and this pack repeated on a fresh checkout of that SHA |
| 2 | RA-001 | Put `enquiry_follow_ups` in `BACKUP_TABLES`. Name saved report files in the recovery steps and prove a file copy. | Engineering | A committed tree | Under half a day | `backup-coverage` passes. Restored follow-up count equals the source. The file bytes match after copy, delete and restore. |
| 3 | RA-002 | Set `enquiry_key` in `createWebsite`. Add an administrator form for one Wix instance, form, namespace and form key. Store no message. | Engineering | None for the local path | One to two days | Fresh seed has the key. `wix-enquiry-binding.test.ts` passes. |
| 4 | RA-003 | Keep the clients header and filters inside a 768px viewport. | Engineering | None | A few hours | `layout.spec.ts` passes at 390, 768 and 1440 |
| 5 | RA-004 | Open the enquiry journey on the fixture’s month, or move the fixture dates forward during isolated seed. | Engineering | None | Under two hours | The fixture reference is visible, follow-up saves, and the production refusal test still passes |
| 6 | RA-005 | Update `docs/BUILD_STATUS.md` and the dependency note so they follow D23 and D37. | Engineering | None | Under two hours | Those pages name draft/saved, both connectors, and the two remaining fictional clients |
| 7 | Shared fixture | Leave `clinic_genie_enquiry_test` in place. Run fixture tests against a database whose name contains `enquiry` and `test` and whose rows are all `TEST-`, as `clinic_genie_enquiry_test_b08` already is. | Engineering | None | Under half a day | `enquiry-fixture.test.ts` and the form-submissions fixture test pass without deleting the shared rows |
| 8 | Analytics crash | Give the internal client a website in the fixture test, or stop the test from reading a missing row. | Engineering | None | Under two hours | The isolation test reaches its session assertion |
| 9 | DEP-01 | Write one non-production GA4 property, one Search Console site, one Wix site and one date window. Compare one platform figure with the provider figure. | Marketing Clinic Genie | A committed build and read-only access | One session after the names exist | Both figures, the timezone and the window in the next audit |
| 10 | DEP-02 | Approve one database source and one Wix form as separate connections. | Enquiry-source owner | RA-002 for the Wix path | One decision each | A decision record per connection. The local fixture is not that record. |
| 11 | DEP-03 remainder | If the operator already has the receipt for DEP03D-A72CDF, record it. Confirm the saved from-address. Do not send a new message for this audit. | Clinic-website operator | The existing mailbox | Only if the receipt already exists | A new decision that cites the old reference. Absence stays open. |
| 12 | DEP-04 and hosted reports | Deploy the committed SHA to the authorised project and show one cron result. Put saved JSON on storage that survives the function. | Repository owner, with Joy for rollback | Items 1 and 2 | A deployment session | Deployment URL, SHA, one worker result, and a report file that is still there after a new instance |
| 13 | DEP-07 | After a token is separately authorised, render one article and one SEO setting on a non-production clinic website. | Website owner | D28 does not authorise the token yet | One website session | The rendered page and the platform revision id |
| 14 | DEP-08 | Write the rollback steps and accept them. | Joy | Item 12 | Under half a day | The acceptance names the committed SHA and the restore path |
| 15 | Remote directory rows | Decide, outside this audit, what happens to the 15 non-fictional clients still in `neondb`. Do not reset that database as a test step. | Account owner | D22 already covers the git text | A separate change | A decision, then a backup and a named restore. Not a fresh-seed side effect |

## Follow-up batches

### Batch R1 — make the candidate a commit

Start when the owner accepts the dirty tree or a smaller subset of it. Permitted mutation: git add and commit of the chosen product files. Do not commit `.env`, the backup JSON, or client-mark images until someone has looked at them. Stop when `git status` is clean and the new SHA is written down. Do not push unless the owner asks.

### Batch R2 — recovery and the Wix key

Start on a branch from that SHA. Permitted mutation: backup table list, website creation, an administrator binding action, and tests. Stop when the coverage test, the Wix follow-up test and an isolated restore all pass, and a draft report still writes no file. Do not call Wix.

### Batch R3 — the two red journeys

Start after R2 or beside it if the files do not overlap. Permitted mutation: clients layout and the enquiry journey’s date window. Stop when Playwright reports 16 passed on the isolated ports. Do not point the journey at port 3400 or at `neondb`.

### Batch R4 — status pages and the fixture database the suite uses

Start any time. Permitted mutation: `docs/BUILD_STATUS.md`, the dependency note, and the test setup that chooses an empty `enquiry_test` database. Stop when decision checks still pass and the shared `clinic_genie_enquiry_test` still has its 11 rows. Do not drop it.

### Batch R5 — owner evidence, after the code batches

Start only when R1 exists. Permitted mutation: a new decision file, a read-only provider check, and a deployment of that SHA. Stop when DEP-01 has both figures, DEP-02 has two connection records, and DEP-04 has one observed cron result. Do not pick a production property to fill a blank. Do not send mail. Do not drain the 69 queued jobs as part of the check.

## What each target still requires

### Supervised fictional local rehearsal

A committed SHA. RA-001 closed. RA-002 closed for a local binding, without a live Wix call. RA-003 and RA-004 closed. `npm test` green on a database that does not contain the shared non-`TEST-` rows. The demonstration uses Meridian, says the data is fictional, and does not claim a provider total.

The current tree can support a limited screen demonstration. That demonstration is not this rehearsal, because the tree is uncommitted and the backup and Wix gaps are open.

### Connected internal pilot

Everything in the rehearsal. One named non-production property, site and window, with both figures. One approved database source and one approved Wix form. A deployment of the same SHA. Saved report files that survive a new instance. Notification status read from the source, including an honest Unavailable where Wix does not expose it. The remote queue either explained or left untouched until a named window says a job may run.

Receipt of DEP03D-A72CDF stays a mail-status gap. It does not require a Genie Works sender. A pilot that does not exercise clinic-website mail can say that gap is outside its demonstration. It cannot call mail delivery verified.

### Production candidate

Everything in the pilot. A clinic website that has rendered one authorised article and one authorised SEO setting. Joy’s accepted rollback. A decision for the 15 non-fictional clients in the shared database. No production approval while P0 or P1 findings are open. This audit found no P0. RA-001 and RA-002 are open P1s.

## Owner inputs, without credentials

- Repository owner: which dirty files belong in the commit.
- Marketing Clinic Genie: the non-production property, site and dates. Not a secret.
- Enquiry-source owner: which database and which Wix form are approved. Not the app secret.
- Clinic-website operator: whether a receipt for DEP03D-A72CDF already exists.
- Website owner: which non-production site may later receive a token. D28 does not grant that token.
- Joy: acceptance of the rollback text after a deployment exists.

No date is promised. The code batches are hours to a few days of engineering. The owner batches cannot start until the names exist.
