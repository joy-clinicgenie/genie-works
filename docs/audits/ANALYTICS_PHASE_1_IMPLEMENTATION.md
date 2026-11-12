# Analytics Phase 1: environment safety

Date: 12 November 2026, Asia/Singapore. Finalised 11:30.
Decision: D54 in `docs/DECISIONS.md`
Branch: `analytics-data-fixes`, working tree only. Nothing is committed, pushed or deployed.
Scope: environment safeguards only. No synchronisation repair was started.

**Phase 1 status after closure (12 Nov, afternoon): CONDITIONAL PASS. Preview isolation is BLOCKED on an approval.** See C10, Part D (re-verified) and Part E (preview isolation applied).

This report has three parts. **Part C** is the closure pass and is current. **Part F** is the finalisation written at 11:30. **Part I** is the implementation record written earlier the same day. Where they differ, the later part is right.

# Part C: closure

Scope: the nine Phase 1 closure items. Nothing was deployed, no schedule was enabled, no production row was changed and no key was rotated. Phase 2 was not started.

## C0. State at the start of closure

Everything in Part F had been committed and pushed by the time closure started: 13 commits on `analytics-data-fixes` (12:07), merged to `main` as PR #3 (`fcdc846`), and deployed to production (`dpl_94dGLXaQZxLe51DCBqGWa2zHkHS8`). Because the repository is public, closure began by checking what reached GitHub (C1).

## C1. `.env.example` and Git contain no real credentials: PASS

The 34 non-empty values in the secrets backup (46 fingerprints, including the password and host inside each database URL) were compared, in a script that printed names only, against every blob reachable from any ref (2,326 blobs: all branches, `origin/*`, stashes and `refs/backups/*`), the index and every tracked file.

| Where | Result |
| --- | --- |
| `.env.example`, every revision | No real value |
| Staged changes | None staged |
| Any commit, any ref | No credential. Two non-credential matches: the Workspace domain (`AUTH_GOOGLE_HD`, already public in the README and decisions) and one real Wix site instance id in `apps/platform/src/lib/wix-form-map.test.ts` |
| Fix | The instance id is replaced with the fictional `00000000-0000-4000-8000-0000000000a1`. No tracked file now holds a real Wix instance id. The old value stays in pushed history; it is an identifier, not a credential, and needs the app secret to be used. |

## C2. Copies outside Git: found, not deleted

| Location | Result |
| --- | --- |
| VS Code local history, `.env.example` | **1 snapshot, 11:01 on 12 Nov: the exposed version.** 33 live values, including both production database URLs, `ANALYTICS_TOKEN_KEY`, the provider secrets and `RESEND_API_KEY`. Folder `~/Library/Application Support/Code/User/History/46536c5b/` |
| VS Code local history, `.env` | 2 snapshots (09:57 and 11:01), the same values. Folder `…/Code/User/History/-1f3b6621/` |
| Cursor local history | 6 snapshots (29 Oct) of `~/vsc/clinic-genie-internal-platform/.env`, another project, holding the same analytics client id and secret, token key and worker secret. Folder `…/Cursor/User/History/-57b8f261/` |
| Claude Code file history (`~/.claude/file-history`) | None |
| Time Machine | No destination configured, so no backup exists |
| iCloud Drive, Desktop, Documents, Downloads | `~/vsc` is not inside iCloud Drive, and Desktop and Documents sync is off. Every file in these folders written since 09:00 on 12 Nov (7 files; the exposure was at 11:01) was scanned: none holds a live value. Cloud-only iCloud placeholders were not downloaded |
| Other cloud storage (`~/Library/CloudStorage`) | Empty, so no Dropbox, Google Drive or OneDrive client |

All are local to this Mac, in the user's own Library, readable only by this account. None was deleted: deleting editor history is the owner's decision. Proposed: delete the three history folders above (the VS Code ones hold only these two files). The values in them are the same ones still live in production, so deleting the copies does not replace rotating them if the Mac itself is ever in doubt.

