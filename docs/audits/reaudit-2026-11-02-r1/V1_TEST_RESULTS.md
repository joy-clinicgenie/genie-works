# Genie Works V1 re-audit test evidence

## Candidate and environment

HEAD `29bdb1564bad4d5483ba5ae7aa76deb5a87404bd` on `main`. The tested behaviour is the uncommitted source tree `db10022b0de6f78c1a747b59ef29535ce2a4d4ac` in the detached worktree `/Users/joystyle/vsc/clinic-genie-reaudit-20261102-r1`. `.env` and `node_modules` are not part of that hash. No branch and no commit were created for the snapshot.

Runtime: Node v24.15.0, npm 12.2.1, Next.js 16.4.2, Vitest 4.1.12, Playwright 1.64.1. Lockfile SHA-256 `14853308e5f98f6a02eedf1d16eaaecdcaac9d17bb4442e8761fd8597efbc2d9`. `npm ci --ignore-scripts` installed 428 packages. The lockfile was not changed.

Audit environment aliases, values withheld: local owner and application URLs on `127.0.0.1:54339` for `clinic_genie_reaudit_rehearsal`. `ENQUIRY_DATABASE_URL` empty. Analytics live reports, fixture mode and the remote worker flag empty. Provider, Google, Wix and Resend keys empty. `APP_ENVIRONMENT_LABEL=reaudit-local`. `AUTH_DEV_MAGIC_LINKS=true` on the local development server only. `AUTH_URL` was overridden per process to `http://127.0.0.1:3408` and `http://127.0.0.1:3409`.

The workspace environment was not used by the audit servers. Its application database alias is remote `neondb`. Its enquiry alias is local `clinic_genie_enquiry_test`. `ANALYTICS_LIVE_REPORTS` is true and `ANALYTICS_ALLOW_REMOTE_WORKER` is 1 there. Those values were not copied.

Guards left in place: the enquiry reset throws before a schema drop when any public reference is not `TEST-%`. Production mode refuses the fixture before a pool is opened. Recovery refuses `clinic_genie`, `neondb`, `postgres`, any name containing `enquiry`, and any name ending `_restore_test`. The audit rehearsal name contains `rehearsal`, so recovery was allowed. The production fixture guard was not weakened.

Schema on the fresh journey database: 38 migrations, including both files numbered 0034, then 0035, 0036 and 0037. Fresh setup removed 14 imported directory clients. Seed wrote 6 staff, 1 client and 4 tasks, then the journey prepare set Meridian active. Websites stayed `enquiry_source=database` with a null `enquiry_key`. The journey enquiry database held 6 enquiries and 6 notifications, all fixture references.

No test file was added only in the worktree. No assertion was edited. The first `node_modules` symlink was replaced by `npm ci` because Turbopack refused a link outside the worktree root. That is an install change, not a product diff.

