# Analytics Production Readiness (controlled pilot)

> **Renumbered 23 Nov 2026** when this work moved onto `main` (branch `analytics-phase2`): migrations `0046_analytics_scheduling` and `0047_analytics_worker_invocations` in this record are now `0053` and `0054`, because main already used 0046 and 0048–0052. Decisions are cited by their new numbers D68–D72.

Date: 2026-11-13. Branch `analytics-phase1-closure` at `15162ad`, plus 77 uncommitted paths (33 modified files, the rest new).
Scope: preparation only. Nothing was deployed, pushed, migrated or scheduled. The production database, the production worker and every production credential were not touched. Evidence labels: [V] read-only Vercel metadata (variable names, deployment list; no values), [C] code, [T] local test, [D] docs, [N] not verified.

**Overall status: BLOCKED on owner actions (section 2). Code is ready. Checkpoint 1 (production health) is a CONDITIONAL PASS (section 9). Migration verification is prepared and waiting for an owner-role read (section 10).**

## 1. Prerequisite status

| # | Prerequisite | Status | Evidence / what is missing |
|---|---|---|---|
| P1 | Health check is least-privileged, read-only, leak-free | **PASS** (after one small hardening, 1.1) | 1.1 |
| P2 | Production health check run and reviewed (G0) | **CONDITIONAL PASS** | Run 13 Nov with `cg_app`, read-only, token key not supplied. Section 9 |
| P3 | Encryption key opens all stored tokens | **NOT TESTED** | The check ran without a key (the original is not to hand). 21 syncs succeeded 30 Oct to 2 Nov, so the key then in Vercel worked; whether it is unchanged is proved by the post-deploy probe (section 9) |
| P4 | Secrets backup secured | **BLOCKED** | File still on this Mac: `~/.genie-works-secrets/genie-works-env-backup-2026-11-12.env` (mode 600, dir 700). Owner action 3 |
| P5 | Editor-history copies handled | **BLOCKED** | Three history folders still exist (Code x2, Cursor x1). Owner action 4 |
| P6 | No credential in Git | **PASS** | 2.3 |
| P7 | Working tree committed and reviewed | **BLOCKED** | 77 uncommitted paths; branch is 10 commits ahead of `origin/main` and not on any remote. Owner action 5 |
| P8 | Local tests, typecheck, lint, build | **PASS** | 1.2 |
| P9 | Migrations 0044 to 0047 | **BLOCKED** | Health check's schema inspection shows 0044 to 0047 objects absent. Migration history not yet read, so this is unconfirmed. `fcdc846` ships 0044 and 0045 but not 0046 or 0047. Verification command: section 10 |
| P10 | Database restore point | **BLOCKED** | Cannot be created or confirmed from here (Neon console). Owner action 6 |
| P11 | Vercel Root Directory | **PASS** (do not change) | `apps/platform` [V]. See 3.3: `docs/DEPLOYMENT.md` still says the opposite |
| P12 | Production environment variable names | **PASS with one owner confirmation** | 3.4 |
| P13 | Rollback deployment available | **PASS** | `dpl_94dGLXaQZxLe51DCBqGWa2zHkHS8` = `fcdc846`, READY, aliased, current production [V] |
| P14 | Preview isolation | **PASS** | 3.5 |
| P15 | Pilot route disabled by default | **PASS** | No allow-list variable exists in any environment [V]; route returns 403 when unset [T] |
| P16 | Schedule absent | **PASS** | No `apps/platform/vercel.json`; the root `vercel.json` schedule is ignored by Vercel [V][C] |

### 1.1 Task 1: health check review

Read in full: `packages/db/scripts/analytics-connection-health.ts`.

| Requirement | Result |
|---|---|
| Least-privileged role | `DATABASE_URL` is the only connection used (via `withContext(SERVICE)`), which is `cg_app` (`nobypassrls`). **Hardening made:** the script now throws unless `current_user` is `cg_app`, so an owner URL pasted by mistake is refused. It is a script-only change; typecheck and lint pass |
| Database-enforced read-only | The first statement after the RLS context is `set transaction read only`. The script contains only `select` statements (no insert/update/delete/alter/create). Database refusal of writes inside `withReadOnlyContext` is proven by the pilot tests [T]. The health script uses the same statement |
| Cannot change connections, tokens, jobs, reports | Reads only; calls no provider; no function that writes. Decryption is in memory |
| No credentials or client data in output | Prints counts, states, dates, 8-character hashes of ids, and yes/no token facts. No token, property id, site address or clinic name. Only the internal agency client is named. Local output was inspected |
| Does the key open existing connections | Yes, now explicit: `tokenKeyVerdict` reads `KEY OPENS ALL n stored tokens`, `KEY DOES NOT OPEN k of n stored tokens: do not deploy or run the pilot`, or `NOT TESTED`. Per connection: `decrypt: ok / fails / no_secret` |
| Remote guard | Refuses a non-local host unless `ANALYTICS_HEALTH_REMOTE_CONFIRM` equals the host name |

