# Environment configuration

Variable names and purposes only. Do not commit values. The example names live in `.env.example`. A build can use the fallback recorded in `vercel.json`. That fallback is not a runtime secret.

## Local

Used by the embedded database on this machine and by `npm run db:rehearse`.

| Name | Purpose |
| --- | --- |
| `DATABASE_ADMIN_URL` | Owner connection for migrations, seeds, backups and restore tests. Destructive commands refuse a remote host. |
| `DATABASE_URL` | Application connection. Row-level security applies. Development sign-in shortcuts require this host to be local. |
| `APP_DB_PASSWORD` | Password for the `cg_app` role when a local role is created. |
| `EMBEDDED_PG_PORT` | Port for the embedded development database. |
| `EMBEDDED_PG_DIR` | Data directory for that database. |
| `SEED_ALLOWED_DB_PATTERN` | Database-name marker required by seed, reset and restore tests. |
| `AUTH_SECRET` | Session secret. Required at runtime. The example placeholder and the build fallback are rejected. |
| `AUTH_URL` | Public origin used by sign-in callbacks. |
| `AUTH_DEV_MAGIC_LINKS` | Records a local sign-in link instead of sending mail. Ignored when the database is shared or the process is production or Vercel preview. |
| `AUTH_GOOGLE_ID` | Google OAuth client id. Empty leaves Google sign-in off. |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret. |
| `AUTH_GOOGLE_HD` | Workspace domain. On a local database, an unknown matching user can be created as admin. A shared database does not create that user. |
| `APP_ENVIRONMENT_LABEL` | Text shown in the header. It does not by itself enable sign-in shortcuts. |
| `UPLOADS_DIR` | Private local directory for evidence files. |
| `ENQUIRY_DATABASE_URL` | Read-only clinic-website enquiry source. Empty means the enquiry screens stay disconnected. The local fixture database is `clinic_genie_enquiry_test`. |
| `ANALYTICS_GOOGLE_CLIENT_ID` | Google OAuth client for analytics connections. |
| `ANALYTICS_GOOGLE_CLIENT_SECRET` | Matching client secret. |
| `ANALYTICS_WIX_APP_ID` | Wix app id. |
| `ANALYTICS_WIX_APP_SECRET` | Wix app secret. |
| `ANALYTICS_TOKEN_KEY` | Key used to encrypt stored provider tokens. |
| `ANALYTICS_WORKER_SECRET` | Bearer secret for the analytics worker. A manual call may use POST or GET. |
| `CRON_SECRET` | Bearer a Vercel Cron sends. The worker accepts this or `ANALYTICS_WORKER_SECRET`. |
| `ANALYTICS_LIVE_REPORTS` | Reads promoted provider data when on. |
| `ANALYTICS_FIXTURE_MODE` | When on, provider calls must stay on this machine. |
| `ANALYTICS_ALLOW_REMOTE_WORKER` | Allows the worker database host to be remote. Leave unset for local work. |
| `MIGRATE_ALLOW_REMOTE` | Allows `db:migrate` to use a remote non-production host. Leave unset for local work. Production still refuses. |
| `RECOVERY_ALLOWED_DB_PATTERN` | Name marker required by backup and restore-test. Unset means `rehearsal`. The shared application database, the enquiry database, a remote host and production stay refused. |
| `GENIE_WORKS_BASE_URL` | Optional local base URL for a consumer probe. |

## Staging

Same names as production, with staging values supplied by the hosting project. No staging project is named in this repository.

`VERCEL_ENV=preview` is treated as a hosted environment: magic links and automatic admin creation stay off. `DATABASE_URL` must be a staging database, not the local rehearsal database and not production.

`MIGRATE_ALLOW_REMOTE` may be set only for an approved non-production host. Seed, reset and restore tests stay local.

## Production

`NODE_ENV=production` and `VERCEL_ENV=production` refuse destructive local commands and disable development sign-in shortcuts.

| Name | Purpose |
| --- | --- |
| `DATABASE_ADMIN_URL` | Owner connection for a controlled migration. Not used by seed or reset. |
| `DATABASE_URL` | Application connection for the production database. |
| `AUTH_SECRET` | Runtime session secret. A missing value or the build fallback fails the request. |
| `AUTH_URL` | Production origin. |
| `AUTH_GOOGLE_ID` | Production OAuth client id. |
| `AUTH_GOOGLE_SECRET` | Production OAuth client secret. |
| `AUTH_GOOGLE_HD` | Workspace domain for existing staff. It does not create an admin. |
| `AUTH_DEV_MAGIC_LINKS` | Must stay off. The application ignores it in production. |
| `APP_ENVIRONMENT_LABEL` | Header label, normally `production`. |
| `ENQUIRY_DATABASE_URL` | Production enquiry source, only when that source is approved. |
| `ANALYTICS_*` | Production provider credentials and the worker secret. |
| `UPLOADS_DIR` | Replaced by the production file store when one is chosen. |

The build command may substitute `AUTH_SECRET` when the hosting project has not provided one. That substitute is only for the build. A running server must have a distinct runtime secret.
