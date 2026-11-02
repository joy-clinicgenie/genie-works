# Genie Works V1 bug register

Audit date: 30 October 2026. Working tree on `main` at `359502ce015d5b0555609a5311ff969b7c806a74`.

No application code was changed to fix these items. The only database write performed for the audit was applying five already-committed migrations to the local embedded database so Vitest could run. The shared Neon database was queried read-only.

Clinic names, emails, phone numbers, tokens and connection strings are intentionally omitted.

## P1

### GW-001 — Production build does not succeed

| Field | Detail |
| --- | --- |
| Module | Release |
| Severity | P1 |
| Expected | `npm run build` produces a deployable Next.js app. |
| Actual | Build compiles, then TypeScript fails: `Link` is imported and never used in `apps/platform/src/components/modules/blog/BlogWorkflow.tsx` line 5. Exit code 1. `npm run typecheck` fails on the same line. |
| Steps | From the repository root, run `npm run build`. |
| File | `apps/platform/src/components/modules/blog/BlogWorkflow.tsx` |
| Evidence | Build log 30 Oct 2026: “Failed to type check.” |
| Recommended fix | Remove the unused import. Re-run typecheck and build. |
| Effort | Under 30 minutes. |
| Retest | `npm run typecheck` and `npm run build` both exit 0. |

### GW-002 — The tested application is not the git revision

| Field | Detail |
| --- | --- |
| Module | Release |
| Severity | P1 |
| Expected | The commit proposed for pilot is the tree that was audited. |
| Actual | `HEAD` dashboard still imports `LaunchDashboard` and reads `report_snapshots`. The working tree deletes that component and serves the D21 command centre from untracked `AgencyOverview.tsx`. `git status` shows a large dirty tree, including `docs/DECISIONS.md` D21. |
| Steps | `git show HEAD:apps/platform/src/app/(app)/page.tsx` and compare with the file on disk. Open `/` on the dev server. |
| File | `apps/platform/src/app/(app)/page.tsx` |
| Evidence | `git diff --stat` and the signed-in page title “Agency Overview”. |
| Recommended fix | Commit the intended tree after GW-001, or revert the server to `HEAD` and audit that revision instead. Do not deploy a mix of the two. |
| Effort | Half a day, including a clean status check. |
| Retest | `git status` clean. A fresh checkout of that commit renders the same home page. |

### GW-003 — Debug ingest calls run on signed-in requests and in the browser

| Field | Detail |
| --- | --- |
| Module | Security |
| Severity | P1 |
| Expected | No debug telemetry in the request path. Ticket V1-I11 had treated removal as done. |
| Actual | `fetch` to `http://127.0.0.1:7835/ingest/...` with session id `f8030a`, `runId: "pre-fix"`, path, timings, client counts and `NODE_ENV`. Failures are swallowed. The browser copy runs from the shell on navigation. |
| Steps | Search the repo for `127.0.0.1:7835`. |
| Files | `apps/platform/src/app/(app)/layout.tsx`, `apps/platform/src/lib/session.ts`, `apps/platform/src/components/shell/Shell.tsx`, `packages/db/src/client.ts` |
| Evidence | Those calls are inside `// #region agent log` blocks. Lint reports `Date.now` in the layout as 5 of the 6 errors. |
| Recommended fix | Delete the region blocks. Keep the home-page test that forbids this host in `page.tsx`, and extend it to these four files. |
| Effort | About 1 hour, plus lint. |
| Retest | Repository search finds no `7835` ingest. Lint no longer reports those `Date.now` calls. A signed-in navigation does not request that host. |

### GW-004 — Migrations store a real clinic directory