Limitation: `schema_migrations` is unreadable to `cg_app`, so migration status is inferred from schema objects.

**Exact command (owner shell; values from the password manager, never typed into history).** Use a subshell so nothing stays in the environment:

```bash
cd ~/vsc/genie-works
(
  read -rs "DATABASE_URL?Production cg_app URL: "; echo; export DATABASE_URL
  read -rs "ANALYTICS_TOKEN_KEY?Production token key: "; echo; export ANALYTICS_TOKEN_KEY
  export ANALYTICS_HEALTH_REMOTE_CONFIRM="$(node -e 'console.log(new URL(process.env.DATABASE_URL).hostname)')"
  DEV_PRODUCTION_DATABASE_ACCESS= npm run analytics:health -w @clinic-genie/db > ~/health.json
)
```

Do not use `DATABASE_ADMIN_URL`; the script refuses it.

**Expected output (shape; counts are what the diagnostic last recorded [P], to be confirmed):**

```json
{
  "database": { "place": "production", "role": "application role (cg_app)", "readOnlyTransaction": true },
  "migrationsInferredFromSchema": {
    "0039...": true, "0042...": true, "0043...": true, "0044...": true, "0045...": true,
    "0046_analytics_scheduling ...": false,
    "0047_analytics_worker_invocations": false
  },
  "tokenKeyProvidedToThisCheck": true,
  "tokenKeyVerdict": "KEY OPENS ALL 21 stored tokens",
  "connections": { "total": 22, "decrypt": { "ok": 21, "no_secret": 1 }, "list": [ { "connection": "<8 hex>", "client": "clinic-genie (internal agency, CG-000)", "provider": "ga4", "status": "connected", "decrypt": "ok", "token": { "hasRefreshToken": true } } ] },
  "jobs": { "byState": { "...": 0 } }
}
```

0046 and 0047 `false` is correct before migration. Stop conditions: `tokenKeyVerdict` starts `KEY DOES NOT OPEN`; `role` is not the application role; the internal client has no `ga4` connection with `decrypt: ok` and a refresh token; any `leased` job duplicated per connection (see section 4 pre-check).

### 1.2 Final local checks (after the hardening)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:decisions` | exit 0 |
| `npm test` | `packages/db` 46 files, 400 tests pass; `apps/platform` 24 files, 155 tests pass |
| `npm run build` | completed; route table lists the pilot and worker routes |
| Local health check | runs against the local database: `cg_app`, read-only, valid JSON |

## 2. Remaining owner actions (in order)

1. **Authorise or run P2.** Either run the command in 1.1 yourself and share `health.json` (it contains no secret), or explicitly authorise me to run it with the backup file's values.
2. Decide the pilot connection from `health.json`: the entry with `client` = `clinic-genie (internal agency, CG-000)`, `provider` = `ga4`. If absent, stop and choose with me.
3. **Secure the backup (P4):** copy the file into the password manager as a secure note; compare checksum of the stored text with the file; only then delete the file (`rm` after the check). Do not email, sync or place it in a cloud-synced folder. Keep it until the pilot is confirmed, since it is the only recovery copy of the values cleared from `.env`.
4. **Editor history (P5):** delete or keep by recorded decision: `~/Library/Application Support/Code/User/History/46536c5b`, `.../Code/User/History/-1f3b6621`, `.../Cursor/User/History/-57b8f261`. Recommendation: delete the two Code folders (they hold only the two files) and the Cursor folder once nothing else in it matters. Deleting copies does not replace rotation; rotate only if the Mac is ever in doubt. No deletion or rotation was done here.
5. **Commit and review (P7):** review `git diff` for secrets and real data (repository is public), commit on `analytics-phase1-closure`. Pushing is yours to decide. A Preview deployment is built from the pushed branch or by `vercel deploy`.
6. **Restore point (P10):** in the Neon console create a branch/snapshot of production now; record its name, time and the restore window.
7. **Migrations (P9):** first run the read-only verification in section 10 and send me the output; apply nothing from the schema inspection alone. Then follow `docs/DEPLOYMENT.md` (restore point, `MIGRATE_PRODUCTION_CONFIRM`, `MIGRATE_BACKUP_REFERENCE`, owner URL supplied for the command only). Run first: `select connection_id from analytics_jobs where state = 'leased' group by 1 having count(*) > 1` (must return no rows).
8. Confirm in the Vercel dashboard that `ANALYTICS_LIVE_REPORTS` is `true` (sensitive values cannot be read through the API).
9. Correct `docs/DEPLOYMENT.md` (see 3.3).

