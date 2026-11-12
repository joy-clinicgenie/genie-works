# Deployment inventory

31 October 2026, Asia/Singapore. This is a reading of the repository. It is not a deployment record. A file that is absent here does not prove that the same thing is absent in a hosting account, a DNS provider or a database host.

No staging project was created. DEP-04 stays open.

## Verified in this repository

| Item | What the file says |
| --- | --- |
| `vercel.json` (repository root) | The only Vercel configuration file. The Vercel project Root Directory must be the repository root (blank), or this file is ignored (D51). Next.js framework. `npm install`. The build runs `npm run build -w @clinic-genie/platform` and, when `AUTH_SECRET` is unset, substitutes `preview-build-only` for that build command only. If `.next` is missing at the repository root, the platform build output is copied there. |
| Schedule | In the repository-root `vercel.json` under `schedules` (D55; this replaced the `crons` entry of D51). One entry, `analytics-worker`: path `/api/internal/analytics/worker`, `requestMethod` `GET`, schedule `0 2 * * *` in UTC (10:00 Asia/Singapore). On the Hobby plan the jitter window is 15 minutes, so a run starts between 10:00 and 10:15 Asia/Singapore. Vercel sends `Authorization: Bearer $CRON_SECRET`. After a production deployment, the project's **Schedules** tab must list `analytics-worker`. |
| Worker route | `GET` and `POST` use the same handler. A missing or wrong bearer returns 401 before a job runs. The bearer is `ANALYTICS_WORKER_SECRET` or `CRON_SECRET`. An empty value never matches. |
| Retries | An expired lease with fewer than five attempts is queued again. At five attempts it is marked failed with the safe code `lease_expired`. That behaviour is in `packages/db/src/analytics/sync.ts`. It is not a hosted execution. |
| Placeholder secrets | `preview-build-only` and `replace-with-a-long-random-string` are rejected at runtime by `assertRuntimeAuthSecret`, except while `NEXT_PHASE` is `phase-production-build`. |
| Enquiry fixture | `NODE_ENV=production` or `VERCEL_ENV=production` refuses the fixture before a read or write. A local `next start` is production mode, so the fixture stays refused there. The guard was not relaxed. |
| Operations report | `GET /api/internal/operations/status` is administrator-only. The Admin page shows the same sentences. The body has no connection strings or secret values. |
| GitHub workflow | `.github/workflows/npm-publish-github-packages.yml` runs `npm ci` and `npm test` when a GitHub release is created, then `npm publish` to GitHub Packages. It does not deploy this application. |
| Recovery commands | `docs/14_MONITORING_RECOVERY_HANDOVER.md`. Backup and restore-test refuse production, a remote host, port 54329, `clinic_genie` and an enquiry database. |

There is no `Dockerfile`, no `vercel.ts`, and no `.vercel/` project link in this repository.

## Not visible from this repository

These may exist outside the repository. This pack did not inspect a hosting account, and it does not treat silence as proof of absence.

- A Vercel project, team, or connected Git repository.
- Hosting environment variables and their values.
- A hosted cron invocation.
- DNS, TLS certificates, or a public hostname.
- A hosted database, its backups, or its network rules.
- An external uptime check, error tracker, or alert destination.
- Branch protection or a deployment approval rule.

## Three targets

| Class | How the process is recognised | What it is not |
| --- | --- | --- |
| Local rehearsal | `VERCEL_ENV` is unset and `DATABASE_URL` is missing or on this machine. `next start` still counts, even though `NODE_ENV` is production. | Not a staging deployment. |
| Connected staging | `VERCEL_ENV=preview`. | Not authorised yet. DEP-04. A local database in that process is a blocker, not a staging database. |
| Production | `VERCEL_ENV=production`, or `NODE_ENV=production` with a database that is not on this machine. | Not approved by this pack. |
| Unassigned remote | The database is not on this machine, and neither preview nor production is selected. | Not connected staging. |

## Scheduler, stated separately

| Kind | State |
| --- | --- |
| Prepared configuration | The `vercel.json` schedule `analytics-worker` targets the worker route with GET, and that route accepts GET. |
| Manual execution | A person or a script can call GET or POST with a bearer. This batch did not make that call. Batch 04 recorded an unauthenticated 401 on a local rehearsal app. |
| Hosted scheduled execution | Not observed. DEP-01 and DEP-04 remain open. |

## Rollback

Application rollback and database restore are different actions. The steps, the roles, and the current limits are in `docs/14_MONITORING_RECOVERY_HANDOVER.md`. DEP-08 still has no named owner.

## Production migration procedure (D54)

Migrations are forward-only. Each file runs in its own transaction and is recorded with a checksum. A failed file rolls back and stops the run; earlier files in the same run stay applied. There are no down migrations.

Before:

1. Run `npm run db:migrate:status` with the production owner URL supplied for that command only. It is read-only. Confirm the target line says `production` and note the pending files.
2. Apply the same pending files to the preview database first, and run the application against it.
3. Take a restore point in the database provider's console: a branch or snapshot of production at the current time. Note its name. Confirm the provider's restore window covers the time you need.
4. Confirm the deployed code works with and without the pending tables, or schedule the deployment with the migration.

Run, from an operator shell, never from a deployment:

```
MIGRATE_PRODUCTION_CONFIRM=<YYYY-MM-DD today, Asia/Singapore>:<database name> \
MIGRATE_BACKUP_REFERENCE=<restore point name> \
DATABASE_ADMIN_URL=<production owner URL, not stored in a file> \
npm run db:migrate
```

The command prints the pending files and the restore point, then applies them. On production it does not touch the `cg_app` role or its password. Without both values, or with yesterday's date, it refuses before connecting. `MIGRATE_ALLOW_REMOTE` does not apply to production.

After: run `npm run db:migrate:status` again and expect `Pending: none`.

Rollback, in order of preference:

1. **Fix forward.** Add the next numbered migration that reverses the change. Never edit an applied file.
2. **Restore.** If data was damaged, restore production to the restore point from step 3 using the provider's restore. Everything written after that point is lost, so record the time window first. Provider documentation states that connection details do not change after an instant restore and that the pre-restore state is kept as a backup branch.
3. **Code.** Redeploy the previous production deployment in Vercel if the new code depends on the reversed schema.

`db:backup` and `db:restore-test` remain local rehearsal tools. They refuse a remote host and production, so they are not a production backup.