| Field | Detail |
| --- | --- |
| Module | Privacy / Client Management |
| Severity | P1 |
| Expected | Seed and migrations stay fictional, per `README.md` and `CLAUDE.md`. |
| Actual | `0031_clinic_websites.sql` and `0034_client_public_profiles.sql` update clients by slug with published addresses and, in `0034`, contact email, phone and services. Both the local database and the shared database contain 15 client slugs outside the three fictional seed slugs (`harbourview-dental`, `meridian-skin`, `northgate-physio`). Staff count on the shared database is 8, of which 6 use `@example.invalid`. |
| Steps | Read those two migration files. Count clients whose slug is not one of the three fictional slugs. Do not print the contact values. |
| Files | `packages/db/migrations/0031_clinic_websites.sql`, `packages/db/migrations/0034_client_public_profiles.sql` |
| Evidence | Read-only aggregate: 18 clients, 3 fictional slugs, 15 others, 15 active. |
| Recommended fix | Remove directory backfill from migrations. Load real profiles only through a private, approved process. Review git history before a public or contractor clone. |
| Effort | About half a day, plus a history decision. |
| Retest | A fresh database migrated from this repo contains only fictional clients unless a separate approved import is run. |

### GW-005 — Analytics connections are not being synchronised

| Field | Detail |
| --- | --- |
| Module | Website Analytics |
| Severity | P1 |
| Expected | Connected properties show a last successful sync, or a safe error. GA4 and Wix are not added together. |
| Actual | Connections: GA4 1 connected, GSC 10 connected and 1 disconnected, Wix 1 connected. Jobs: 1 succeeded, 3 cancelled, 36 queued. Sync runs: 1 succeeded at 2026-10-30 05:36 UTC. Partitions: 1 `api`. Metric values: 2. `vercel.json` has no cron. The home page correctly says “Not yet synchronised” and labels the chart illustrative. |
| Steps | Read `analytics_jobs` grouped by `state`, and open `/`. |
| Files | `apps/platform/src/app/api/internal/analytics/worker/route.ts`, `vercel.json`, `packages/db/src/analytics/sync.ts` |
| Evidence | Read-only SQL above. Worker without a bearer returned 401. |
| Recommended fix | Schedule the authenticated worker. Surface queued and failed jobs. Confirm one successful GA4 or Wix window and one GSC window on a non-production property before calling data live. |
| Effort | 1–2 days, plus provider verification. |
| Retest | Queue depth falls. A known fixture day matches the provider. The home total is either a real figure with a sync time, or still an explicit blank. |

### GW-006 — Leads cannot run in the current environment

| Field | Detail |
| --- | --- |
| Module | Leads and Forms |
| Severity | P1 |
| Expected | Staff see stored enquiry totals and notification state from the clinic-website database, without a second copy of the message. |
| Actual | `ENQUIRY_DATABASE_URL` is empty. `/` and the enquiries screens say the enquiry database is not connected. Counts are an em dash. |
| Steps | Sign in and open `/` and `/enquiries`. |
| Files | `apps/platform/src/lib/form-submissions.ts`, `.env.example` |
| Evidence | Browser text: “The enquiry database is not connected.” “Connection required. Counts are stored submissions, not clicks or bookings.” |
| Recommended fix | Connect the local `clinic_genie_enquiry_test` database for a pilot rehearsal. Do not point this variable at a production patient database for the rehearsal. |
| Effort | About 2 hours for the fixture. A real clinic mailbox is a separate approval. |
| Retest | Totals match the fixture. A failed outbox row leaves the enquiry in place. Export as read-only returns 403. |

### GW-007 — No backup or restore evidence for this schema

| Field | Detail |
| --- | --- |
| Module | Admin / Operations |
| Severity | P1 |
| Expected | Admin shows a successful backup and an isolated restore of the current schema. |
| Actual | `backup_runs` on the connected database returned no rows. This audit did not run `db:backup` or `db:restore-test`. The 19 October acceptance note is older than migrations 0007–0034. Tracker item V1-V03 is still blocked. The exporter also omits `blog_activity` and Auth.js session tables. |
| Steps | `select kind, outcome, count(*) from backup_runs group by 1, 2` on the app database. |
| Files | `packages/db/src/backup.ts`, `apps/platform/src/app/(app)/admin/backups/page.tsx` |
| Evidence | Read-only query returned an empty set. |
| Recommended fix | Run backup and `db:restore-test` against the local fictional database after GW-004. Record the run. Add the missing blog tables to the export list. Do not restore over the shared database. |
| Effort | Half a day. |
| Retest | Admin shows a `restore_test` outcome of success, with blog rows included in the count check. |

## P2

### GW-008 — Report workflow does not use the D14 states