## 3. Task 3: deployment preparation findings

### 3.1 Production commit and branch [V]
Production = `dpl_94dGLXaQZxLe51DCBqGWa2zHkHS8`, commit `fcdc846` ("Merge pull request #3"), branch `main`, READY, aliased. Previous production deployments (`dpl_BrjF…`, `dpl_75L4…`, `dpl_8he8…`, all `31551b5`) are further rollback targets. Local `main` is `4a8832e`, ahead of `origin/main` (`fcdc846`).

### 3.2 Working tree
Branch `analytics-phase1-closure`, 77 uncommitted paths; 10 commits not on `origin/main`; not on any remote branch. The Phase 2 work, C1/C2 and this report are all uncommitted. Preview deployment `dpl_5PLo…` earlier came from the working tree via CLI.

### 3.3 Root Directory
`apps/platform` [V]. Do not change. **Conflict found:** `docs/DEPLOYMENT.md` line 11 says the Root Directory must be the repository root and the root `vercel.json` is "the only Vercel configuration file". That is wrong for this project; the root `vercel.json` (including its schedule and build command) is ignored. The schedule must go in `apps/platform/vercel.json`, last, after the pilot. Update that document before anyone follows it.

### 3.4 Production variable names [V]
Present: `ANALYTICS_GOOGLE_CLIENT_ID`, `ANALYTICS_GOOGLE_CLIENT_SECRET`, `ANALYTICS_WIX_APP_ID`, `ANALYTICS_WIX_APP_SECRET`, `ANALYTICS_TOKEN_KEY`, `ANALYTICS_LIVE_REPORTS`, `CRON_SECRET`, `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_*`, `FORMS_WIX_APP_*`. All production values are sensitive (unreadable).
Absent and expected: `ANALYTICS_PILOT_ALLOWED_CONNECTIONS` (add for the pilot), `DATABASE_ADMIN_URL` (correct: keep it out of Vercel).
Absent, harmless: `ANALYTICS_WORKER_SECRET` (the worker and pilot accept `CRON_SECRET`). The pilot bearer is therefore `CRON_SECRET`.
Not present in production: `ENQUIRY_DATABASE_URL` (enquiry reads are a separate matter; not a pilot blocker).
Needs confirmation: that `ANALYTICS_LIVE_REPORTS` equals `true`, and that the production `ANALYTICS_TOKEN_KEY` is the key that sealed the stored tokens (P3).

### 3.5 Preview isolation [V]
Preview has its own `DATABASE_URL`, `AUTH_SECRET`, `DEV_PRODUCTION_DATABASE_ACCESS`, `APP_ENVIRONMENT_LABEL`. No `ANALYTICS_*`, `CRON_SECRET`, `FORMS_WIX_*` or admin URL targets Preview. `AUTH_GOOGLE_ID/SECRET` are shared with Production at the owner's instruction (the OAuth client only; no database or session secret). The analytics worker is refused in Preview by code [C]. Consequence: the pilot route cannot run, and no provider token can be reached, from Preview.

### 3.6 Deployment order (preserves the website and all connections)