## C3. Production credentials removed from development: PASS

Before any change, each value to be cleared was checked to be byte-identical in `~/.genie-works-secrets/genie-works-env-backup-2026-11-12.env` (mode 600, directory 700). All 30 were. Then, in `.env` (mode 600):

| Change | Names |
| --- | --- |
| Cleared | `CRON_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ENQUIRY_DATABASE_URL`, `ENQUIRY_STAGING_ADMIN_URL`, `ENQUIRY_STAGING_INTAKE_URL`, `ENQUIRY_STAGING_STAFF_URL`, `ANALYTICS_GOOGLE_CLIENT_ID`, `ANALYTICS_GOOGLE_CLIENT_SECRET`, `ANALYTICS_WIX_APP_ID`, `ANALYTICS_WIX_APP_SECRET`, `ANALYTICS_TOKEN_KEY`, `ANALYTICS_WORKER_SECRET`, `RESEND_API_KEY`, `FORMS_WIX_APP_ID`, `FORMS_WIX_APP_SECRET`, `FORMS_WIX_INSTANCE_ID`, nine `FORMS_WIX_NEW_INSTANCE_*`, three `FORMS_WIX_APP_INSTANCE_*` |
| Replaced | `AUTH_SECRET`: a new random development-only value (64 characters), not production's |
| Kept | Local database settings, `DEV_PRODUCTION_DATABASE_ACCESS=refuse`, `AUTH_GOOGLE_HD` (a public domain, not a credential) |

A re-scan found no live value left in `.env`. Recovery information is the backup file, which is still the only copy and still needs to move to the password manager (C9).

Effects: local sign-in uses the development magic link only; Enquiries and Wix forms show as not connected locally; analytics stays on fixtures. **The dev server started at 11:33 still holds the old values in memory. Restart `npm run dev` to drop them.**

## C4. Independent preview database: created and empty, not yet migrated or connected

Created from the Vercel CLI, Free plan, no charge:

| Item | Value |
| --- | --- |
| Resource | `genie-works-preview`, `store_hpbaI5WJfp7RjJ7k`, Neon project `ancient-feather-14363615` |
| Plan, region | `free_v3` (Free), `sin1` |
| Created as | A new Neon project, not a branch of `genie-works-database`, so it holds no client record and no token |
| Connected to a project | No (`--no-connect`, no env pull) |
| Project variables after creation | Unchanged: the same 32 entries, same targets, same update times |

Not done: migration and the first administrator. Vercel returns the new database's credentials only to a connected project; connecting it adds project variables, which this session was not permitted to do (C5). Until it is connected and migrated, "verified empty" rests on it being a new project rather than on a query.

## C5. Preview still shares production credentials: BLOCKED on approval

Read from Vercel, names and targets only. Preview currently receives, through entries shared with Production:

