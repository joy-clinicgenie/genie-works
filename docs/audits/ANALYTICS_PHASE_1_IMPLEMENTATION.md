# Analytics Phase 1: environment safety

Date: 12 November 2026, Asia/Singapore. Finalised 11:30.
Decision: D54 in `docs/DECISIONS.md`
Branch: `analytics-data-fixes`, working tree only. Nothing is committed, pushed or deployed.
Scope: environment safeguards only. No synchronisation repair was started.

**Phase 1 final status: CONDITIONAL PASS.** See F7 for the conditions.

This report has two parts. **Part F** is the finalisation and is current. **Part I** is the implementation record written earlier the same day; where the two differ, Part F is right.

# Part F: finalisation

## F0. Read this first: secrets were found in a tracked file

When finalisation started, the development `.env` was empty and the tracked `.env.example` held the real configuration.

| Time (12 Nov) | Observation |
| --- | --- |
| 11:01:00 to 11:01:19 | `vercel.json`, a worker test and three documents were edited: the cron moved from `apps/platform/vercel.json` to the repository-root file. Not done in this work. |
| 11:01:38 | `.env.example` became 4,955 bytes, the exact size `.env` had. It held 34 real values, including the production database URLs, the analytics token key and the provider secrets. |
| 11:01:44 | `.env` became 0 bytes. |

I did not make these changes and do not know what did. An editor "save all" with the two files swapped would produce this pattern.

What I did about it:

- Copied the real configuration to `~/.genie-works-secrets/genie-works-env-backup-2026-11-12.env` (directory mode 700, file mode 600, outside the repository). Checked it byte for byte, and checked all 43 values against the environment of the dev server that was still running.
- Restored `.env.example` from Git and re-added the Phase 1 variable names. A check found no real value left in it.
- Confirmed the file was never staged, committed or pushed: `HEAD` is unchanged at `4a8832e` and `origin/main` at `31551b5`.

The exposure was on this machine only, for a few minutes. Not checked: editor local history, cloud-synced folders and backup tools may hold a copy of that version of `.env.example`. The repository is public, so check `git diff -- .env.example` before any commit.

## F1. Completed configuration changes

Development `.env` (git-ignored, now mode 600), rebuilt from the backup with these changes only:

| Setting | Before | Now |
| --- | --- | --- |
| `DATABASE_URL` | Production, application role | Local, `127.0.0.1:54339`, `clinic_genie` |
| `DATABASE_ADMIN_URL` | Production, owner role | Local |
| `APP_DB_PASSWORD` | A 32-character value | `cg_app_dev`, the local role's password |
| `ANALYTICS_ALLOW_REMOTE_WORKER` | `1` | Removed |
| `DEV_PRODUCTION_DATABASE_ACCESS` | Absent | `refuse` |

The other 41 names keep their previous values.

Code and documents changed in finalisation:

| File | Change |
| --- | --- |
| `packages/db/src/backup.ts` | `seo_index_checks` and `seo_speed_checks` added to the backup inventory (F4) |
| `packages/db/scripts/migrate.ts` | On a hosted non-production database, refuses the public development password for the `cg_app` role and asks for a random value of at least 24 characters |
| `.env.example` | Restored. `DEV_PRODUCTION_DATABASE_ACCESS=refuse` is now the documented default. |

Development services: the old dev runner (started 09:59 with the production configuration in memory) was stopped and `npm run dev` was started again. It is running as a background task of this assistant session. If it stops when the session ends, run `npm run dev` in your own terminal.

## F2. Environment isolation verification

**Development: isolated.**

