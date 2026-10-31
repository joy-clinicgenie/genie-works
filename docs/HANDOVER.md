# Handover

Updated 31 October 2026, Asia/Singapore. Read `docs/BUILD_STATUS.md` and `README.md` first. The day-to-day staff procedure is `docs/GENIE_WORKS_V1_STAFF_SOP.md`. Deployment inventory is `docs/DEPLOYMENT.md`. Staging activation is `docs/STAGING_ACTIVATION.md`. Recovery and rollback are `docs/14_MONITORING_RECOVERY_HANDOVER.md`.

## 1. What opens

Local app: `npm run db:start`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`, then `http://localhost:3400`. Sign in as `admin@example.invalid`. On a local database the link is listed at `/dev/magic-links` and is not emailed.

The launch menu has nine modules: Dashboard (Agency Overview), Clients, Website analytics, SEO performance, Blog, Leads and forms, Reports, Settings, and Admin for an administrator.

These older areas still open and were not deleted: `/my-tasks`, `/tasks/new`, `/approvals`, `/google-ads`, `/issues`, `/medical-review`, `/timeline`, and the matching client tabs. `/forms` opens the enquiry list. The full list is in `README.md`.

## 2. Environment

`README.md` lists every variable name and its purpose. Do not copy values into this file.

Use a local database on `127.0.0.1`. `DATABASE_ADMIN_URL` is the owner connection. `DATABASE_URL` is the `cg_app` connection with row-level security. Seeds and resets refuse a remote host, production, and port 54329. Leave `ENQUIRY_DATABASE_URL` empty unless you are deliberately using the local enquiry fixture. Leave the `ANALYTICS_*` secrets empty until an account owner grants a non-production property.

`APP_ENVIRONMENT_LABEL` is the header text that tells staff which environment they are in.

## 3. Limits that are still true

- Reports are **draft** or **saved**. **Save for review** keeps a version. It does not approve the report. The Draft → In review → Approved → Final workflow is proposed only, in `docs/audits/batches/BATCH_06_HANDOVER.md`, and DEP-06 blocks it. No stored PDF exists. Print uses the browser.
- Analytics figures on screen are stored seed or fixture rows until DEP-01 is closed. An empty chart is not a verified live zero.
- Enquiry email is not sent from this app. **Sent** is not proof of mailbox delivery (DEP-03). The shared enquiry source is not connected (DEP-02).
- No clinic website has been shown calling the blog or SEO settings API (DEP-07).
- Only an administrator can store an analytics connection or rotate a website token. A manager can still refresh and import a metric file, and can publish an SEO verification code.
- Clinic owner, content approver, security reviewer and release approver are unnamed. No D22 decision exists.
- Two migration files share the number 0034. Both are applied. Do not rename them.

## 4. Where the evidence is

Batch handovers are in `docs/audits/batches/`. The status ledger is `docs/audits/V1_REMEDIATION_STATUS.md`. Open dependencies are `docs/audits/V1_DEPENDENCIES.md`. Original audit reports under `audits/` were not rewritten.

## 5. Resume

```text
Read docs/BUILD_STATUS.md, README.md and docs/DECISIONS.md.
Stay on main unless the task says otherwise. Do not push.
Start the database with npm run db:start, then npm run dev.
Do not touch ~/vsc/clinic-demo-a or the Postgres on port 54329.
Do not seed or migrate a shared database for a local check.
Batch 09 local preparation is done. Hosted staging has not started (DEP-04). Report finalisation waits for DEP-06. A named rollback owner is still missing (DEP-08). Batch 10 can re-audit local evidence. It cannot treat hosted staging as done.
```
