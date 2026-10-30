# Clinic Genie platform

Genie Works is the internal operations platform for Clinic Genie staff. The signed-in menu has nine modules:

1. Dashboard (Agency Overview)
2. Clients
3. Website analytics
4. SEO performance
5. Blog
6. Leads and forms
7. Reports
8. Settings
9. Admin (administrators only)

Tasks, approvals, Google Ads, issues, HCSA medical review and the timeline still open at their existing addresses. They are outside that launch menu and were not removed. The staff procedure is `docs/GENIE_WORKS_V1_STAFF_SOP.md`.

This repository also holds the Phase 1 specification pack (`00_README.md` to `20_DELIVERY_TIMELINE.md`) and the decision records. The public clinic website and its lead intake stay in the sibling `clinic-demo-a` repository. Do not duplicate that backend here, and do not use its Postgres on port 54329 (`docs/DECISIONS.md` D1).

**Seed data is fictional.** Demonstration clinics and staff use `example.invalid` addresses. Do not add a real client name, account ID, contact or result.

## What is implemented, and what is not verified

Reports can be saved as **draft** or **saved**. **Save draft** updates the working copy. **Save for review** keeps an append-only version. Neither status is Approved or Final. A four-state workflow (Draft, In review, Approved, Final) is proposed in `docs/audits/batches/BATCH_06_HANDOVER.md` and is blocked until the product owner records one choice and says where the final artifact lives (DEP-06). There is no stored PDF. **Generate PDF** opens a browser print view.

These have not been verified in this workspace:

- A live GA4, Search Console or Wix sync (DEP-01). Analytics screens can show stored fixture or seed figures. An empty provider result is not a live zero.
- Delivery of enquiry email (DEP-03). This app does not send mail. **Sent** means a sender accepted the message, and no sender is connected.
- A clinic website calling the blog or SEO settings API (DEP-07).
- A named clinic owner, content approver, security reviewer or release approver. Those roles are still unnamed.

Connection secrets (analytics tokens and website API tokens) can be written only by an administrator. Refresh and CSV import stay available to an administrator or a manager.

## Run it locally

Requirements: Node 20.9 or later. No Docker install is needed. Development PostgreSQL runs from embedded binaries.

```bash
npm install
cp .env.example .env            # then set AUTH_SECRET to a long random string
npm run db:start                 # PostgreSQL on 127.0.0.1:54339 (keep this running)
npm run db:migrate               # applies packages/db/migrations in filename order
npm run db:seed                  # fictional clinics; a second run does not duplicate snapshot rows
npm run dev                      # http://localhost:3400
```

Sign in at `http://localhost:3400/sign-in` with a seeded address such as `admin@example.invalid`. On a local database the sign-in link is not emailed. It is listed at `http://localhost:3400/dev/magic-links`. That page is hidden when the database is not local, and in production or a Vercel preview. Google Workspace sign-in is available only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set.

| Seeded account | Role | Sees |
| --- | --- | --- |
| admin@example.invalid | admin | Every client, plus Admin |
| manager@example.invalid | manager | Every client. Cannot write connection secrets |
| specialist-a@example.invalid | specialist | Harbourview Dental, Meridian Skin |
| specialist-b@example.invalid | specialist | Northgate Physio |
| reviewer@example.invalid | reviewer | Harbourview Dental, Meridian Skin (review only) |
| readonly@example.invalid | read_only | Harbourview Dental (view only) |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Platform app in development on port 3400 |
| `npm run build` | Production build of every workspace |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint across workspaces |
| `npm test` | Vitest. Needs the local database running, migrated and seeded. Point `DATABASE_URL` and `DATABASE_ADMIN_URL` at `127.0.0.1` |
| `npm run db:backup` | Logical backup, recorded in `backup_runs` |
| `npm run db:restore-test` | Restores the latest backup into an isolated database whose name contains the recovery marker |
| `npm run db:reset` | Drops and recreates the schema. Local development only |
| `npm run db:seed-load` | Large synthetic load for a database whose name contains `perf` |
| `npm run test:decisions` | Decision-record checks over `decisions/` and `docs/` |

## Migrations

`npm run db:migrate` applies every `packages/db/migrations/*.sql` file once, in filename order, and records the full filename in `schema_migrations`. A file whose checksum changed after it was applied is refused. Add a new numbered file instead.

Two applied files share the number 0034:

- `0034_client_public_profiles.sql`
- `0034_leads_forms.sql`

Filename order applies the public-profile file first. Both names are applied exactly once. Do not rename or rewrite either file. The newest file is `0035_connection_secret_admin.sql`. There are 36 files.