| Check | Result |
| --- | --- |
| Local PostgreSQL | 18.4, 14 MB, not in recovery, 0 invalid indexes |
| Migrations | 46 applied, through `0045`; `Pending: none` |
| `cg_app` role | Can log in, no row-level-security bypass, not a superuser |
| Row-level security | On for 75 of 75 tables |
| Data | 7 staff, all `@example.invalid`. 10 clients, 16 websites. 0 analytics connections, 0 stored tokens. |
| New app process | `DATABASE_URL` and `DATABASE_ADMIN_URL` are local; `DEV_PRODUCTION_DATABASE_ACCESS=refuse`; no remote-worker override |
| `/dev/magic-links` | 200. This page exists only when the database is local. |
| Sign-in | Signed in as `admin@example.invalid` through the development link ("Hey Demo Admin") |
| Pages loaded | Dashboard, Clients, Analytics, Settings, Enquiries: all 200 with local client names |
| Analytics page | "Traffic source is not connected", as expected with no local connection |

Two notes. The local client list includes eight records named "Inbox …" and "Isolation …". They are fixtures the test suites commit, not seed data; `npm run db:reset && npm run db:seed` removes them. And the Enquiries page still reads the hosted enquiry source, because `ENQUIRY_DATABASE_URL` was left as it was (F5, item 3).

**Preview: not isolated. No independent preview database exists.**

Read from Vercel, names and targets only:

- One database resource, `genie-works-database` (Neon, Free plan, Singapore), connected to the project for **both** Preview and Production.
- `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are single entries targeting Production and Preview together. So are the 16 other variables the Neon integration manages (`PG*`, `POSTGRES_*`, `NEON_*`) and `AUTH_SECRET`.
- The application reads only `DATABASE_URL`. `DATABASE_ADMIN_URL` is used by scripts.
- Preview has no `ANALYTICS_*` variables and no `CRON_SECRET`.

Every preview deployment therefore reads and writes the production database. The Phase 1 guard already refuses the analytics worker there. The Neon console was not inspected, because this session has no Neon access; an unused branch could exist there without appearing in Vercel.

Exact configuration for a separate preview database. Nothing below was executed. No production data, patient information or token is copied: the database starts empty.

1. **Create the database.** Vercel → Storage → Create Database → Neon → plan **Free** → region Singapore → name `genie-works-preview`. Vercel lists the Free plan at no cost with up to 100 projects, so this adds no charge. Do not create it as a branch of the existing database: Neon documents a branch as a copy-on-write copy of its parent, which would bring client records and encrypted tokens with it.
2. **Connect it to Preview only**, with the custom prefix `PREVIEW`, so its variables do not collide with the shared ones. Leave Production unticked.
3. **Migrate it** from an operator shell, with the new database's owner URL and host:

   ```
   DATABASE_ADMIN_URL='<preview owner URL, direct host>' \
   NONPRODUCTION_DATABASE_HOSTS='<preview direct host>' \
   MIGRATE_ALLOW_REMOTE=1 \
   APP_DB_PASSWORD='<new random value, 24+ characters>' \
   npm run db:migrate
   ```

   Then run `npm run db:migrate:status` with the same first two values. Expect `database target: approved non-production …` and `Pending: none`. If it prints `production`, stop: the new database shares the production endpoint.
4. **Create the first administrator**, with your own Workspace address, using the owner URL:

   ```sql
   insert into staff_users (email, display_name, platform_role) values ('<you@your-domain>', '<Your name>', 'admin');
   ```

5. **Set Preview-scoped variables.** `vercel env add <NAME> preview --sensitive` for each:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | `postgresql://cg_app:<APP_DB_PASSWORD from step 3>@<preview pooled host>/<database>?sslmode=require` |
   | `AUTH_SECRET` | A new random value, not production's |
   | `DEV_PRODUCTION_DATABASE_ACCESS` | `refuse` |
   | `APP_ENVIRONMENT_LABEL` | `preview` |

   `DATABASE_URL` and `AUTH_SECRET` already exist for Preview through the shared entries, so each shared entry must first be narrowed to Production. **This edits entries that also serve Production. The production value does not change, but it needs your approval and a moment when no deployment is running.** If Vercel will not let an integration-managed entry be narrowed, disconnect `genie-works-database` from Preview in the store's Projects tab instead.
6. **Do not add** `ANALYTICS_*`, `CRON_SECRET`, `ENQUIRY_DATABASE_URL` or `DATABASE_ADMIN_URL` to Preview.
7. **Verify.** Open a new preview deployment and sign in. Then confirm the production variable list is unchanged and production still loads.

