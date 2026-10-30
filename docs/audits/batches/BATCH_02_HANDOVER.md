# Batch 02 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 02 — Create the fictional rehearsal environment |
| Date | 30 October 2026, Asia/Singapore |
| Starting SHA | `fad5d9726496bdd071aae3aaff2ccd02b5aa59f5` |
| Implementation SHA | `137195f67e040e689b3ef967ce8de088b1399c1c` |
| Branch | `main`, ahead of `origin/main` by the local commits from Batches 01 and 02 |
| Evidence commit | The documentation commit whose parent is the implementation SHA. No push. |

Batch 01’s completion gate was confirmed from its handover and from git. `2ff49401703730a43dd6c4127cee95c319575d1f` is an ancestor of the starting SHA. This batch did not repeat that audit.

## Environment aliases

| Alias | What it is |
| --- | --- |
| `local-db` | Embedded Postgres `127.0.0.1:54339`, database `clinic_genie`. Used for `npm test` and a read-only checksum compare. Not reset, seeded or migrated. |
| `rehearsal-db` | Local database `clinic_genie_rehearsal` on the same server. Created, migrated, stripped and seeded by `npm run db:rehearse`. |
| `enquiry-fixture` | Local database `clinic_genie_enquiry_test`, created by the rehearsal script. It holds the three fictional clinics only. |
| `app-dev` | The existing server on port 3400 and the remote application database. Not used. |

No remote application database was queried, seeded, migrated or restored. `ENQUIRY_DATABASE_URL` was empty for these commands. `enquiry:link` was not run.

## Files changed

Implementation commit, 21 files:

- `packages/db/src/rehearsal.ts` and `packages/db/scripts/rehearse.ts` create the fictional rehearsal database and the enquiry fixture. Fresh setup deletes imported directory clients only when that run applies `0001_foundation.sql`.
- `packages/db/src/migrate.ts`, `packages/db/src/testing/targets.ts` and the seed, reset, restore, load-seed and migrate scripts refuse a production environment, port 54329, and a remote destructive target. Migration of a remote host needs `MIGRATE_ALLOW_REMOTE=1`, which production still refuses. Logs name local or remote, the port and the database name.
- `apps/platform/src/lib/runtime-policy.ts`, `auth.ts`, the sign-in page and `/dev/magic-links` keep magic links and automatic Google admin creation off unless the database is local and the process is not production or Vercel preview. Existing staff can still sign in. Google remains available when its client id and secret are set.
- `assertRuntimeAuthSecret` rejects an empty `AUTH_SECRET` and the placeholders `preview-build-only` and `replace-with-a-long-random-string`, except while `NEXT_PHASE` is `phase-production-build`.
- `docs/ENVIRONMENT.md` and the comments in `.env.example` name local, staging and production variables. No values were added.

Applied SQL files were not edited, renumbered or deleted. No shared rows were deleted.

Left untracked and unstaged:

- `.cursor/`
- `apps/platform/public/client-marks/`
- `audits/` (the original six reports)
- `docs/GENIE_WORKS_V1_STAFF_SOP.md`
- `docs/release-readiness/`
- `reports/page-speed-audit.md`

## Issues

| Result | Issues |
| --- | --- |
| Fixed and verified | GW-013. Shared-database magic links and automatic admin creation are denied. An existing staff sign-in stays allowed. Runtime placeholder secrets fail. |
| Partially fixed | GW-004. Fresh `clinic_genie_rehearsal` contains only `clinic-genie`, `harbourview-dental`, `meridian-skin` and `northgate-physio`. Historical directory SQL remains in git. |
| Unchanged from Batch 01 | GW-001, GW-002, GW-003 and GW-017 stay Fixed and verified. GW-015 stays Partially fixed, with the same 11 lint warnings. |
| Reproduced | GW-005, GW-006, GW-007, GW-008, GW-009, GW-010, GW-011, GW-012, GW-014, GW-016. This batch did not work on them. |
| Blocked | DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06, DEP-07, DEP-08. DEP-05 still blocks closing GW-004. |
| Unverified this batch | Playwright, backup, restore, a remote migration, and a restart of the server on port 3400. |

## Commands

| Command | Where | Exit |
| --- | --- | ---: |
| `npm run db:rehearse` | `rehearsal-db` and `enquiry-fixture` | 0 |
| Read-only checksum compare | `local-db` `schema_migrations` | 0 |
| `npm run db:migrate` | `rehearsal-db` after the rehearsal | 0 |
| `npm test` | `local-db` | 0 |
| `npm run typecheck` | Working tree | 0 |
| `npm run lint` | Working tree | 0 (11 warnings, 0 errors) |

Rehearsal evidence: 35 migrations applied, 14 imported directory clients removed, checksums matched 35 files, seed reported 6 staff and 3 clients. Remaining slugs were `clinic-genie`, `harbourview-dental`, `meridian-skin`, `northgate-physio`. Non-fictional contact emails: 0. Non-fictional website hosts: 0. Enquiry fixture: `clinic_genie_enquiry_test`, the three fictional clinics, 6 synthetic enquiries, 6 notifications.

The later migrate on `rehearsal-db` applied 0 migrations and skipped 35. It did not print a fresh-setup removal. The same four slugs remained.

`local-db` had 35 applied migration rows and 35 matching checksums. The read-only transaction was rolled back.

`npm test`: database package 16 files, 83 tests; platform 8 files, 39 tests. The new tests cover remote and production migration refusal, the fresh-setup strip condition, the three directory-file checksums, shared-database magic links, unknown Google users, and placeholder `AUTH_SECRET` values. A remote migrate command was not executed.

## Decisions still required

| Input | Role | Smallest next action |
| --- | --- | --- |
| DEP-05 history treatment for the directory migrations | Repository owner | Record leave-in-history or an authorised rewrite outside this pack in `docs/DECISIONS.md`. The fresh-setup strip is already in place. Do not rewrite history here. |
| DEP-06 report states | Product owner | Choose D14’s four states or accept `draft` / `saved`. |
| DEP-01, DEP-02, DEP-03, DEP-07 | Provider, enquiry and website owners | Name the non-production targets. The local enquiry fixture exists and does not close the live gate. |
| DEP-04, DEP-08 | Hosting and release owners | Name the staging project and rollback owner. |

Proposed treatment for DEP-05, not approved: leave the applied SQL files unchanged; strip imported directory clients only when a run applies `0001_foundation.sql`; clear directory contact fields on the internal `clinic-genie` row in that same fresh run; do not delete rows from an existing database. No D22 was added.

## Next batch

`docs/release-readiness/03_BACKUP_AND_RESTORE.md`

Batch 02’s completion gate is met. Fresh setup is fictional, shared-database sign-in shortcuts are denied, unknown Google users are not created as admins, runtime secrets fail closed, and applied migration history remains valid. DEP-05 stays open and does not block Batch 03. Batch 03 can start. This session stops here.