| Command or check | Environment | Exit or result | Passed / failed / skipped | Evidence |
| --- | --- | --- | --- | --- |
| `npm run typecheck` | Worktree | 0 | Contracts, db and platform completed. No error printed. | `audit-logs/typecheck.log` |
| `npm run lint` | Worktree | 0 | `eslint .` in `apps/platform`. No warning printed. | `audit-logs/lint.log` |
| `npm run test:decisions` | Worktree | 0 | 8 passed, 0 failed | `audit-logs/decisions.log` |
| `npm test` | Worktree, local audit database | 1 | DB: 5 failed, 98 passed, 103 tests, 4 files failed, 18 passed. Platform: 1 failed, 56 passed, 57 tests, 1 file failed, 11 passed. Combined 6 failed, 154 passed, 160 tests. | `audit-logs/test.log`, started 01:26 local |
| `npm run build` after `npm ci` | Worktree | 0 | Next.js 16.4.2 compiled, typecheck finished, 8 static pages generated. | `audit-logs/build.log` |
| First `npm run build` | Worktree with `node_modules` symlinked outside the root | 1 | Turbopack could not resolve `next/package.json`. Not a product type error. | Replaced by the `npm ci` build above |
| `npm audit --omit=dev` | Worktree | 0 | 0 vulnerabilities | `audit-logs/audit-prod.log` |
| `npm audit` | Worktree, including development dependencies | 1 | 16 moderate findings in development tooling. `npm audit fix` was not run. | `audit-logs/audit-full.log` |
| `e2e-batch08/prepare.mts` | Created only `clinic_genie_b08` and `clinic_genie_enquiry_test_b08` | 0 | 38 migrations, 14 directory clients removed, seed 6/1/4, 6 fixture enquiries | `audit-logs/e2e-prepare.log` |
| Playwright, first launch | Chromium missing in the sandbox cache | 1 | 16 failed before a page opened. Not a journey result. | Executable path ended `chrome-headless-shell` |
| `npx playwright install chromium` | Worktree | 0 | Launch check printed `LAUNCH_OK` | Install did not change the lockfile |
| Playwright, second launch | `playwright.batch08.config.ts`, base URL `http://127.0.0.1:3408` | 1 | 14 passed, 2 failed, 33.3s, 1 worker | `audit-logs/playwright.log` |
| `npm run db:migrate` and `npm run db:seed` | `clinic_genie_reaudit_rehearsal` | 0 | Same 38-migration fresh setup | Command output |
| `npm run db:recovery-fixture` | Same source | 0 | `articles` 1, `activity` 1, disposable sign-in rows 1 each | Command output |
| Fictional follow-up insert | Same source, after the website was set to a Wix shape with synthetic ids | 0 | `follow_ups=1`, `recovery_articles=1` | Command output |
| `npm run db:backup -- audit-logs/backup` | Resolved under `packages/db/audit-logs/backup` | 0 | 64 table counts. `enquiry_follow_ups` absent. `blog_activity` present. 38 migrations. | Backup basename `backup-2026-11-01T17-30-17-011Z.json`. The file is not a deliverable. |
| `npx tsx packages/db/scripts/restore-test.ts <file> --keep` | Destination `clinic_genie_reaudit_rehearsal_restore_test` | 0 | Printed `Restore test PASSED`. Follow-up count stayed 0 on the destination. | Command output below |
| `npm run db:restore-test -- <file> --keep` | Not used as the result | Known npm argument loss | The October retest already recorded that npm consumes `--keep`. The tsx command is the result. | Not re-run |
| Form-submissions recheck with the audit environment loaded | Same Vitest file, one test name | 1 | Refused the shared fixture reset. 11 tests skipped by the name filter. | `audit-logs/form-recheck.log` |
| Saved-report file round trip | Worktree `docs/report`, then deleted | Script result | Draft rejected. First write created the file. Repeat write returned `created: false` and the original name stayed. Bytes matched after copy, delete and restore. | Not attached |
| Browser report save | Journey database, then one JSON file in the worktree | Passed inside the 14 | Status moved from `draft` to `saved`. One `v1` file. No `v2`. | File not attached |

Domain failures, exact names:

- `analytics tenant isolation and sync > keeps fixture sessions inside one website and replaces a repeat without adding the previous value`. `TypeError: Cannot read properties of undefined (reading 'id')` at `analytics-sync.test.ts:367`. The internal client has no website.
- `backup coverage > classifies every table created by a migration`. Received list contains `enquiry_follow_ups`. Expected list does not.
- `synthetic enquiry fixture > resets labelled records and keeps a retry from creating another enquiry`. `Refusing enquiry fixture reset: stored enquiries are outside the fixture.`
- `synthetic enquiry fixture > persists follow-up transitions and lets one concurrent update win`. Same refusal.
- `Wix enquiry follow-up > stores status without the submission and keeps other clinics out`. `expected undefined to be truthy` for `enquiry_key = 'meridian-skin-production'`.

Platform official failure: `keeps demonstration rows out of production totals and exports` threw `DATABASE_ADMIN_URL is required for the enquiry fixture` because the official `npm test` shell had not loaded the audit environment. The recheck, with that variable set to the local audit owner URL, reached `Refusing enquiry fixture reset: stored enquiries are outside the fixture.` The shared fixture was not wiped.

Restore comparison, counts only:

| Database | Migrations | Clients | Follow-ups | Articles | Activity | Sessions | Tokens | Magic links |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `clinic_genie_reaudit_rehearsal` after backup | 38 | 2 | 1 | 1 | 1 | 1 | 1 | 1 |
| `clinic_genie_reaudit_rehearsal_restore_test` | 38 | 2 | 0 | 1 | 1 | 0 | 0 | 0 |