Preview sign-in needs Google sign-in variables for Preview, or it will not be possible to sign in at all; today `AUTH_GOOGLE_*` exist for Production only.

## F3. Database safeguards

**Production classification, read-only.**

| Check | Result |
| --- | --- |
| Guard, given the backed-up production URLs | `production` for both the application and owner URL |
| `npm run db:migrate:status` on production (one read-only transaction) | `database target: production port default database neondb`, `Applied: 44`, `Pending (2): 0044_website_enquiry_forms.sql, 0045_wix_inbox_messages.sql`. The same state the diagnostic recorded. |
| Vercel integration metadata | One Neon resource in Singapore. Its database-name variable is 6 characters and its host variable 59 characters, the lengths of this database's name and pooled host. Consistent, not proof: Vercel does not return the values. |

**Production unchanged**, read-only query after all Phase 1 work:

| Item | Value |
| --- | --- |
| Analytics connections | 22: GA4 1, Search Console 10 connected and 1 disconnected, Wix 10. All have their stored secret. Last changed 1 November (UTC). |
| Stored secrets | 22 |
| Jobs, sync runs, reports, coverage days | 116, 22, 21, 62. Last job change and last run: 2 November. |
| Migrations | Last applied 3 November |
| Audit events since the diagnostic | 0 |

No key was rotated and no connection was touched.

**Local commands cannot reach production.** Two kinds of evidence:

Real commands, run end to end against made-up hosts that do not resolve, one marked as production and one unlisted:

| Command | Marked production | Unlisted remote |
| --- | --- | --- |
| `npm run analytics:work` with `ANALYTICS_ALLOW_REMOTE_WORKER=1` | Refused | Refused |
| A database test file (`packages/db`) | Refused, 0 tests ran | Refused, 0 tests ran |
| A database test file (`apps/platform`) | Refused | not run |
| `npm run db:migrate` with `MIGRATE_ALLOW_REMOTE=1`, host also listed as non-production | Refused | Refused |
| `npm run db:reset`, `npm run db:seed` | Refused | not run |

Guard functions, given the real production URLs (no connection is created):

| Path | Result |
| --- | --- |
| Development app pool, with the current `.env` | Refused |
| Worker command; worker route in development; worker route in a Vercel preview | Refused, refused, refused |
| Worker route in the Vercel production deployment | Allowed |
| Tests, application and owner URL | Refused, refused |
| `db:migrate`, with no confirmation and with the old opt-in | Refused, refused |
| `db:reset`, `db:seed` | Refused |

No destructive test was run against the hosted database. The only statements sent to it were read-only.

## F4. Test results

**`backup-coverage.test.ts`.** The test compares every table created by a migration with the backup inventory. Migration `0039` created `seo_index_checks` and `seo_speed_checks`, and neither was listed, so a backup silently left Site Health results out. Both are ordinary client-scoped tables with no secret, so they were added to `BACKUP_TABLES` after the other SEO tables. The test now passes.

Complete suite, against the local database, with the four hosted enquiry URLs blanked and `ANALYTICS_FIXTURE_MODE=1` for the run:

| Check | Result |
| --- | --- |
| `packages/db` | 37 files, 217 passed, 0 failed |
| `apps/platform` | 22 files, 131 passed, 0 failed |
| `npm run typecheck` | Exit 0, all workspaces |
| `npm run lint` | Exit 0 |
| `npm run test:decisions` | 8 passed, 0 failed |

Remaining failures: none.

Not run: the Playwright suites in `e2e/` and `e2e-batch08/`. They build and start their own servers and databases and are outside the unit and integration suite.

## F5. Outstanding manual actions