A fresh database also removes imported directory clients during the run that applies `0001_foundation.sql`. A later migrate of an existing database does not delete those rows. The historical SQL is still in git (DEP-05).

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/platform` | Next.js 16 app |
| `packages/db` | PostgreSQL migrations, row-level security, domain services, seed, backup and restore |
| `packages/contracts` | Shared roles, statuses, metrics and event types |
| `docs/` | Decisions, build status, staff procedure, handover and audit evidence |
| `00_*.md` to `20_*.md`, `decisions/`, `tests/` | Phase 1 specification pack |

## Legacy routes that still open

These are not launch-menu modules. They were left in place.

| Area | Routes |
| --- | --- |
| Tasks | `/my-tasks`, `/tasks/new`, `/tasks/[id]`, `/clients/[id]/tasks` |
| Approvals | `/approvals`, `/approvals/new`, `/approvals/[id]`, `/clients/[id]/approvals` |
| Google Ads | `/google-ads`, `/google-ads/audits/new`, `/google-ads/changes/new`, `/clients/[id]/google-ads` |
| Issues | `/issues`, `/issues/new`, `/issues/[id]`, `/clients/[id]/issues` |
| HCSA | `/medical-review`, `/medical-review/new`, `/medical-review/[id]`, `/clients/[id]/medical-review` |
| Timeline | `/timeline`, `/clients/[id]/timeline` |
| Older aliases | `/forms` and `/forms/[id]` open enquiries. `/analytics/traffic`, `/analytics/behavior` and `/analytics/behaviour` open analytics views. `/seo/checklist` opens the SEO checklist |

`/dev/magic-links` is a local development page, not a staff module.

## Environment variables

Names and purposes only. Copy `.env.example` and fill values locally. Never commit `.env` or paste a secret into a document.

| Name | Purpose |
| --- | --- |
| `DATABASE_ADMIN_URL` | Owner connection for migrations, seeds, backups and restore tests. Bypasses row-level security |
| `DATABASE_URL` | Application connection. Role `cg_app` has row-level security |
| `APP_DB_PASSWORD` | Password set on `cg_app` when migrations run |
| `EMBEDDED_PG_PORT` | Port for `npm run db:start` |
| `EMBEDDED_PG_DIR` | Data directory for the embedded development database |
| `SEED_ALLOWED_DB_PATTERN` | Seeds, resets and restore tests refuse a database name that does not contain this text. They also refuse a remote host, production, and port 54329 |
| `RECOVERY_ALLOWED_DB_PATTERN` | Backup restore tests refuse a database name that does not contain this text |
| `AUTH_SECRET` | Session secret. A placeholder is rejected at runtime |
| `AUTH_URL` | Public origin of this app, used by Auth.js |
| `AUTH_DEV_MAGIC_LINKS` | Allows the local development sign-in list. Ignored for production, Vercel preview, and any database that is not on this machine |
| `AUTH_GOOGLE_ID` | Google Workspace OAuth client id. Leave empty until a client is approved |
| `AUTH_GOOGLE_SECRET` | Google Workspace OAuth client secret |
| `AUTH_GOOGLE_HD` | Workspace domain for the first local Google sign-in. A shared database never creates that administrator |
| `APP_ENVIRONMENT_LABEL` | Text shown in the header so staff can see which environment they are in |
| `UPLOADS_DIR` | Private evidence files. Served only after a permission check |
| `ENQUIRY_DATABASE_URL` | Read-only connection to a clinic website enquiry database. Leave empty to keep enquiry screens disconnected. Not a copy of the messages, and not verified against a live source |
| `ANALYTICS_GOOGLE_CLIENT_ID` | Google OAuth client for GA4 and Search Console. Leave empty until the account owner grants access |
| `ANALYTICS_GOOGLE_CLIENT_SECRET` | Secret for that Google client |
| `ANALYTICS_WIX_APP_ID` | Wix app id. Leave empty until access is granted |
| `ANALYTICS_WIX_APP_SECRET` | Wix app secret |
| `ANALYTICS_TOKEN_KEY` | Key used to encrypt provider tokens on the server. Tokens are not sent to the browser |
| `ANALYTICS_WORKER_SECRET` | Bearer for the analytics worker |
| `CRON_SECRET` | Bearer accepted from a hosted cron invocation. Leave empty locally |
| `ANALYTICS_LIVE_REPORTS` | Off keeps snapshot reports. On reads promoted provider partitions only |
| `ANALYTICS_FIXTURE_MODE` | Set only for fixture checks. The worker then refuses non-local provider hosts |
| `ANALYTICS_ALLOW_REMOTE_WORKER` | Leave unset. Set only when the worker database is an approved non-production host that is not this machine |
| `GENIE_WORKS_BASE_URL` | Optional base URL for a local consumer probe. Not a public deployment |
| `MIGRATE_ALLOW_REMOTE` | Leave unset. Set only to migrate an approved non-production host that is not this machine |

## Hosting note

A deployment keeps the database records. It does not prove live analytics, email delivery or a website reading this API. Backups are the `db:backup` exports plus whatever the database host keeps. Admin shows a backup or restore only after that run has been recorded. Staging and a named rollback owner are still open (DEP-04, DEP-08).
