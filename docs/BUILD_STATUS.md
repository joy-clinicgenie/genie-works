# Build status

Updated: 12 November 2026, Asia/Singapore. Decisions run through D54.

Analytics Phase 1 (environment safety, D54) is implemented in the working tree and awaits review: see `docs/audits/ANALYTICS_PHASE_1_IMPLEMENTATION.md`. Nothing is committed or deployed. Synchronisation repairs (Phase 2 onward) have not started.

## Current stage

Genie Works V1 is a local nine-module staff application. The launch menu is Dashboard (Agency Overview), Clients, Website analytics, SEO performance, Blog, Leads and forms, Reports, Settings and Admin.

Migrations are the 43 files in `packages/db/migrations/`. Two applied files share 0034: `0034_client_public_profiles.sql` and `0034_leads_forms.sql`. Do not rename or rewrite them. The runner records the full filename and skips an unchanged file. The newest file is `0042_analytics_job_reliability.sql`. D41 splits analytics claims and result writes into short transactions, keeps provider I/O outside PostgreSQL, and adds bounded retries, recoverable leases and audited administrator retry. D40 removes demonstration clients, placeholder websites, synthetic preview figures and demonstration staff accounts. Clinic directory rows stay. D39 removes the fictional Meridian Skin client and its websites. D38 lists every public page on Site Health and reads a Google index verdict when Search Console is connected. The analytics worker drains a batch of due jobs, then stores index checks and mobile lab scores. A hosted run is still required before those production rows change. `0036_wix_enquiry_binding.sql` stores one Wix form's identifiers on a website. `0038_enquiry_source_binding.sql` assigns a missing enquiry key from the client slug and environment, and keeps a Wix identifier change to an administrator. Enquiry answers are not stored. D31 records one source per website. D36 records both connectors on the same Enquiries page, and assesses DEP-02 once per source connection. `0035_connection_secret_admin.sql` still limits connection-secret writes to an administrator. D44 connects the Clinic Genie website to `clinic_genie_enquiry_staging` as its live enquiry database. A Wix form remains a separate connection.

D23 is the report-state decision. Reports in the database are `draft` or `saved`. **Save draft** updates the working copy and writes no file. **Save for review** stores a version and one frozen JSON file under `docs/report`. A saved report is not Approved or Final. The four-state workflow in `docs/audits/batches/BATCH_06_HANDOVER.md` is a proposal, not the V1 workflow.

An isolated recovery copies those saved JSON files into a directory beside the restored database. It does not write over the source `docs/report` folder. Hosted disk or object-store durability is not verified. That remaining check is separate from the resolved report-state decision.

## Completed through Batch 07

- Decisions D1 to D21 in `docs/DECISIONS.md`.
- Fresh local setup removes imported directory clients. Existing databases are not stripped by a later migrate. The historical SQL remains in git (DEP-05, GW-004).
- Fictional backup and restore on an isolated local database (GW-007). `enquiry_follow_ups` is included. Saved report JSON is copied beside the restored database and is not written over `docs/report`. Hosted artifact durability is not verified.
- Analytics worker, fixture sync and a prepared cron entry. No live provider call (GW-005, DEP-01).
- Enquiry screens read a vibe-coded website from its enquiry database and a Wix website from the Wix Forms API. Both appear on one page, mapped to the client, website and form. Each website keeps its own sender. Genie Works does not send email (D36). A local fixture is not an approved source, and one connection does not cover every website (DEP-02). Labelled test DEP03-8E4DC5 was accepted by Resend and confirmed in the test inbox at 22:55 Asia/Singapore. The outbox row for DEP03-8E4DC5 stays `sent`. D35 records provider acceptance of DEP03D-A72CDF from `hello@clinic-genie.com` at 23:21:37. Inbox receipt of that message is not confirmed. The saved dispatcher from-address remains `onboarding@resend.dev` (GW-006).
- Administrator-only connection secrets (GW-011).
- Repeatable fictional seed against `report_snapshots_current_idx` (GW-009).
- Header controls that wrap below the desktop breakpoint, one home-page `h1`, and the link and image lint warnings from the earlier scan (GW-012, GW-014, GW-015).
- README, this file, `docs/HANDOVER.md` and `docs/GENIE_WORKS_V1_STAFF_SOP.md` describe the nine-module app (GW-016).
- Browser journeys for roles, clients, the in-app blog, the enquiry fixture, staff deactivation and keyboard focus (Batch 08). That browser pass is not a WCAG conformance claim.
- Local deployment inventory, environment classification, an administrator operations report, and rollback notes (Batch 09). No staging project was created or deployed.