1. **Create the preview database** (F2, steps 1 to 7). Step 5 needs your approval because it edits entries shared with Production.
2. **Move the secrets backup into your password manager, then delete the file** `~/.genie-works-secrets/genie-works-env-backup-2026-11-12.env`. It holds the production owner URL and the live token key. It is the only copy I know of now that the old dev server has stopped.
3. **Decide which live credentials development should keep.** The development `.env` still holds: four hosted enquiry URLs including an owner URL, the live analytics token key and provider app secrets, the Wix forms secret, the mail key and the Google sign-in secret. None is needed to run against local seed data. I left them because you asked for the database settings only.
4. **Confirm the cron move.** The working tree now declares the cron in the root `vercel.json`, which takes effect when the Vercel Root Directory becomes the repository root and a deployment follows. Vercel still shows `apps/platform` and no cron. If that switch happens before the production credentials and the `not_configured` handling are live, the first cron run will mark the connections it reaches as needing reconnection (diagnostic 4.2).
5. **Confirm the production endpoint in the Vercel or Neon console** against the `production` result in F3.
6. **Check the Neon restore window** before the first production migration.
7. **Decide on migrations `0044` and `0045`**, pending on production while the deployed code includes them.
8. **Review and commit the working tree.** Check `git diff -- .env.example` first (F0).
9. **Replace the real Wix site instance id** in `apps/platform/src/lib/wix-form-map.test.ts` with a made-up one.
10. Optional: `npm run db:reset && npm run db:seed` to clear test fixtures from the local database.

## F6. Rollback procedures

Nothing in Phase 1 changed a schema, production data or a deployment.

| To undo | Step |
| --- | --- |
| The development `.env` change | `cp ~/.genie-works-secrets/genie-works-env-backup-2026-11-12.env .env`. This points development at production again and brings back the remote-worker override. The Phase 1 guards still refuse tests, the worker and migrations there. |
| The refusal for the development app only | Remove `DEV_PRODUCTION_DATABASE_ACCESS=refuse` from `.env`. The app then warns instead. |
| The backup inventory change | Remove the two table names from `BACKUP_TABLES` in `packages/db/src/backup.ts`. The coverage test fails again. |
| The migrate password check | Remove the `non_production` block in `packages/db/scripts/migrate.ts` |
| All Phase 1 code, keeping D51 to D53 | Part I, section 9 |
| The preview database, once created | Narrow nothing back: re-add Preview to the shared entries, remove the Preview-scoped variables, delete the `genie-works-preview` resource |
| A production migration | `docs/DEPLOYMENT.md`, "Production migration procedure" |

The snapshot ref `refs/backups/analytics-d51-d53-pre-phase1` predates the 11:01 cron move. Restoring files from it would bring back `apps/platform/vercel.json` and the older root `vercel.json`.

## F7. Phase 1 final status: CONDITIONAL PASS

| Area | Status |
| --- | --- |
| Local database isolation | Pass |
| Tests, worker and migrations cannot write to production from development | Pass |
| Production connections and data preserved | Pass |
| Test suite, typecheck, lint | Pass, no failures |
| Credential exposure | Pass, with the F0 incident contained on this machine |
| Preview isolation | **Not met.** Preview deployments still use the production database. |

Conditions to reach PASS:

1. The preview database exists and Preview no longer shares `DATABASE_URL` with Production (F5, item 1).
2. The secrets backup is in the password manager and the file is deleted (F5, item 2).
3. The working tree is reviewed and committed without real values in `.env.example` (F5, item 8).

Phase 2 was not started. Until condition 1 is met, do not run or test synchronisation work in a preview deployment.

# Part I: implementation record (earlier on 12 November)

Sections 6 and 8 below are superseded by Part F. They are kept as the record of what was true before finalisation.

## 1. Outcome at implementation

- The uncommitted D51 to D53 work is preserved and was not overwritten.
- Tests, the analytics worker and `db:migrate` refuse the production database from a developer machine.
- A production migration has a defined procedure with a restore point and a rollback path.
- No analytics token or credential was found in Git, Git history, logs, build output or client code.

Not done, by instruction: no encryption key was rotated, no connection was invalidated, no production row was changed, nothing was deployed.

## 2. D51 to D53 work: preserved

The 38 changed files were saved as a commit object under a backup ref. The working tree, the index and every branch were left as they were.

