# Build status

Updated: 30 October 2026, Asia/Singapore, after Batch 07. Latest approved decision is D21. No D22 is recorded.

## Current stage

Genie Works V1 is a local nine-module staff application. The launch menu is Dashboard (Agency Overview), Clients, Website analytics, SEO performance, Blog, Leads and forms, Reports, Settings and Admin.

Migrations are the 36 files in `packages/db/migrations/`, numbered 0001 through 0035. Two applied files share 0034: `0034_client_public_profiles.sql` and `0034_leads_forms.sql`. Do not rename or rewrite them. The runner records the full filename and skips an unchanged file. The newest file is `0035_connection_secret_admin.sql`, which limits connection-secret writes to an administrator.

Reports in the database are `draft` or `saved`. **Save draft** updates the working copy. **Save for review** stores a version. A saved report is not Approved or Final. The four-state workflow is a proposal in `docs/audits/batches/BATCH_06_HANDOVER.md` and stays blocked on DEP-06.

## Completed through Batch 07

- Decisions D1 to D21 in `docs/DECISIONS.md`.
- Fresh local setup removes imported directory clients. Existing databases are not stripped by a later migrate. The historical SQL remains in git (DEP-05, GW-004).
- Fictional backup and restore on an isolated local database (GW-007).
- Analytics worker, fixture sync and a prepared cron entry. No live provider call (GW-005, DEP-01).
- Enquiry screens against a local fixture when `ENQUIRY_DATABASE_URL` points at that fixture. The shared setting is empty. No mail is sent (GW-006, DEP-02, DEP-03).
- Administrator-only connection secrets (GW-011).
- Repeatable fictional seed against `report_snapshots_current_idx` (GW-009).
- Header controls that wrap below the desktop breakpoint, one home-page `h1`, and the link and image lint warnings from the earlier scan (GW-012, GW-014, GW-015).
- README, this file, `docs/HANDOVER.md` and `docs/GENIE_WORKS_V1_STAFF_SOP.md` describe the nine-module app (GW-016).

## Still open

| Item | What is missing |
| --- | --- |
| DEP-01 | A named non-production analytics property and permission to read it |
| DEP-02 | An enquiry source the source owner approves. The local fixture is not that source |
| DEP-03 | A sender and an approved test recipient, or a decision that provider acceptance is enough |
| DEP-04 | An authorised staging project |
| DEP-05 | A repository-owner decision on the historical migration text. No history rewrite was done |
| DEP-06 | One product-owner choice for report states, and where the final artifact lives |
| DEP-07 | A staging website that will call the blog or SEO API |
| DEP-08 | A named rollback owner |
| Owners | Clinic owner, content approver, security reviewer and release approver are unnamed |

Do not describe live analytics, email delivery or website API consumption as verified. Do not describe a saved report as approved.

## Legacy routes

Tasks, approvals, Google Ads, issues, HCSA and timeline still open. They are listed in `README.md`. They are not launch-menu modules and were not deleted.

## Exact next step

Batch 08 can start the role, client, blog, fixture-enquiry and keyboard journeys that do not need a provider, a live enquiry source, a mail sender or a website consumer. Report finalisation stays blocked on DEP-06. Do not start Batch 08 until its prompt is given.

On a resumed local session: `npm run db:start`, then `npm run dev`, and sign in as `admin@example.invalid` through `/dev/magic-links` only when the database is local. Do not touch the clinic website Postgres on port 54329.
