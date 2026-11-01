# Genie Works V1 re-audit go/no-go

## Identity

Date/time/timezone: 2 November 2026, Asia/Singapore. Run `r1`.
Repository/branch: `clinic-genie-internal-platform` on `main`, 21 commits ahead of `origin/main`. The branch was not pushed.
HEAD: `29bdb1564bad4d5483ba5ae7aa76deb5a87404bd` (`Record the Batch 10 local re-audit.`). This commit is the Batch 10 evidence record. It is not the tree that was tested.
Tested candidate: uncommitted source tree `db10022b0de6f78c1a747b59ef29535ce2a4d4ac`. It is not a git commit and it is not on a branch. The worktree was a detached checkout of HEAD at `/Users/joystyle/vsc/clinic-genie-reaudit-20261102-r1` with the workspace changes copied in. `.env` was excluded from the tree hash.
Dirty/untracked changes: the workspace is dirty. About 52 tracked paths are modified and the untracked product files include migrations `0036_wix_enquiry_binding.sql` and `0037_remove_fictional_harbour_northgate.sql`, the Wix enquiry reader, the saved-report artifact writer, the D37 seed change, client-mark images, and this re-audit pack. Those changes are the candidate. They must not be described as HEAD.
Test environment/runtime: Node v24.15.0, npm 12.2.1, Next.js 16.4.2, Vitest 4.1.12, Playwright 1.64.1, darwin. Lockfile SHA-256 `14853308e5f98f6a02eedf1d16eaaecdcaac9d17bb4442e8761fd8597efbc2d9`, same as HEAD. `npm ci` in the worktree installed 428 packages.
Evidence output path: `docs/audits/reaudit-2026-11-02-r1/`.
Target deployment: none. No project was deployed, no hosted setting was changed, no email was sent, and no queue was drained. The existing `next dev` process on port 3400 was left running and was not used as evidence.

## Outcome

Score: **55.5 / 100**. Applicable weight: 100. Confidence: medium for the local uncommitted tree, low for any hosted or provider claim.
Local fictional rehearsal: **NO-GO** as a clean rehearsal. A supervised screen demonstration of the fictional client is possible only with the limits below.
Connected internal pilot: **NO-GO**.
Production candidate: **NO-GO**.

A committed candidate is required before any of those three can be approved. This run does not supply one.

## Mandatory gates

| Gate from 03 | Environment | Result | Direct evidence | Remaining action |
| --- | --- | --- | --- | --- |
| Reproducible build and relevant checks | Local | Fail | Typecheck, lint and the second production build passed. `npm test` exited 1. The candidate is not a commit. | Commit one tree, then re-run the suite on a clean checkout of that SHA. |
| Safe fictional data and role isolation | Local | Pass with limits | Fresh databases kept `clinic-genie` and `meridian-skin`. Specialist B and the read-only account had no Meridian membership. Browser role denials passed. The shared remote database still has 15 clients outside the four known fictional slugs. | Keep rehearsal on a local fictional database. Do not treat the remote `neondb` as the rehearsal. |
| No unresolved severe defect | Local | Fail | Backup omits `enquiry_follow_ups`. The Wix binding cannot be saved from a fresh seed. The suite and two browser journeys failed. | RA-001 and RA-002. |
| Wix and native workflows | Local | Fail | Native October rows are readable on the development server. The default November window hides them. Production mode refuses the fixture. No staff path writes a Wix binding. | RA-002 and RA-004. |
| Analytics, source enquiries and consumer site | Pilot / production | Blocked | No named non-production property. No approved source connection. No clinic website rendered an article or an SEO setting. | DEP-01, DEP-02, DEP-07. |
| Email | All | Partial historical only | D32 and D33 remain the acceptance and receipt of DEP03-8E4DC5. D35 acceptance of DEP03D-A72CDF has no receipt. This audit sent nothing. Genie Works has no sender. | Do not send another message to close this audit. Record receipt of DEP03D-A72CDF only if the operator already has it. |
| Saved reports | Local | Partial | Browser draft stayed `draft` and created no file. Save for review became `saved` and wrote one JSON file. A separate fictional file survived a copy, delete and restore. The database backup does not contain that file. | Prove hosted storage and include the file in recovery. |
| Backup and recovery | Local | Partial | Restore of the covered tables passed, including one fictional `recovery-check` article. Source had 1 follow-up row; the restored database had 0. | RA-001. |
| Scheduler, monitoring, rollback | Pilot / production | Blocked | `vercel.json` has a daily GET. No hosted invocation was observed. D29 names Joy and does not accept a procedure. | DEP-04 and DEP-08. |

## Summary

