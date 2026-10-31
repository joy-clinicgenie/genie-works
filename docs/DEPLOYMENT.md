# Deployment inventory

31 October 2026, Asia/Singapore. This is a reading of the repository. It is not a deployment record. A file that is absent here does not prove that the same thing is absent in a hosting account, a DNS provider or a database host.

No staging project was created. DEP-04 stays open.

## Verified in this repository

| Item | What the file says |
| --- | --- |
| `vercel.json` | Next.js framework. `npm install`. The build runs `npm run build -w @clinic-genie/platform` and, when `AUTH_SECRET` is unset, substitutes `preview-build-only` for that build command only. If `.next` is missing at the repository root, the platform build output is copied there. |
| Cron entry | One entry: path `/api/internal/analytics/worker`, schedule `0 2 * * *` (02:00 UTC, 10:00 Asia/Singapore). The file does not name a project, and it has not been deployed from this pack. |
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
| Prepared configuration | The `vercel.json` cron path matches the worker route, and that route accepts GET. |
| Manual execution | A person or a script can call GET or POST with a bearer. This batch did not make that call. Batch 04 recorded an unauthenticated 401 on a local rehearsal app. |
| Hosted scheduled execution | Not observed. DEP-01 and DEP-04 remain open. |

## Rollback

Application rollback and database restore are different actions. The steps, the roles, and the current limits are in `docs/14_MONITORING_RECOVERY_HANDOVER.md`. DEP-08 still has no named owner.
