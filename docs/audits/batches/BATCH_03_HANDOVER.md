# Batch 03 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 03 — Demonstrate current-schema recovery |
| Date | 30 October 2026, Asia/Singapore |
| Starting SHA | `a7b27636501339c82e30a5f1a806daaa81fc520a` |
| Implementation SHA | `ba9d2b3eb34317c71ffa1422583b24e4799577af` |
| Branch | `main`, ahead of `origin/main` by the local commits from Batches 01, 02 and 03 |
| Evidence commit | The documentation commit whose parent is the implementation SHA. No push. |

Batch 02’s completion gate was confirmed from its handover. `137195f67e040e689b3ef967ce8de088b1399c1c` is an ancestor of the starting SHA. The rehearsal database still had only `clinic-genie`, `harbourview-dental`, `meridian-skin` and `northgate-physio` before this batch wrote to it. DEP-05 stays open and was not treated as a blocker.

## Environment aliases

| Alias | What it is |
| --- | --- |
| `local-db` | Embedded Postgres `127.0.0.1:54339`, database `clinic_genie`. Used for `npm test` only. `backup_runs` stayed 0. Not backed up, restored, reset or seeded. |
| `rehearsal-db` | Local database `clinic_genie_rehearsal`. Source of the backup and of the `backup_runs` rows. |
| `restore-db` | Local database `clinic_genie_rehearsal_restore_test`. Created by the restore test, checked, then dropped. |
| `rehearsal-app` | Next.js on `127.0.0.1:3402`, pointed at `rehearsal-db`. Stopped after the Admin check. |
| `app-dev` | The server on port 3400 and the remote application database. Not used. |

No remote application database was queried, seeded, migrated, backed up or restored.

## Files changed

Implementation commit, 11 files:

- `packages/db/src/backup.ts` copies `blog_activity` and compares it with its article and client. It leaves `sessions`, `verification_token` and `dev_magic_links` empty. `users` and `accounts` are still copied. The destination schema is migrated, migration-inserted rows are cleared, then the snapshot is loaded. Source and destination names are checked before any write.
- `packages/db/scripts/backup.ts`, `restore-test.ts` and `recovery-fixture.ts` refuse a shared, enquiry, remote or production source. The fixture adds the fictional `recovery-check` article and disposable sign-in rows.
- `packages/db/test/backup-coverage.test.ts` fails if a new migration table is neither copied nor explicitly excluded.
- `docs/14_MONITORING_RECOVERY_HANDOVER.md` records the commands, the session exclusion, the destination rule, and that schedule, retention and the named owner are still unset.
- The Admin backup notice states the same exclusion. `docs/ENVIRONMENT.md` and `.env.example` name `RECOVERY_ALLOWED_DB_PATTERN`.

The evidence commit also ignores JSON files under `backups/` subdirectories. The rehearsal export was not committed.

Applied SQL files were not edited. Git history was not rewritten.

Left untracked and unstaged:

- `.cursor/`
- `apps/platform/public/client-marks/`
- `audits/` (the original six reports)
- `backups/rehearsal/` (the local export)
- `docs/GENIE_WORKS_V1_STAFF_SOP.md`
- `docs/release-readiness/`
- `reports/page-speed-audit.md`

## Issues

| Result | Issues |
| --- | --- |
| Fixed and verified | GW-007. The isolated restore passed and the Admin page showed that passed row. |
| Unchanged | GW-001, GW-002, GW-003, GW-013 and GW-017 stay Fixed and verified. GW-004 and GW-015 stay Partially fixed. |
| Reproduced | GW-005, GW-006, GW-008, GW-009, GW-010, GW-011, GW-012, GW-014, GW-016. This batch did not work on them. |
| Blocked | DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06, DEP-07, DEP-08. DEP-05 still blocks closing GW-004. DEP-08 still blocks a named production rollback owner. |
| Unverified this batch | Playwright, a remote backup, and a restart of the server on port 3400. |

## Commands

| Command | Where | Exit |
| --- | --- | ---: |
| Backup coverage test | Working tree | 0 (3 tests) |
| `npm run recovery-fixture -w @clinic-genie/db` | `rehearsal-db` | 0 |
| `npm run backup -w @clinic-genie/db -- ../../backups/rehearsal` | `rehearsal-db` | 0 |
| First restore test, before the clear-and-load fix | `restore-db` | 1 |
| Restore test with the printed backup file and `--keep` | `restore-db` | 0 |
| `npm test` | `local-db` | 0 (86 database tests, 39 platform tests) |
| `npm run typecheck` | Working tree | 0 |
| `npm run lint` | Working tree | 0 (11 warnings, 0 errors) |
| Signed-in Admin pages | `rehearsal-app` | Backup page and status page showed the passed restore |

The first restore failed on `clients_slug_key` because migrations had already inserted the internal agency row. That attempt recorded `restore_test` / `failed`. The load now deletes those rows before inserting the snapshot. The later restore recorded `restore_test` / `passed`.

Integrity on the passed restore:

- Client slugs on the source and destination: `clinic-genie`, `harbourview-dental`, `meridian-skin`, `northgate-physio`.
- Blog row `recovery-check`, activity `saved`, version 1, same client on both databases. Activity without an article: 0. Client mismatch: 0.
- Copied counts included clients 4, websites 4, tasks 14, staff 6, `blog_articles` 1, `blog_activity` 1, `blog_article_versions` 1.
- Orphan checks: 0. Migrations: 35 and matched. RLS enabled.
- Specialists saw 11 and 3 of 14 tasks.
- Destination sign-in tables: sessions 0, verification tokens 0, development magic links 0. The source still had its disposable rows, and the later Admin sign-in added a source session for `admin@example.invalid`.
- Non-fictional contact emails on the destination: 0.
- `clinic_genie` `backup_runs`: 0.

The Admin backup table’s latest row was Restore test, Passed, target `clinic_genie_rehearsal_restore_test`, with `blog_activity` 1 in the record list and a note that the three sign-in tables were left empty. The status page said Last backup passed and Last restore test passed. The earlier failed row was still listed under the passed row. `restore-db` was then dropped. `rehearsal-app` was stopped.

## Decisions still required

| Input | Role | Smallest next action |
| --- | --- | --- |
| DEP-05 history treatment for the directory migrations | Repository owner | Record leave-in-history or an authorised rewrite outside this pack in `docs/DECISIONS.md`. Do not rewrite history here. |
| DEP-08 named rollback owner | Release owner | Name the person and the rollback path. The local procedure is already written. Do not invent retention or a schedule. |
| DEP-06 report states | Product owner | Choose D14’s four states or accept `draft` / `saved`. |
| DEP-01, DEP-02, DEP-03, DEP-07 | Provider, enquiry and website owners | Name the non-production targets. |
| DEP-04 | Hosting owner | Name the staging project. |

## Next batch

`docs/release-readiness/04_ANALYTICS_SYNC.md`

Batch 03’s completion gate is met. Batch 04 can start. Its live provider check stays blocked on DEP-01 until a non-production property is named. This session stops here.