| Item | Value |
| --- | --- |
| Ref | `refs/backups/analytics-d51-d53-pre-phase1` |
| Commit | `53b4c8f5080ea3c9bdcfcdabaca5cb25cf753afe`, parent `4a8832e` |
| Contents | 33 modified tracked files and 5 new files. `.env` and `claude/` are not in it. |
| Check | Every file in the snapshot matches the working-tree file byte for byte (0 mismatches). |
| Location | This machine's `.git` only. It is not pushed. |

To inspect or recover:

```
git diff HEAD refs/backups/analytics-d51-d53-pre-phase1 --stat
git checkout refs/backups/analytics-d51-d53-pre-phase1 -- <path>     # restore one file
```

Phase 1 touched three files from that set, each with additions only: the worker route, its test, and `docs/DECISIONS.md`. `docs/BUILD_STATUS.md` and `docs/DEPLOYMENT.md` also gained text.

## 3. D51 to D53 work: what to keep and what to rework

Reviewed against the diagnostic. "Keep" means the change is sound as written. "Rework" means it carries a defect from section 6 of the diagnostic and should not ship unchanged.

| File | Change | Verdict |
| --- | --- | --- |
| `vercel.json` (repository root) | Cron declared in the one Vercel file; `apps/platform/vercel.json` removed on 12 Nov. Read only once the Vercel Root Directory is the repository root | Keep. Must not go live before the credentials and the capacity fix. |
| `packages/db/src/analytics/crypto.ts` | `tokenKeyConfigured` | Keep |
| `packages/db/src/analytics/sync.ts` | `ConfigurationError`, `not_configured`, connection keeps its status | Keep |
| `packages/db/src/analytics/sync.ts` | `dueJobs`, `PRESET_LENGTHS`, `GA4_DAILY_DAYS`, newest-first lease order | **Rework.** About 221 jobs per run against a limit of 40; superseded jobs never retire. |
| `packages/db/src/analytics/sync.ts` | `rangeJobStatus`, `enqueueRangeJobs` | Keep the mechanism. Revisit with the capacity fix. |
| `packages/db/src/analytics/maintenance.ts`, worker `route.ts` | `notConfigured` count | Keep |
| `packages/db/src/analytics/providers/ga4.ts` | `keepEmptyRows` for date reports | Keep |
| `packages/db/src/analytics/providers/ga4.ts` | Three Behaviour templates | Keep. They add to the job volume above. |
| `packages/db/src/analytics/read.ts` | Period total uses the same days as the chart | Keep |
| `packages/db/src/env.ts` | `envFlag` trims | Keep |
| `apps/platform/src/lib/period-range.ts` | `analyticsPeriod`: exact window in live mode | Keep |
| `apps/platform/src/lib/period-range.ts` | Rolling presets end yesterday | **Rework.** No fallback, so pages are empty each morning until the cron has run. |
| `apps/platform/src/lib/load-analytics-board.ts`, `AnalyticsRangeNotice.tsx`, `actions/analytics.ts` | Prepare a custom range | **Rework.** The notice covers custom ranges only; Today, Yesterday, Last 14, Last 365 and This month are never prepared and say nothing. |
| `apps/platform/src/lib/analytics-board.ts`, `live-analytics.ts`, `AnalyticsPanels.tsx` | GA4 Behaviour figures and labels | Keep. Wix websites still show sessions only. |
| `AnalyticsShell.tsx`, the three analytics pages, `AnalyticsConnections.tsx` | Wiring and the `not_configured` message | Keep |
| `.gitignore` | Ignores `.cursor/debug-*.log` | Keep, but the three log files are still tracked. |
| 9 test files | Cover the above | Keep. Update with the reworked parts. |
| `docs/*` | D51 to D53 records | Keep. `BUILD_STATUS.md` now also points to this report. |

None of these files was reverted or rewritten in Phase 1.

## 4. Environment design