## Still open

| Item | What is missing |
| --- | --- |
| DEP-01 | A named non-production analytics property and permission to read it |
| DEP-02 | Each source connection, assessed on its own. D44 is the Clinic Genie website database `clinic_genie_enquiry_staging`. That connection does not cover a Wix form or another website. The local fixture is not an approval |
| DEP-03 | Receipt of DEP03-8E4DC5 is confirmed. DEP03D-A72CDF was accepted from `hello@clinic-genie.com` and its inbox receipt is not confirmed. The saved dispatcher from-address is still `onboarding@resend.dev`. Production mail is still missing |
| DEP-04 | An authorised staging project |
| DEP-05 | A repository-owner decision on the historical migration text. No history rewrite was done |
| DEP-06 report states | Resolved by D23. The states are draft and saved. Approved and Final are not V1 states |
| DEP-06 artifact durability | A saved file is written under `docs/report`, and an isolated recovery can copy it beside the restored database. A hosted disk or object store has not been verified |
| DEP-07 | A staging website that will call the blog or SEO API |
| DEP-08 | A named rollback owner |
| Owners | Clinic owner, content approver, security reviewer and release approver are unnamed |

Do not describe live analytics, production mail, or website API consumption as verified. DEP03-8E4DC5 was confirmed in the test inbox. DEP03D-A72CDF was accepted from the verified domain, and its inbox receipt is not confirmed. That does not close the connected-pilot mail gate. Do not describe a saved report as approved.

## Legacy routes

Tasks, approvals, Google Ads, issues, HCSA and timeline still open. They are listed in `README.md`. They are not launch-menu modules and were not deleted.

## Exact next step

Analytics data fixes D51 to D53 are on branch `analytics-data-fixes`, not merged or deployed. See section 10 of `docs/audits/GENIE_WORKS_ANALYTICS_DATA_DIAGNOSTIC.md`. Before live figures can appear in production: (1) an administrator adds `ANALYTICS_TOKEN_KEY` and the Google and Wix analytics app credentials to the production environment; (2) the Vercel project Root Directory is changed from `apps/platform` to the repository root; (3) the branch is reviewed, merged and deployed, and the project's cron definitions list `/api/internal/analytics/worker`; (4) one scheduled run is recorded as LIVE_SYNC_VERIFICATION describes. The backup inventory does not yet list `seo_index_checks` and `seo_speed_checks` (`test/backup-coverage.test.ts` fails on unchanged code); that is the next ticket.


Batch 09 local preparation is recorded in `docs/audits/batches/BATCH_09_HANDOVER.md`. Hosted staging has not started. DEP-04 still has no authorised staging project. Batch 10 can re-audit the local evidence. It cannot close DEP-01 through DEP-08 from that local evidence alone.

On a resumed local session: `npm run db:start`, then `npm run dev`, and sign in as `admin@example.invalid` through `/dev/magic-links` only when the database is local. Do not touch the clinic website Postgres on port 54329. `npm run db:rehearse` replaces only `clinic_genie_rehearsal_isolated` and `clinic_genie_enquiry_test_isolated` after checking that those names are local and are not the shared databases. `npm test` uses its own disposable enquiry databases. Neither command resets `clinic_genie_enquiry_test`.