| Field | Detail |
| --- | --- |
| Module | Reports |
| Severity | P2 |
| Expected | D14: Draft, In review, Approved, Final, with a new version for a correction. |
| Actual | `0033_report_builder.sql` allows only `draft` and `saved`. “Save for review” stores a version but does not create an approval or a final file. The connected library is empty. |
| Steps | Read the status check in migration 0033. Open `/reports`. |
| File | `packages/db/migrations/0033_report_builder.sql`, `packages/db/src/services/saved-reports.ts` |
| Evidence | Home page “Reports in progress 0”. SQL status group query returned no rows. |
| Recommended fix | Either implement the four states or record a decision that `draft` / `saved` is the accepted V1 workflow. |
| Effort | 2–3 days if the four states are required. |
| Retest | A report can be drafted, reviewed, approved and opened later as the same final version. A specialist cannot approve it. |

### GW-009 — Demo seed is not idempotent

| Field | Detail |
| --- | --- |
| Module | Operations |
| Severity | P2 |
| Expected | `npm run db:seed` can be repeated. |
| Actual | On the local database, seed failed with `report_snapshots_current_idx` duplicate key for a `ga4_export` sessions row. |
| Steps | With `DATABASE_URL` pointed at local `clinic_genie`, run `npm run db:seed`. |
| File | `packages/db/src/seed.ts` (`ensurePreviewSnapshots`) |
| Evidence | Postgres `23505` on 30 Oct 2026. |
| Recommended fix | Insert snapshots with `on conflict` matching the unique index, or skip existing preview rows. |
| Effort | About 2 hours. |
| Retest | Two consecutive seeds exit 0 and do not duplicate snapshot rows. |

### GW-010 — Two migrations share the number 0034

| Field | Detail |
| --- | --- |
| Module | Database |
| Severity | P2 |
| Expected | One ordered filename per migration. |
| Actual | `0034_client_public_profiles.sql` and `0034_leads_forms.sql` both exist. The runner sorts by name, so both applied. A later tool that assumes unique numbers can skip one. |
| Steps | List `packages/db/migrations`. |
| File | `packages/db/src/migrate.ts` |
| Evidence | Local `schema_migrations` contains both names. Shared database latest names include both. |
| Recommended fix | Leave applied files untouched. Add a note in the migration runner docs. Do not renumber an applied file. |
| Effort | 1 hour of documentation. A renumber is unsafe. |
| Retest | A fresh migrate applies both files once. |

### GW-011 — Managers can store connection credentials

| Field | Detail |
| --- | --- |
| Module | Settings / Security |
| Severity | P2 |
| Expected | D14: connection credentials stay admin-only. |
| Actual | Settings and bind actions use `canManageRegistry`, which is admin or manager. |
| Steps | Read `canManageRegistry` and `apps/platform/src/app/actions/analytics.ts`. |
| Files | `packages/db/src/services/auth.ts`, `apps/platform/src/app/(app)/settings/page.tsx` |
| Evidence | Code inspection. A manager session was not used to bind a property. |
| Recommended fix | Gate secret writes with `canManageUsers`, or change D14 if managers should connect properties. |
| Effort | Half a day, including a permission test. |
| Retest | Manager bind is denied. Admin bind still works. Secrets remain unreadable under the staff role. |

### GW-012 — Narrow header collides

| Field | Detail |
| --- | --- |
| Module | UI |
| Severity | P2 |
| Expected | At 390px, search, Reports, the environment label and Add remain readable and do not overlap. |
| Actual | At `innerWidth` 390 the top bar clipped “Reports” and overlapped the environment label and the round add button. Document `scrollWidth` stayed 390, so this is overlap, not a sideways scroll. Desktop at 1440 showed the full sidebar. |
| Steps | Set a 390×844 viewport, signed in, and open `/`. |
| File | `apps/platform/src/components/shell/TopBar.tsx`, `Shell.tsx` |
| Evidence | Phone screenshot on 30 Oct 2026. `scrollWidth` 390 equals `innerWidth`. |
| Recommended fix | Collapse secondary top-bar actions below the `lg` breakpoint. |
| Effort | About 2 hours. |
| Retest | 390px and 768px screenshots show every control in full, with visible focus. |