| Step | Action | Who | Gate |
|---|---|---|---|
| 0 | P2, P3: health check; review | Owner | `KEY OPENS ALL`, internal GA4 connection found |
| 1 | Secure backup (action 3); decide history (4) | Owner | Backup in password manager |
| 2 | Commit and review the tree | Owner | No secrets or real data in diff |
| 3 | Restore point in Neon | Owner | Name, time, window recorded |
| 4 | Verify (section 10), pre-check query, then migrate whatever is genuinely pending (expected 0044 to 0047) | Owner | `Pending: none`; current production code still works (the older code ignores new columns; production tests passed against that schema [T]) |
| 5 | Deploy the tested code to production **without `apps/platform/vercel.json`**; no `ANALYTICS_PILOT_ALLOWED_CONNECTIONS` yet | Owner | Site pages 200; Schedules tab empty; worker and pilot return 401 unauthenticated |
| 6 | Add `ANALYTICS_PILOT_ALLOWED_CONNECTIONS=<8 hex>` for Production; redeploy (variables apply to new deployments) | Owner | Pilot unauthenticated still 401 |
| 7 | Pilot steps (section 4) | Owner / authorised | Each step's check |
| 8 | Remove the allow-list variable when finished or on any failure | Owner | Pilot route 403 |
| 9 | Only then, a separate release: schedule in `apps/platform/vercel.json`, proven in Preview first | Owner | Out of scope here |

## 4. Task 4: pilot procedure (prepared, not run)

Common shell setup (owner; the secret never printed or kept in history):

```bash
( read -rs "TOKEN?Bearer (CRON_SECRET): "; echo
  export BASE="https://<production host>"; export CONN="<8 hex from health.json>"
  call() { curl -sS -X POST "$BASE/api/internal/analytics/pilot" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$1"; echo; }
  call "{\"connection\":\"$CONN\",\"mode\":\"probe\"}"
)
```

| Step | Action | Expected result |
|---|---|---|
| 1 Identify | In `health.json`: `client` = clinic-genie internal, `provider` = `ga4`, `status` = `connected`, `decrypt` = `ok`, `hasRefreshToken` = true. Note `connection` (8 hex) | Exactly one entry |
| 2 Allow-list | Vercel dashboard, Production only, sensitive: `ANALYTICS_PILOT_ALLOWED_CONNECTIONS=<8 hex>`; one reference only | Redeploy shows variable present |
| 3 Deploy, no schedule | Section 3.6 step 5 | Schedules tab: none |
| 4 Probe | `{"connection":"<ref>","mode":"probe"}` | `200` with `"mode":"probe"`, `"decrypt":"ok"`, `"refresh":"ok"`, `"ready":true`, `"changedConnection":false`. Any other `refresh` value: stop (`invalid_grant` = genuine revoked grant, reconnect needed; `oauth_client_rejected` = wrong OAuth client in Vercel; `config_missing`; `rate_limited`/`provider_unavailable`: retry later). Wrong bearer: `401`; wrong ref: `403 "This connection is not allowed for the pilot."` |
| 5 One job | `{"connection":"<ref>","mode":"run","maxJobs":1}` | `jobs:1`, `succeeded:1`, `failed:0`, `reconnectRequired:0`, `connectionStatusChanged:false`, `reports` with 1 entry |
| 6 Rest of GA4 | `{"connection":"<ref>","mode":"run"}` | Total 11 jobs over both calls (`plannedTotal:11`), `stopped:"empty"`. A repeat returns `jobs:0` (idempotent). Failures: `credentialOrConfigWaiting` > 0 means server config; connection stays untouched |
| 7 Pages | Sign in, open the internal client's Analytics pages for the pilot window (end = GA4 today minus 4 days; traffic daily covers 14 days) | Figures visible, no "unavailable" for the covered windows; other clients unchanged |
| 8 Compare | In GA4, same property, same dates and time zone: users, sessions, new users, engagement rate, top channels, devices, countries, top pages | Counts equal for fixed past days; GA4 can still revise recent days, so compare days older than 3 |

Checks after steps 5 to 6 (read-only, owner): re-run the health command; expected: connection statuses identical to before, no other connection's jobs changed, `analytics_report_partitions` published count up by 11 for this connection only; audit events `analytics.pilot.probe` (success) and `analytics.pilot.run` (success) exist.

## 5. Credential and database safeguards

- Health check and pilot only ever use `cg_app`; owner URL only for the migration command and never in Vercel.
- Health check refuses non-`cg_app`, refuses remote hosts without explicit confirmation, runs read-only, prints no secret.
- C1: a wrong key, OAuth client or missing configuration never marks a connection for reconnection and never rewrites a stored token [T].
- Pilot: bearer required, explicit one-connection allow-list, identical refusal for unknown and unlisted, 12-job cap, overlap cap, audit entries without identifiers or tokens [T].
- Existing encryption key and refresh tokens: do not rotate `ANALYTICS_TOKEN_KEY` (all 21 stored tokens would become unreadable); do not delete `analytics_secrets`; keep the backup until the key is proven (P3).
- Git: tracked files contain only local development placeholders (`cg_app_dev`, `postgres:postgres` on 127.0.0.1). `.env` is ignored. Phase 1 compared 46 production value fingerprints against 2,326 reachable blobs earlier: no match [D]. Re-run that scan on the final commit before any push.