- `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and 14 Neon integration entries (`PG*`, `POSTGRES_*`, `NEON_*`, `VITE_NEON_AUTH_URL`): the production database
- `AUTH_SECRET`: the production session secret
- `FORMS_WIX_APP_ID`, `FORMS_WIX_APP_SECRET`: the production Wix forms app credentials

Preview has no `ANALYTICS_*`, `CRON_SECRET` or `AUTH_GOOGLE_*`. The Phase 1 guard already refuses the analytics worker in Preview (C8).

**Exact proposed changes, for approval.** Steps 1, 3 and 4 change project variables; step 3 edits entries that also serve Production, though the Production values do not change.

1. Connect `genie-works-preview` to project `genie-works`, environment Preview only, prefix `PREVIEW_`:
   `vercel integration resource connect genie-works-preview genie-works -e preview --prefix PREVIEW_`
   This only adds new `PREVIEW_*` Preview entries. The app reads `DATABASE_URL`, so nothing changes in behaviour yet.
2. Migrate it from an operator shell (Part F, F2 step 3), with `NONPRODUCTION_DATABASE_HOSTS` set to its direct host and a new random `APP_DB_PASSWORD` of 24+ characters. Confirm `db:migrate:status` prints `approved non-production` and `Pending: none`, and that `staff_users`, `clients` and `analytics_connections` each count 0. Then insert the first administrator (F2 step 4).
3. Remove Preview from the shared entries, keeping Production exactly as it is:
   - Neon integration entries: in the `genie-works-database` store → Projects → `genie-works`, untick Preview (or `vercel integration resource disconnect` and reconnect with `-e production` only, which briefly removes them from Production too, so prefer the dashboard)
   - `AUTH_SECRET`, `FORMS_WIX_APP_ID`, `FORMS_WIX_APP_SECRET`: edit each, untick Preview
4. Add Preview-only, sensitive: `DATABASE_URL` (the `cg_app` URL on the preview pooled host), `AUTH_SECRET` (new random), `DEV_PRODUCTION_DATABASE_ACCESS=refuse`, `APP_ENVIRONMENT_LABEL=preview`. For sign-in, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` for Preview, with the preview URL added to that OAuth client's redirect URIs.
5. Do not add `ANALYTICS_*`, `CRON_SECRET`, `ENQUIRY_*`, `FORMS_WIX_*` or `DATABASE_ADMIN_URL` to Preview.
6. Verify: list the variables again (Production entries unchanged; Preview has no production value), open a new preview deployment, sign in, and see the empty client list.

Do steps 3 and 4 when no deployment is running.

## C6. Production analytics connections and reports: preserved, not re-measured

Nothing in closure wrote to production: no migration, no worker run, no query except as below. A fresh read-only count was refused by this session's permission settings, so the latest measurement is still Part F, F3 (22 connections, 22 stored secrets, 116 jobs, 22 sync runs, 21 reports, 62 coverage days). Production now runs `fcdc846`, which includes D51 to D54; the worker remains unscheduled (C7), so that deployment has not run a job.

## C7. Root Directory and cron configuration unchanged: PASS