| | Development | Preview | Production |
| --- | --- | --- | --- |
| Database | Embedded local PostgreSQL, `127.0.0.1:54339`, `clinic_genie` | A separate hosted database on its own endpoint | The current hosted database, unchanged |
| State today | Running, 46 migrations applied, fictional seed loaded. **Not used**: the local `.env` points at production. | **Does not exist.** Preview deployments share production's `DATABASE_URL`. | 44 migrations applied (through `0043`); `0044` and `0045` pending |
| Data | Fictional seed | Migrated schema, no client data | Live |
| Provider credentials | Optional, for sandbox work | None until a non-production property is approved | The existing key and app credentials |
| Analytics worker | Allowed on local | Allowed on its own database | Allowed |
| Tests | Allowed | Only with the host listed | Refused |
| `db:migrate` | Allowed | Opt-in plus listed host | Dated confirmation plus restore point |
| Seed, reset, backup, restore test | Allowed | Refused | Refused |

How production is recognised: `packages/db/src/database-environment.ts` holds a SHA-256 fingerprint of the production endpoint label. The pooled and direct host names share it. The host name is not written in the code. `PRODUCTION_DATABASE_HOSTS` can add hosts. A remote host that is not production is still refused unless its exact host name is in `NONPRODUCTION_DATABASE_HOSTS`, and listing the production host there has no effect.

Preview database: two ways to create it.

- **Recommended: a dedicated database with its own credentials**, migrated from empty, with Preview-scoped `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel. This matches the security foundation's "separate credentials and databases".
- **Alternative: the Neon integration's "Create database branch for deployment" for Preview.** Neon's documentation describes each preview branch as a copy-on-write branch of the default branch. Writes are isolated, but every preview starts as a copy of production data, including client records and the encrypted token rows. Use it only if that is acceptable.

Either way the preview host must differ from the production host, or the guards will treat it as production. `npm run db:migrate:status` prints which class a target falls in.

## 5. Changes made

New files:

| File | Purpose |
| --- | --- |
| `packages/db/src/database-environment.ts` | The rules: runtime class, production fingerprint, and guards for tests, the worker, migrations and connection pools |
| `packages/db/test/database-environment.test.ts` | 14 tests, no database needed |
| `packages/db/scripts/migrate-status.ts` | `npm run db:migrate:status`: applied, pending, modified and unknown migrations, in one read-only transaction |

Edited files:

| File | Change |
| --- | --- |
| `packages/db/src/client.ts` | `getPool` and `getAdminPool` check the target before creating a pool |
| `packages/db/test/helpers.ts` | Both URLs are checked before the test pools are created. This file had no host check. |
| `packages/db/src/testing/targets.ts` | `assertLocalWorkerDatabase` uses the new worker rule |
| `packages/db/src/migrate.ts` | `assertMigrationTarget` uses the new migration rule; `migrationStatus` added; the target line says `production` when it is |
| `packages/db/scripts/migrate.ts` | Prints pending files first, refuses modified files, prints the restore point on production, and leaves the `cg_app` role alone on production |
| `apps/platform/src/app/api/internal/analytics/worker/route.ts` | An authorised call is answered 409 when the database is not allowed from this environment |
| `packages/db/src/index.ts`, `package.json`, `packages/db/package.json` | Export and two script entries |
| `packages/db/test/fixture-targets.test.ts`, worker `route.test.ts` | Updated for the stricter rule; one new route test |
| `.env.example`, `docs/ENVIRONMENT.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `docs/BUILD_STATUS.md` | Variable names, the three environments, the production migration procedure, D54 |

Behaviour by entry point:

| Entry point | Before | Now |
| --- | --- | --- |
| `npm test` with `.env` on production | Would run against production, including as the owner role | Refused before a pool is created. Tests that need no database still run. |
| `npm run analytics:work`, `.env` has `ANALYTICS_ALLOW_REMOTE_WORKER=1` | Would run against production with real credentials | Refused |
| Worker route on a local server or a preview deployment | Ran | 409, no job claimed |
| Worker route in the production deployment | Ran | Unchanged |
| `MIGRATE_ALLOW_REMOTE=1 npm run db:migrate` on production | Would apply migrations and reset the `cg_app` password to the local value | Refused |
| Local app on production | Silent | One warning in the server log; `DEV_PRODUCTION_DATABASE_ACCESS=refuse` blocks it |
| `db:seed`, `db:reset` | Refused a remote host | Unchanged |