## 6. Rollback

| Situation | Action |
|---|---|
| Pilot misbehaves | Remove `ANALYTICS_PILOT_ALLOWED_CONNECTIONS`, redeploy: route returns 403 |
| Bad deployment | Vercel Instant Rollback to `dpl_94dGLXaQZxLe51DCBqGWa2zHkHS8` (`fcdc846`) |
| Pilot data wrong | Un-publish only that connection's generation-1 partitions fetched since the pilot start (count must be 11); nothing deleted |
| Migration 0047 | `ANALYTICS_RECORD_INVOCATIONS=off`, or `packages/db/rollback/0047_analytics_worker_invocations.down.sql` |
| Migration 0046 | `packages/db/rollback/0046_analytics_scheduling.down.sql`, only after the previous code is live |
| Connection wrongly flagged | Reset by admin SQL only after the cause is fixed |
| Data damage | Restore the Neon restore point into a **new** branch, compare, then promote |

## 7. Pilot verification checklist

- [ ] Health check: `KEY OPENS ALL`, role `cg_app`, internal GA4 connection found
- [ ] Backup secured; history decision recorded
- [ ] Tree committed, diff reviewed, secret scan clean on the final commit
- [ ] Restore point named and window known
- [ ] 0046 and 0047 applied; `Pending: none`; site healthy
- [ ] Deployed without a schedule; Schedules tab empty
- [ ] Allow-list holds exactly one reference
- [ ] Probe: `refresh: ok`, `ready: true`
- [ ] One job succeeded; connection status unchanged
- [ ] 11 GA4 jobs complete; repeat run does nothing
- [ ] Figures appear on the Analytics pages; other clients unchanged
- [ ] GA4 comparison within agreed tolerance for settled days
- [ ] Allow-list removed or kept deliberately; no schedule activated

## 8. Not verified here

Production schema state, token decryptability, `ANALYTICS_LIVE_REPORTS` value, live Google behaviour, restore window, and whether Google OAuth client settings allow the production callback. Pilot success is not "live" until the checklist is complete.


## 9. Checkpoint 1: production health result (13 Nov 2026) - CONDITIONAL PASS

Run read-only as `cg_app` against the production database (pre-flight classified it `production`, user `cg_app`; read-only transaction; leak check clean; connection string never displayed). The token key was left empty on purpose, so decryption was **not tested**. Output kept in `~/health-check/health.json` (sanitised).

| Finding | Result |
|---|---|
| Role and transaction | Application role, read-only |
| Connections | 22 in total across 11 clients. 21 connected: 1 GA4, 10 Search Console, 10 Wix. 1 Search Console connection disconnected |
| Internal Clinic Genie GA4 connection | **`0c75074e`** (`clinic-genie`, CG-000): connected, time zone set, verified 2026-10-30. The only GA4 connection |
| Last successful synchronisation | 2 November 2026, 10:01 UTC. 21 runs succeeded, 0 failed, first run 30 Oct |
| Queue | 91 queued (oldest 13.8 days), 1 leased job whose lease has expired, 3 cancelled, 21 succeeded. Newest job created 2 Nov. No duplicate leased job is visible (only one is leased) |
| Published reports | GA4: 6 templates, windows to 30 Oct. Search Console: to 26-27 Oct. Wix: to 30 Oct. Nothing newer, which is why recent periods are empty |
| Decryption | **NOT TESTED** (no key supplied). Tokens decrypted for 21 syncs in 30 Oct to 2 Nov, so the key then in Vercel was correct; unchanged since is unproven |
| Migrations (inferred from schema) | 0039, 0042, 0043 objects present. 0044, 0045, 0046, 0047 objects absent. History table not read |

Why this is a conditional pass, not a pass: decryption and migration history are unverified. Why not a fail: the target, role, read-only boundary, the single internal GA4 connection, and a healthy sync history are all confirmed.

Decryption will be proved by the pilot probe after deployment, which uses Vercel's own key (`decrypt: ok`). Until then the scheduled worker must stay off: the production code deployed today would treat an unreadable token as a reason to flag the connection for reconnection.