### GW-013 — Development sign-in is enabled against the shared database

| Field | Detail |
| --- | --- |
| Module | Security |
| Severity | P2 |
| Expected | Magic links and automatic admin creation stay off for any shared database. |
| Actual | `AUTH_DEV_MAGIC_LINKS` is true. `/dev/magic-links` returned HTTP 200 without a session. The dev server is `next dev`, so the production guard is not in force. Non-production Google sign-in can create an admin for `AUTH_GOOGLE_HD` when no staff row exists (`auth.ts`). Google client variables are set. |
| Steps | `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3400/dev/magic-links` |
| Files | `apps/platform/src/app/dev/magic-links/page.tsx`, `apps/platform/src/lib/auth.ts` |
| Evidence | HTTP 200. Code lines 45–54 create `role: "admin"` only when `NODE_ENV !== "production"`. |
| Recommended fix | Use magic links only with the local fictional database. Confirm both flags are unset on any deployed environment. |
| Effort | Configuration, under 1 hour once the database target is agreed. |
| Retest | Against the shared database, `/dev/magic-links` is 404. A new Google user is denied until an admin creates the staff row. |

## P3

### GW-014 — Desktop home page has two level-1 headings

| Field | Detail |
| --- | --- |
| Module | Accessibility |
| Severity | P3 |
| Expected | One `h1` for the page. |
| Actual | Desktop snapshot included “Hey Demo Admin…” and “Agency Overview”, both `h1`. |
| File | `apps/platform/src/components/shell/TopBar.tsx`, `AgencyOverview.tsx` |
| Evidence | Accessibility snapshot at 1440px. |
| Recommended fix | Make the greeting a `p`. |
| Effort | Under 1 hour. |
| Retest | One `h1` per module page. |

### GW-015 — Lint warnings on links and images

| Field | Detail |
| --- | --- |
| Module | Code quality |
| Severity | P3 |
| Expected | Lint exits 0, or warnings are accepted in writing. |
| Actual | 11 warnings: raw `<a>` on legacy new-pages, `<img>` on sign-in, shell and client marks, anonymous default export in the ESLint config. |
| Evidence | `npm run lint` on 30 Oct 2026. |
| Recommended fix | Switch those anchors to `Link`. Keep `<img>` only where `next/image` is a poor fit, with a short comment. |
| Effort | About 2 hours. |
| Retest | `npm run lint` exits 0. |

### GW-016 — README and build status describe an older product

| Field | Detail |
| --- | --- |
| Module | Documentation |
| Severity | P3 |
| Expected | A new engineer can see V1 modules, enquiry and analytics variables, and migrations through 0034. |
| Actual | `docs/BUILD_STATUS.md` still says 19 Oct 2026, migrations 0001–0006, and ten modules. `README.md` environment list omits `ENQUIRY_DATABASE_URL` and `ANALYTICS_*`. The 28 October tracker still says Blog was blank and Leads/Reports were not started. |
| Evidence | Those files compared with the tree. |
| Recommended fix | Replace the status page with a short pointer to D14–D21 and this audit. |
| Effort | Half a day. |
| Retest | A reader can start the app and name the nine V1 modules without opening the tracker. |

### GW-017 — Decision-record test DAY-01 fails

| Field | Detail |
| --- | --- |
| Module | Tests |
| Severity | P3 |
| Expected | Known historical failure, documented. |
| Actual | `npm run test:decisions`: 7 pass, 1 fail. `tests/day-01-scope-audit.test.mjs` expects a filename prefix that is not on disk. |
| Evidence | Command output 30 Oct 2026. `docs/BUILD_STATUS.md` already says this failure is by design. |
| Recommended fix | Retire or rewrite DAY-01 so `test:decisions` is green, without weakening CG-01. |
| Effort | About 1 hour. |
| Retest | `npm run test:decisions` exits 0. |

## Explicitly not filed

- Wix blog publishing, blog performance, form builder, password login, alert preferences, SEO crawler, GBP API and NLWeb. Decisions defer or exclude them.
- Contact clicks versus enquiries. The home page and report tests keep them separate.
- Specialist website edits reporting success. Current RLS and `updateWebsite` throw if no row is updated, and the permission test passed.