Both slugs were `clinic-genie` and `meridian-skin`. Restore script counts matched, orphans were 0, blog activity matched its article, migrations matched, RLS was enabled, and isolation was user A 4, user B 0, total 4. The script does not count `enquiry_follow_ups`, so `Restore test PASSED` does not cover that row. The source sign-in rows were still present because `--keep` restores into the other database.

## Browser matrix

Servers: production-mode `next start` on `127.0.0.1:3408`, development `next dev` on `127.0.0.1:3409`. Both used the journey databases. The existing `next dev` on port 3400 was not used. Screenshots and video were off. No personal submission and no secret value was captured.

| Role | Journey | Source | Allowed | Denied | Result | Mode |
| --- | --- | --- | --- | --- | --- | --- |
| Signed out | Production routes | None | Sign-in page | Development links | Passed | 3408 |
| Admin | Every fictional client and admin | Seed | Clients and admin | None in this journey | Passed | 3408 |
| Admin | Create, edit, archive | New fictional client | Those three | None | Passed | 3408 |
| Manager | Client creation | Seed | Opens creation | Admin and secret writes | Passed | 3408 |
| Specialist | Client creation | Seed | Assigned clients | Creation | Passed | 3408 |
| Specialist | Assigned scope | Meridian membership | Assigned client | Unassigned client | Passed | 3408 |
| Specialist | Export and secret routes | None configured | None | Both, before a provider call | Passed | 3408 |
| Reviewer | Assigned client | Meridian | Open | Create and admin | Passed | 3408 |
| Read-only | One client | None in the fresh seed | View where assigned | Mutations and export | Passed | 3408 |
| Admin | Deactivation | Seeded staff | Revokes the session | Continued use of the old session | Passed | 3408 |
| Specialist | Blog review and preview | Native blog | In-app review and protected preview | Public API without a token | Passed, including the token read | 3408 |
| Specialist | Report draft and saved | Fictional report | Draft, then Save for review | Approved and Final were absent | Passed | 3408 |
| Admin | Production enquiry fixture | `clinic_genie_enquiry_test_b08` | Refusal sentence | Any fixture reference | Passed | 3408 |
| Specialist A | Fixture status, retry and export | Same fixture, default month | Follow-up was not reached | The row was not on screen | Failed. `TEST-MS-NEW-004` not visible in 20s | 3409 |
| Admin | Header layout | `/clients` | 390 overflow 0, overlaps 0 | 768 overflow 289 | Failed at 768. 1440 was not reached by this test | 3408 |
| Admin | Keyboard and headings | Sign-in, home, clients, new client, new report | One `h1`, labels, 3px solid `rgb(19, 108, 114)` outline | None | Passed. The script printed `a11y` as `none`, meaning no extra finding from that check | 3408 |

Supplemental reads, not a replacement for the failed journey:

- Development, Specialist A, `from=2026-10-01&to=2026-10-31&q=TEST-MS-NEW-004`: visible 1. Summary: `1 matching enquiry` and the comparison leaves demonstration submissions out.
- Same account without the dates: visible 0. Summary: `0 matching enquiries`.
- Production `/enquiries`: no `TEST-MS` text. Export without a successful fixture: HTTP 503, body `The enquiry database target was refused. A Wix form is a separate connection.`
- Unsigned `/` and `/enquiries`: 307. `/dev/magic-links`: 404 on 3408, 200 on 3409. Blog and SEO public API without a token: 404. Worker GET and POST without a bearer: 401.
- Admin operations JSON on 3408: `deploymentClass` `local-rehearsal`, `runtimeProcess` `production`, enquiry fixture not permitted, database local, worker bearer missing, enquiry source refused, connections 0, queued 0, freshness `no-connections`, last success null, backup none. No secret value was in the body.

Server logs contained the expected `Operations status is limited to an administrator` denial. They did not contain an uncaught page crash or a call to `127.0.0.1:7835`.

## Integrations and operational evidence