**A hazard found while reading `scripts/migrate.ts`.** The script called `ensureAppRole` on every run, which executes `alter role cg_app … password` with the local `APP_DB_PASSWORD`, or `cg_app_dev` if that is unset. Run against production, it would have replaced the production application password and cut off the deployed application. The production path no longer calls it.

No error message, warning or log line added in Phase 1 contains a host name, password or connection string. A test asserts this.

## 6. Test results

All database-backed tests ran against the local embedded database only. The command set `DATABASE_URL` and `DATABASE_ADMIN_URL` to `127.0.0.1:54339`, blanked the enquiry URLs and every provider secret, and set `ANALYTICS_FIXTURE_MODE=1`.

| Check | Result |
| --- | --- |
| `packages/db` suite | 37 files. 216 passed, 1 failed. |
| The one failure | `test/backup-coverage.test.ts`. Already recorded in `docs/BUILD_STATUS.md` as failing on unchanged code: two Site Health tables are missing from the backup inventory. Not caused by Phase 1 and not fixed here. |
| `apps/platform` suite | 22 files. 131 passed, 0 failed. |
| New guard tests | 14 passed, plus 1 new worker-route test |
| `npm run typecheck` | Clean in all three workspaces |
| `npm run lint` | Clean |
| `db:migrate:status` and `db:migrate` on the local database | `Applied: 46`, `Pending: none`, `0 applied, 46 already applied` |

Guards called with the real local configuration (functions only; no connection is created):

| Guard | Result |
| --- | --- |
| Target class for `DATABASE_URL` and `DATABASE_ADMIN_URL` | `production` |
| `analytics:work` guard, with `ANALYTICS_ALLOW_REMOTE_WORKER=1` present | Refused |
| Worker route guard: development, Vercel preview | Refused, refused |
| Worker route guard: Vercel production | Allowed |
| Test helpers, application and owner URL | Refused, refused |
| Pool creation inside a test run | Refused |
| `db:migrate`: no opt-in; `MIGRATE_ALLOW_REMOTE=1`; opt-in plus production host listed as non-production; yesterday's confirmation | Refused in all four cases |
| `db:reset`, `db:seed` | Refused |
| Development app pool | Warns; refused with `DEV_PRODUCTION_DATABASE_ACCESS=refuse` |

**Not run.** I tried to run the real commands (`analytics:work`, a database test file, `db:migrate`, `db:reset`, `db:seed`) with the real `.env` to watch them refuse end to end. The session's permission check blocked that as a risk to a shared resource, and I did not work around it. The table above is the safer substitute. The reviewer can repeat the end-to-end check after step 1 in section 7, when the `.env` no longer points at production.

Also not run: `db:migrate:status` against production. The diagnostic's read-only query already showed 44 applied and `0044`, `0045` pending.

## 7. Credential exposure check

| Place | Method | Finding |
| --- | --- | --- |
| Tracked files | Every value in the local `.env` of 12 characters or more (34 values, plus database passwords and host names) searched byte-for-byte | No analytics token, key, client secret, database password or session secret. Two non-secret matches below. |
| Git history, all refs | Same values searched through every patch | Same two matches only |
| Env files in Git | History of added files | Only `.env.example`, which holds placeholders. `.env` is ignored. |
| Build output | `apps/platform/.next`, 433 files | No secret. One server-side file contains the Workspace domain. |
| Client code | 44 client components checked for `process.env` and for runtime imports of the database package | None. No `NEXT_PUBLIC_` variable exists. |
| Logs | Every `console` call in `packages/db/src` and `apps/platform/src` | Each logs an error name or a fixed sentence. None logs a token, a response body or a URL. |
| Responses | Analytics routes and actions | Fixed error codes only. The worker reports counts. |
| Database, read-only | Token-shaped text outside the encrypted columns in five tables | 0 of 309 rows. `analytics_secrets` is readable by the service context only. |
| Committed debug logs | Three `.cursor/debug-*.log` files | No secret patterns. Timings and counts only. |