| Item | State |
| --- | --- |
| Vercel Root Directory | `apps/platform`, unchanged |
| Registered crons | `definitions: []` for the production deployment |
| Repository `vercel.json` | Declares the `analytics-worker` schedule (D55, merged in PR #3). It is not read while the Root Directory is `apps/platform`, so no schedule is active |

Not changed in closure. Changing the Root Directory activates the schedule and belongs to Phase 2.

## C8. Tests and environment guards: PASS

Against the local database (`Applied: 46`, `Pending: none`), with `ANALYTICS_FIXTURE_MODE=1` and the hosted enquiry URLs cleared:

| Check | Result |
| --- | --- |
| `packages/db` | 37 files, 217 passed, 0 failed |
| `apps/platform` | 22 files, 131 passed, 0 failed |
| `npm run typecheck`, `npm run lint` | Exit 0 |
| `npm run test:decisions` | 8 passed, 0 failed |

Real commands against made-up hosts that do not resolve:

| Command | Host marked production | Unlisted remote host |
| --- | --- | --- |
| `npm run analytics:work` with `ANALYTICS_ALLOW_REMOTE_WORKER=1` | Refused | Refused |
| `npm run db:migrate` with `MIGRATE_ALLOW_REMOTE=1` (and the host also listed as non-production) | Refused | Refused |
| `npm run db:seed`, `npm run db:reset` | Refused, refused | not run |
| A `packages/db` test file | Refused | Refused |

Guard functions given the real production URLs from the backup, with no host list set (fingerprint only, no connection opened): both URLs classify as `production`; tests refused; worker refused in development and in a Vercel preview, allowed only in the Vercel production deployment. The development `.env` classifies as `local`.

## C9. Commit

Closure changes one tracked file, `apps/platform/src/lib/wix-form-map.test.ts` (C1), plus this report. Neither holds a credential (re-scanned). `.env`, `.DS_Store` and `apps/platform/AGENTS.md` are git-ignored; no temporary or debug file is in the tree. Committed on a new branch from `main`; not pushed.

## C10. Phase 1 status: CONDITIONAL PASS

| Item | Status | Evidence |
| --- | --- | --- |
| 1. No credentials in `.env.example` or staged changes | PASS | C1 |
| 2. Editor history and synced backups | PASS (investigated). Copies found in local editor history, not deleted | C2 |
| 3. Production credentials out of development | PASS. Restart the dev server | C3 |
| 4. Independent empty Neon database for Preview | CONDITIONAL. Created, empty, unconnected; not migrated | C4 |
| 5. Preview shares no production credential | **BLOCKED** on approval of C5 | C5 |
| 6. Production analytics preserved | PASS, from Part F evidence; no write since | C6 |
| 7. Root Directory and cron unchanged | PASS | C7 |
| 8. Tests and guards | PASS | C8 |
| 9. Clean commit | PASS | C9 |

To reach PASS:

1. Approve and complete C5 steps 1 to 6.
2. Move the secrets backup into the password manager, then delete `~/.genie-works-secrets/genie-works-env-backup-2026-11-12.env`.
3. Delete the editor-history copies in C2, or record a decision to keep them.

Phase 2 must not start before then.

# Part E: preview isolation applied (12 Nov, evening, approved)

Approved and run: C5 steps 1 to 5. Nothing was deployed, no schedule enabled, no production row touched, no key rotated. No secret value was printed or written to the repository.

| Step | Result |
| --- | --- |
| 1. Connect `genie-works-preview` to Preview only | Done. The prefix in C5 was wrong: Vercel rejects a trailing underscore, so the command is `--prefix PREVIEW`. 18 `PREVIEW_*` entries were added, target Preview only |
| 2. Migrate | `db:migrate:status` first printed `approved non-production`, `Applied: 0`, so the database was fresh. After `db:migrate`: 46 applied, `Pending: none`. Checked as owner: 0 staff, 0 analytics connections, 0 stored secrets, 0 jobs. One client, the internal `clinic-genie` row that migration 0027 creates. RLS on 75 of 75 tables. `cg_app` has no bypass and is not a superuser, logs in through the pooled host and sees 0 clients. `APP_DB_PASSWORD` was a new random 32 characters |
| 3. Remove Preview from shared entries | 21 entries narrowed from Production+Preview to Production only through the Vercel API (`PATCH` of `target` alone): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AUTH_SECRET`, `FORMS_WIX_APP_ID`, `FORMS_WIX_APP_SECRET` and 16 Neon entries. Entry count 50 before and after. No other entry changed |
| 4. Preview-only variables | Added, all sensitive: `DATABASE_URL` (`cg_app`, preview pooled host), `AUTH_SECRET` (new random), `DEV_PRODUCTION_DATABASE_ACCESS=refuse`, `APP_ENVIRONMENT_LABEL=preview`. No `ANALYTICS_*`, `CRON_SECRET`, `ENQUIRY_*`, `FORMS_WIX_*` or `DATABASE_ADMIN_URL` for Preview |
| 5. Verify | Preview-targeted non-`PREVIEW_` entries are exactly the four above. Production sign-in page returns 200. Sensitive values cannot be read back, so the unchanged Production values are inferred from a target-only edit and the 200, not compared |

Not done:

- **No preview deployment was made** (deploying was excluded), so sign-in and the empty client list on a real preview are unverified.
- **First administrator not inserted.** It needs the address to use. `staff_users` is empty, so nobody can sign in to Preview yet.
- **Preview Google sign-in.** `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are not set for Preview (no preview OAuth client exists), and the preview URL must be added to that client's redirect URIs. `AUTH_URL` is Production only.
- Temporary files holding the preview credentials were deleted. The `cg_app` password is now stored only in the Preview `DATABASE_URL`; reset it as owner with `alter role cg_app password …` if it is needed again.

**Addendum, at the owner's instruction:** `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` were extended from Production to Production+Preview (target-only edit, values untouched). This shares the live Google OAuth client with Preview; it shares no database, session secret or client record. The preview URL must still be added to that client's authorised redirect URIs, and `AUTH_URL` remains Production only. To undo, set both targets back to Production.

**Addendum 2:** `AUTH_GOOGLE_HD` (the Workspace domain, a public value) was added for Preview only, so Preview sign-in is limited to that domain. Production has no such entry in Vercel and was not changed.

**Addendum 3:** the first preview administrator was inserted into the preview database (`staff_users`: 1 row, role `admin`). It is the owner's Workspace address, which is deliberately not written in this report. Preview sign-in still needs the redirect URI on the Google client, and a preview deployment to confirm it.

**Addendum 4 (preview deployment, at the owner's instruction):** `vercel deploy` from `analytics-phase1-closure` produced `dpl_5PLoLfzxQ5RTfBcnvLwpkjLiv56W`, target `preview`, status Ready. It is behind Vercel Authentication, so its pages could not be fetched without a Vercel login, and sign-in and the empty client list are **not yet verified**. The URL is unique to the deployment; it is not an alias, so it cannot be registered as a stable Google redirect URI. Production was not deployed or changed (sign-in page still 200).

Rollback: set `target` of the 21 entries back to Production+Preview with the same API call; remove the four Preview variables; `vercel integration resource disconnect genie-works-preview genie-works`.

# Part D: closure re-verification (12 Nov, evening)

Read-only re-check of Part C on branch `analytics-phase1-closure` at `c2d1507`. Nothing was deployed, no variable was changed, no schedule was enabled, no production row was read or written and no key was rotated.

| Item | Status | Evidence |
| --- | --- | --- |
| 1. No credential in `.env.example` or staged changes | PASS | Values from the secrets backup (names-only script) compared with `.env.example` in the working tree and in all 14 revisions, every tracked file and the development `.env`: no credential matches. Only non-secret local settings match (`EMBEDDED_PG_DIR`, `SEED_ALLOWED_DB_PATTERN`, `AUTH_URL`, `APP_ENVIRONMENT_LABEL`, `UPLOADS_DIR`). Nothing is staged |
| 2. Editor history and backups | PASS (investigated, not deleted) | Unchanged from C2. Deleting the three history folders is still the owner's decision |
| 3. Production credentials out of development | PASS | The development `.env` holds no backup value apart from the non-secret settings above |
| 4. Independent empty Neon database | CONDITIONAL | `genie-works-preview` exists (`vercel integration list --all`), Available, connected to no project. Not migrated, so "empty" rests on it being a new project |
| 5. Preview shares no production credential | **APPLIED, see Part E.** Was BLOCKED. | `vercel env ls` still shows `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AUTH_SECRET`, `FORMS_WIX_APP_ID`, `FORMS_WIX_APP_SECRET` and 14 Neon entries targeting Preview and Production. Needs approval of the C5 steps |
| 6. Production analytics preserved | PASS (not re-measured) | No write since Part F, F3 |
| 7. Root Directory and cron unchanged | PASS | No change made; see C7 |
| 8. Tests and guards | PASS | `packages/db` 37 files, 217 passed. `apps/platform` 22 files, 131 passed. Typecheck and lint exit 0. `test:decisions` 8 passed, 0 failed. `db:migrate` and `analytics:work` with an unlisted remote host both refused |
| 9. Clean commit | PASS | Only this report changes. No `.env`, backup or debug file is included |

Also noted: `.cursor/debug-af0448.log`, `debug-c3d738.log` and `debug-f8030a.log` are tracked, from earlier commits. They hold no credential, but they are debug output and could be removed from tracking. Not changed here.

**Phase 1 status: CONDITIONAL PASS.** Item 5 was applied in Part E. Remaining conditions: first preview administrator, preview Google sign-in, a preview deployment check, backup into the password manager, editor history decision. Phase 2 must not start.

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