| Check | Result |
| --- | --- |
| GA4, Search Console, Wix analytics | Not called. No property, site or date window is named in D25. The workspace credentials were not used. |
| Remote `neondb`, read only | 38 migrations. 17 clients, 2 of the known fictional slugs present, 15 other clients. Jobs: cancelled 3, queued 69, succeeded 1. The succeeded run finished `2026-10-29T21:36:36.497Z` and fetched 1 row. Oldest queued job `2026-10-29T17:48:02.889Z`. `backup_runs` empty. The queue was not drained. An earlier query used a column named `state` and failed with `42703`; the recorded query uses `result` and `finished_at`. Connection-status counts were not completed and are not invented. |
| Wix forms | Not called. Fresh websites have no binding. |
| Native fixture | 6 rows on the journey database. Shared `clinic_genie_enquiry_test` was left at 11 enquiries, 6 `TEST-` and 5 other synthetic prefixes, before and after the runs that touched it. |
| Mail | Nothing sent. D32 and D33 remain the historical acceptance and receipt of DEP03-8E4DC5 from `onboarding@resend.dev`. D35 remains acceptance of DEP03D-A72CDF from `hello@clinic-genie.com` without a receipt. Those records are not a new receipt and not production delivery proof. |
| Consumer website | No clinic website rendered an article or an SEO setting. |
| Schedule | `vercel.json` names a daily GET at 02:00 UTC. No hosted invocation was observed. No manual worker call was made. |
| Database restore | Passed for covered tables. Failed to carry `enquiry_follow_ups`. |
| Report artifact | Local file round trip passed. The file is not in the database backup. No hosted disk was tested. |

## Accessibility and performance

Playwright 1.64.1, Chromium, one desktop project. Routes in the keyboard journey: `/sign-in`, `/`, `/clients`, `/clients/new`, `/reports/new`. That journey checked a visible focus outline, one `h1` and labelled controls. It is a manual keyboard and label check.

No axe scan, no contrast measurement, no screen reader and no Lighthouse run. The word `a11y` in the log is the script’s own label. It is not an axe result and it is not a conformance claim.

Performance is five `fetch` samples from this machine to `127.0.0.1:3408` after the process was warm, signed in as admin. It is not a throttled device and not field Core Web Vitals.

| Route | Samples, milliseconds |
| --- | --- |
| `/` | 10.3, 11.2, 12.9, 33.1, 155.8 |
| `/clients` | 8, 8.5, 9.2, 10, 20.1 |
| `/enquiries` | 6.4 to 7.9 |
| `/reports` | 6.3 to 8.2 |
| `/seo` | 6.6 to 10.9 |
| `/settings` | 9.2 to 23.8 |
| `/admin` | 6.6 to 11.1 |

Unsigned `/sign-in` was about 4 to 5 ms after warm.

## Cleanup and not run

After these reports were written, the audit processes on `127.0.0.1:3408` and `127.0.0.1:3409` were stopped, including their launcher. The user’s `next dev` on port 3400, PIDs 31965 and 31966, was still listening. These databases were dropped: `clinic_genie_reaudit_rehearsal`, `clinic_genie_reaudit_rehearsal_restore_test`, `clinic_genie_b08`, `clinic_genie_enquiry_test_b08`. Left in place: `clinic_genie`, `clinic_genie_rehearsal`, `clinic_genie_enquiry_test`. The shared fixture still had 11 enquiries, 6 with a `TEST-` reference and 5 other synthetic rows. The backup JSON left with the worktree, which was removed. HEAD remained `29bdb1564bad4d5483ba5ae7aa76deb5a87404bd`. Nothing was committed. Port 54329 and `neondb` were not changed.

Not run, and not scored as passed:

- A clean checkout of a committed candidate. None exists for this tree.
- Any Google, Wix, Resend or inbox call.
- A successful Wix follow-up save.
- The November fixture journey’s follow-up, retry and export clicks.
- The 1440px step inside the official layout test. A separate measure on that width found page overflow 0.
- Hosted deployment, cron invocation, hosted report storage and a consumer clinic website.
- `npm audit fix`, a queue drain, a shared fixture reset, a seed of the remote database, and a history rewrite.
- Connection-status counts on `neondb`. The first query failed on a missing column and the follow-up was not completed.

Failed commands that remain failed: `npm test`, the second Playwright run, the form-submissions recheck, and the first build before `npm ci`. The first Playwright run is discarded because the browser never launched.
