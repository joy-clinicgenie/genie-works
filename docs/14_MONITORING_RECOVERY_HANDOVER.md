# Monitoring, recovery and handover

## Monitor
Public uptime, backend errors, form health, notification failures, background dispatcher progress and backup success. Define thresholds, alert destination, owner and backup during discovery. Deduplicate repeated alerts. Do not assume Vercel deployment success establishes runtime health.

Synthetic form tests use labelled fixtures and controlled recipients. They must not contaminate live enquiry totals or create unnecessary patient information. Exercise the full storage/routing/outbox path in the designated test context.

## Recovery
Document database/media/code coverage, backup schedule, retention, recovery objectives and owner. Restore a recent backup into non-production and verify records, relationships and access policies. Coordinate application rollback with schema compatibility; use tested forward recovery if rollback is unsafe.

### Local logical recovery

This is the application export. It is not a managed physical backup. No backup schedule, retention period or named rollback owner is recorded. DEP-08 remains open. Do not invent those decisions here.

The export is a JSON file under `backups/`. That directory’s JSON files are gitignored. The file is written by the database owner connection and contains operational rows, so keep the directory private. The Admin backup page reads `backup_runs`. It does not read the file itself.

Included tables are the business tables, `blog_activity`, and the Auth.js `users` and `accounts` rows. `sessions`, `verification_token` and `dev_magic_links` are left empty on restore so an old session cookie, one-time token or development sign-in link cannot be reused. Staff sign in again. Evidence uploads in `UPLOADS_DIR` are not inside the database export.

The source must be a local database whose name contains `rehearsal` unless `RECOVERY_ALLOWED_DB_PATTERN` is set. The commands refuse production, a remote host, port 54329, the shared application database `clinic_genie`, an enquiry database, and a source whose name already ends in `_restore_test`. The destination is always `<source>_restore_test` on the same local server. It is dropped and recreated. It is never the source.

Use the fictional rehearsal database:

```bash
export DATABASE_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_rehearsal
export DATABASE_URL=postgresql://cg_app:cg_app_dev@127.0.0.1:54339/clinic_genie_rehearsal
export APP_DB_PASSWORD=cg_app_dev
npm run recovery-fixture -w @clinic-genie/db
npm run backup -w @clinic-genie/db -- ../../backups/rehearsal
npm run restore-test -w @clinic-genie/db -- ../../backups/rehearsal/<printed-backup-file> --keep
```

Run these from the repository root. The workspace script’s working directory is `packages/db`, so the backup path is relative to that directory.

Confirm the command prints `Restore test PASSED`, blog activity counts match, the three sign-in tables are 0, and migration names match. Then inspect `/admin/backups` on an application pointed at that same rehearsal database. Drop `clinic_genie_rehearsal_restore_test` after the inspection if `--keep` was used. Do not point these commands at the shared application database.

## Incident runbooks
- Form/storage failure: stop false success responses, expose clinic fallback, alert owner, preserve evidence and verify recovery.
- Email outage: retain leads, inspect pending/failed outbox, restore provider and reconcile retries.
- Booking outage: use approved fallback; never invent availability.
- Data exposure: contain access, revoke affected credentials, preserve evidence and follow approved response arrangements.

## Required handover
README and architecture; environment variable names without values; migrations and access policy; API contracts; deployment/rollback runbook; incident guide; tests/security/restore evidence; second-site onboarding checklist; vendor/cost register; named maintenance owner.

Planning infrastructure envelope from source: S$150-350/month, not a quote, excluding booking licences, labour, review, existing subscriptions and unusual traffic. Verify prices before purchase. Record billing owner, cancellation/export path and budget alerts.