Correction to section 3.6 and earlier notes: production's schema stops at 0043, not 0045 (to be confirmed by section 10).

## 10. Migration verification (prepared; not run against production)

### 10.1 What each migration does

| Migration | Creates or changes | Needs from the existing schema | Rollback |
|---|---|---|---|
| **0044** `website_enquiry_forms` | New table `website_enquiry_forms` (one row per Wix form a website reads), 3 indexes, 2 trigger functions and triggers (client and site ownership check; admin-only changes for `cg_app`), row-level security with 4 policies, grants to `cg_app`. **Copies data:** inserts one row per website that already has a Wix form binding (`on conflict do nothing`). Does not change `websites` | `websites` columns from 0036 (`wix_instance_id`, `wix_form_id`, `wix_form_key`, `wix_form_namespace`, `wix_counts_in_totals`, `enquiry_source`), `staff_users`, functions `app_is_admin`, `app_can_access_client`, `app_can_edit_client` | No down file. Proposed after verification: drop the table (code falls back to the `websites` columns). Loses any extra forms added after migration |
| **0045** `wix_inbox_messages` | Two new tables (`wix_inbox_messages`, `wix_inbox_coverage`), 3 indexes, owner-check and append-only triggers, row-level security with policies, grants (no update or delete on messages). Stores ids and timestamps only, no message content | `websites` (`enquiry_source`, `wix_instance_id`), `staff_users`, functions `app_is_admin`, `app_can_access_client` | No down file. Dropping loses recorded Inbox message ids; prefer a restore point |
| **0046** `analytics_scheduling` | Adds 2 columns to `analytics_jobs` (`window_class`, `priority`), 3 to `analytics_connections` (`last_served_at`, `cooldown_until`, `consecutive_failures`), 2 indexes, including a **unique index allowing one leased job per connection** | `analytics_jobs`, `analytics_connections`. Index fails if a connection has two leased jobs | `rollback/0046_analytics_scheduling.down.sql` (after the previous code is live) |
| **0047** `analytics_worker_invocations` | One new table with 2 indexes and row-level security (service and global roles only). Run statistics only | Functions `app_is_global`, `app_is_service` | `rollback/0047_analytics_worker_invocations.down.sql`, or `ANALYTICS_RECORD_INVOCATIONS=off` |

Each file runs in its own transaction and is recorded in `schema_migrations` in the same transaction, so a failing file leaves nothing behind. A "partly applied" migration can therefore exist only if someone applied SQL by hand, which is what the verification checks for.

### 10.2 Does the deployed production code (`fcdc846`) depend on them?

| Object | Dependence in `fcdc846` [C] | Effect if absent |
|---|---|---|
| 0044 table | Guarded: `listWixEnquiryBindings`, `bindWixEnquiryForm`, `addWixEnquiryForm` and `removeWixEnquiryForm` check `to_regclass('public.website_enquiry_forms')` and fall back to the single binding on `websites` | Enquiries and Wix enquiry lists keep working with one form per website. Adding a second form is not available |
| 0045 tables | **Not guarded** in `listInboxCoverage`, which the Enquiries "Forms" page (`/enquiries/forms`) calls | That page is likely to error with "relation does not exist" if the table is missing. This is inferred from code, not observed |
| 0045 webhook | `POST /api/wix/inbox` returns 503 when `FORMS_WIX_WEBHOOK_PUBLIC_KEY` is unset. That variable is not among the production variable names | No Inbox record is being written today, so no data is lost |
| 0046, 0047 | Not in `fcdc846` at all | None. The new code needs them |

So the main Enquiries pages should be unaffected today; the Forms page is the one to check. Applying 0044 and 0045 is additive and, once applied, switches Enquiries to the per-form table backfilled from the existing bindings.

### 10.3 Exact read-only command (owner role; not run)

New script `packages/db/scripts/migration-verify.ts` (read-only; one read-only transaction that is rolled back; prints names, true/false and counts only; refuses a non-local host unless `MIGRATION_VERIFY_REMOTE_CONFIRM` equals the host; never prints a connection string). It reports, per migration: history (recorded or not, checksum match), objects (all, none, or partial), drift, and preconditions.

Obtain the owner URL (`DATABASE_ADMIN_URL`, the role that owns the schema) from the password manager. Do not use the `cg_app` URL: it cannot read `schema_migrations`.