The two matches, neither a credential:

- The Google Workspace domain (`AUTH_GOOGLE_HD`) appears in several documents and one migration.
- A real Wix site instance id (`FORMS_WIX_INSTANCE_ID`) appears in `apps/platform/src/lib/wix-form-map.test.ts`. It identifies a site and is useless without the app secret, which is not committed. The repository is public, so replacing it with a made-up id is worth doing. This is forms code, outside analytics.

Limits: the build output scanned was the development build, not a production build, and Vercel keeps runtime logs for 30 minutes on this plan.

Residual exposure that is configuration, not code: the local `.env` holds the production owner URL and the live token key. Steps 1 and 2 below reduce that.

## 8. Remaining manual configuration

In this order. None was done for you, because each changes configuration outside the repository or your local secrets file.

1. **Repoint the local `.env` at the local database.** Set `DATABASE_URL` and `DATABASE_ADMIN_URL` to the values in `.env.example`, set `APP_DB_PASSWORD=cg_app_dev`, and remove `ANALYTICS_ALLOW_REMOTE_WORKER`. Restart the dev server. The local database is already migrated and seeded; sign in with a seeded address through `/dev/magic-links`.
2. **Keep the production owner URL out of files.** Store it in the password manager and supply it on the command line for a migration only.
3. **Confirm the production endpoint.** In Vercel, open the project's storage or database settings and check that the production host matches the one this guard recognises. Running `npm run db:migrate:status` with the production owner URL should print `database target: production …`. If it prints `remote`, add the host to `PRODUCTION_DATABASE_HOSTS` and tell me, so the fingerprint can be corrected.
4. **Create the preview database** (section 4), run `db:migrate` against it with `MIGRATE_ALLOW_REMOTE=1` and its host in `NONPRODUCTION_DATABASE_HOSTS`, then set Preview-scoped `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel. Today those two variables are shared by Preview and Production.
5. **Then turn the warning into a refusal.** Add `DEV_PRODUCTION_DATABASE_ACCESS=refuse` to the Vercel Preview environment and to local `.env` files. I left the default at "warn" so the running local setup and existing previews were not cut off mid-work.
6. **Check the provider's restore window** in the Neon console before the first production migration. The plan's history window was not verified.
7. **Decide on migrations `0044` and `0045`.** They are pending on production while the deployed code includes them. This is enquiries work and was left alone.
8. **Commit the working tree when reviewed.** The snapshot ref is a safety net on this machine only.

Still open from the diagnostic and deliberately untouched: the missing production credentials, the cron, the queue capacity and the 91 queued jobs. Those belong to later phases.

## 9. Rollback

Phase 1 changed code and documents only. There is no schema change, no data change and no deployed change to undo.

| To undo | Command or step |
| --- | --- |
| All of Phase 1, keeping D51 to D53 | `git checkout refs/backups/analytics-d51-d53-pre-phase1 -- .` then delete the three new files in section 5 and this report |
| One guard | Remove its call: `assertProcessDatabase` in `client.ts`, `assertTestDatabase` in `test/helpers.ts`, `assertWorkerDatabase` in the worker route, or restore `assertMigrationTarget` in `migrate.ts` |
| The warning only | No action: it is one log line. To silence it, repoint `.env` (step 1). |
| The snapshot ref, once the work is committed | `git update-ref -d refs/backups/analytics-d51-d53-pre-phase1` |

If a guard wrongly refuses a legitimate non-production database, list that host in `NONPRODUCTION_DATABASE_HOSTS`. Do not remove the guard.

Production migration rollback is in `docs/DEPLOYMENT.md` under "Production migration procedure": fix forward first, restore to the named restore point if data was damaged, redeploy the previous deployment if the code depends on the reversed schema.

## 10. Next

Stopped here as instructed. Phase 2 (queue and synchronisation repair) should not start until these safeguards have been reviewed and steps 1 to 4 of section 8 are done.