Category points from the unrounded formula: functional 12.4444444444, security 14.6666666667, data 6.60, enquiries 4.00, integrations 2.50, UI 4.20, performance 4.00, quality 3.00, operations 2.25, documentation 1.80. Sum 55.4611111111, half-up to one decimal **55.5**.

Module grades, as an evidence grade and not a percentage built: Agency Overview 3, Clients 4, Analytics 2, SEO 3, Blog 4, Leads and forms 2, Reports 3, Settings 4, Admin 3.

Check totals for 48 applicable rows: Pass 2, Partial 40, Fail 2, Blocked 4, Unverified 0, Out of scope 0. Verification coverage is 2/48. Pass is reserved for a check whose named behaviour was fully verified.

Original issues: 10 closed on current evidence (GW-001, GW-003, GW-008, GW-009, GW-010, GW-011, GW-013, GW-014, GW-015, GW-017). Six remain partial (GW-004, GW-005, GW-006, GW-007, GW-012, GW-016). GW-002 is reopened. New findings: RA-001 P1, RA-002 P1, RA-003 P2, RA-004 P2, RA-005 P3.

| DEP | Decision supplied | Access available to this audit | Verification |
| --- | --- | --- | --- |
| DEP-01 | D25 names the account owner, aliases and Singapore reporting. No property or date window. | Workspace environment has Google and Wix analytics values set. They were not used. The remote database has one succeeded sync at 2026-10-30 05:36 Asia/Singapore and 69 queued jobs. | Open. No figure was compared with a provider. |
| DEP-02 | D36 requires one approval per connection. None is approved. | Local fixture only. Production mode refused it. | Open for both connectors. |
| DEP-03 | D26, D30, D32, D33, D34, D35. | Historical. This audit did not send mail and did not read an inbox. | Receipt of DEP03-8E4DC5 remains D33. Receipt of DEP03D-A72CDF is open. The saved from-address was still `onboarding@resend.dev` in D35. Not a production mail proof. |
| DEP-04 | D27 authorises project `clinic-works`. | No deployment was inspected or created. | Open. |
| DEP-05 | D22 retains the historical SQL. | Fresh migrate removed 14 imported directory clients. The remote database still has 15 other clients. Applied files were not edited. | Choice recorded. Exposure remains. |
| DEP-06 | D23 accepts draft and saved, artifact under `docs/report`. | Local behaviour matches D23. | Local copy verified. Hosted durability is not verified. `docs/BUILD_STATUS.md` still describes this choice as open. |
| DEP-07 | D28 names a platform sign-in URL and does not authorise a token. | Public blog and SEO reads without a token returned 404. The in-app blog test read a published article with a test token. | Open. A sign-in URL is not a consuming clinic website. |
| DEP-08 | D29 names Joy and accepts no procedure. | Local restore ran. | Open. |

55.5 is not an improvement score against 53/100 or 62/100. Those numbers used an older rubric, fewer scope rows, and a different candidate (`359502ce` and `85b99c7`). This run uses the fixed formula in `docs/re-audit-pack/01_METRICS_AND_SCORING.md` and the current two-source, draft/saved scope. Blocked rows stayed in the denominator.

No deployment was performed.

## Limited local demonstration

A supervisor can show the fictional Meridian client on a local database: clients, blog review, report draft then saved, role denials, and the production-mode refusal of the enquiry fixture. The demonstration must say that the tree is uncommitted, the tablet clients page overflows, Wix forms are not bound, the enquiry fixture is October data, and nothing on screen is a live provider total.

## Top five next actions

1. Commit one candidate and re-audit that SHA. Owner role: repository owner. Prerequisite: none. Closure proof: `git status` clean, and this pack’s checks repeated on a fresh checkout of that commit.
2. Include `enquiry_follow_ups` in backup and prove the row survives an isolated restore. Owner role: engineering. Prerequisite: RA-001. Closure proof: `backup-coverage` passes and the restored follow-up count matches the source.
3. Set `enquiry_key` when a website is created and add an administrator path that stores one Wix form binding without storing the message. Owner role: engineering. Prerequisite: none for the local path. A live form still needs DEP-02. Closure proof: a fresh seed has the key, and `wix-enquiry-binding.test.ts` passes.
4. Remove the 768px page overflow and make the enquiry browser journey use a period that contains the fixture. Owner role: engineering. Closure proof: the layout journey passes at 390, 768 and 1440, and the fixture reference is visible in the period the test opens.
5. Name one non-production GA4 property, one Search Console site, one Wix site and the date window, and approve one database source and one Wix form as separate connections. Owner role: Marketing Clinic Genie for DEP-01, enquiry-source owner for DEP-02. Do not substitute a production property. Closure proof: one read-only window whose platform figure and provider figure are both recorded, and one approved connection per connector with no second copy of the message.