```zsh
cd ~/vsc/genie-works/packages/db && (
  set -e
  read -rs "DATABASE_ADMIN_URL?Paste production OWNER DATABASE_ADMIN_URL, then Enter: "; echo; export DATABASE_ADMIN_URL
  export MIGRATION_VERIFY_REMOTE_CONFIRM="$(node -e 'console.log(new URL(process.env.DATABASE_ADMIN_URL).hostname)')"
  echo "--- TARGET (no connection yet) ---"
  npx tsx -e "import('./src/database-environment.ts').then((m)=>{const u=new URL(process.env.DATABASE_ADMIN_URL);console.log(JSON.stringify({place:m.databasePlace(process.env.DATABASE_ADMIN_URL),user:decodeURIComponent(u.username),database:u.pathname.slice(1)}))})"
  read -r "OK?Proceed only if place=production. Type YES to run the read-only verification: "
  [ "$OK" = "YES" ] || { echo Aborted; exit 1; }
  umask 077
  npx tsx scripts/migration-verify.ts 2>/dev/null | sed -n '/^{/,$p' > ~/health-check/migration-verify.json
  echo "--- LEAK CHECK ---"; grep -n -E 'postgres(ql)?://|neon\.tech' ~/health-check/migration-verify.json || echo clean
  echo "--- DONE ---"
)
```

Also run the repository's own read-only status in the same way (compares the checksums of all 48 files with the history and lists pending, modified and unknown entries): `npm run db:migrate:status -w @clinic-genie/db` with `DATABASE_ADMIN_URL` set for that one command.

### 10.4 How to read the result

| Result | Meaning | Action |
|---|---|---|
| 0044 to 0047: `not recorded`, `none`, `consistent (pending)` | Genuinely not applied | Apply in order (below) |
| `recorded` and `all` and `consistent (applied)` | The schema inspection was misleading (for example a different schema name) | Do not re-apply. Re-check the health script's assumptions |
| `DRIFT: objects exist but the migration is not recorded` | Applied by hand | Stop. Decide with the owner whether to record it. Never re-run the file |
| `DRIFT: partly applied` or `recorded ... but its objects are missing` | Schema damaged or changed by hand | Stop. Restore-point comparison first |
| `CHECKSUM DIFFERS` | A file was edited after being applied | Stop. Do not run `db:migrate` (it refuses) |
| `connectionsWithMoreThanOneLeasedJob` is not 0 | 0046's unique index would fail | Reap those leases first (read-only count is shown; the health check already shows 1 leased job in total) |
| `preconditionsMet` false | A dependency is missing, so the file would fail | Stop. Find which earlier migration (0034 to 0043) is missing |

The verification script was tested locally: on a fully migrated database it reports every migration consistent and applied; on a scratch database migrated only to 0043 it reports 0044 to 0047 as consistent and pending; and on a scratch database where objects were planted without history, a policy was removed, and a bad checksum was recorded, it reported the unrecorded objects, the partial application and the checksum difference. The scratch database was dropped.

### 10.5 Migration order and rollback plan (apply only after 10.3 confirms)

Order, by filename, all through the existing guarded command in `docs/DEPLOYMENT.md` (restore point, `MIGRATE_PRODUCTION_CONFIRM`, `MIGRATE_BACKUP_REFERENCE`):
1. **Restore point first** (Neon), name and time recorded.
2. 0044 (copies bindings; the verification shows how many it will copy), then 0045, then 0046 (after the duplicate-lease check returns 0), then 0047.
3. `db:migrate:status`: `Pending: none`. Re-run 10.3: all four `consistent (applied)`.
4. Check the site: sign-in, a client page, Enquiries list, Forms page.
5. Only then deploy the new code (section 3.6).

Why this order is safe: the current production code works with the schema before and after (guarded for 0044; 0045 and 0046 and 0047 only add objects; the older code ignores added columns). Run 0044 and 0045 first because production code already expects them.

Rollback, in order of preference:
1. If a file fails, nothing is applied for that file (single transaction). Fix the cause; do not skip.
2. 0047: `ANALYTICS_RECORD_INVOCATIONS=off`, or its down file.
3. 0046: its down file, after the previous code is deployed.
4. 0044 and 0045: no down files exist. Both only add tables; if a rollback were needed, prefer restoring the restore point into a new branch and comparing. A manual `drop table` would be a decision for the owner after reviewing what was written since.

Nothing in section 10 was run against production. No owner credential was read.
