# Batch 00 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 00 — Establish the baseline and classify the work |
| Date | 30 October 2026, Asia/Singapore |
| Starting SHA | `359502ce015d5b0555609a5311ff969b7c806a74` |
| Ending SHA | `359502ce015d5b0555609a5311ff969b7c806a74` |
| Branch | `main`, tracking `origin/main` |
| Implementation candidate | Not established. HEAD does not contain the running home page. |
| Tested checkout | Not a clean release checkout. Evidence below is from this dirty working tree plus read-only queries. |

No commit was made. Existing modified and untracked product files were left untouched. A task branch was not created: the uncommitted product work is already on `main`, and moving that pointer would not preserve a separate baseline.

## Environment aliases

| Alias | What it is |
| --- | --- |
| `app-dev` | Next.js development server, port 3400, `APP_ENVIRONMENT_LABEL=development`. Its database URL is a remote managed Postgres database named `neondb`. |
| `local-db` | Embedded Postgres `127.0.0.1:54339`, database `clinic_genie`. Not used for new writes in this batch. |
| Enquiry source | Unset. |

`AUTH_DEV_MAGIC_LINKS` is true. `ANALYTICS_LIVE_REPORTS` is true. `ANALYTICS_FIXTURE_MODE` is empty. Google OAuth variables are set. Values are not recorded.

## Files changed

Created:

- `docs/audits/V1_REMEDIATION_STATUS.md`
- `docs/audits/V1_DEPENDENCIES.md`
- `docs/audits/batches/BATCH_00_HANDOVER.md`

No application, migration, test or original audit file was edited. The six audit reports remain in `audits/`.

## Issues

Addressed means classified with current evidence, not fixed.

| Result | Issues |
| --- | --- |
| Fixed and verified | None |
| Partially fixed | None |
| Reproduced | GW-001, GW-002, GW-003, GW-004, GW-005, GW-006, GW-007, GW-008, GW-009, GW-010, GW-011, GW-012, GW-013, GW-014, GW-015, GW-016, GW-017 |
| Blocked | DEP-05 blocks closing GW-004. DEP-01, DEP-02, DEP-03, DEP-04, DEP-06, DEP-07 and DEP-08 block later gates. They do not block Batch 01. |
| Unverified this batch | Lint was not re-run (GW-015 warnings). The 390px header was not remeasured (GW-012). `/dev/magic-links` was not requested again (GW-013). Vitest, build, Playwright, backup and provider calls were not repeated. |

## Commands

| Command | Exit |
| --- | ---: |
| `git rev-parse HEAD` and `git status -sb` | 0 |
| `npm run typecheck` | 2 |
| `npm run test:decisions` | 1 (7 pass, 1 fail) |
| Read-only aggregates on `app-dev` database | 0 |

Read-only results: 18 clients, 3 fictional slugs; analytics jobs queued 36, cancelled 3, succeeded 1; `backup_runs` 0; no saved-report status rows.

## Repository deployment facts

Observable in the repo: `vercel.json` build settings, including an `AUTH_SECRET` build fallback of `preview-build-only`; no cron; no `vercel.ts`; no `.vercel/` directory; one GitHub workflow that runs tests and publishes a package when a release is created.

Unknown externally, and not treated as absent: whether a Vercel project, staging environment, scheduler or error tracker already exists outside this clone.

## Decisions still required

| Input | Role | Smallest next action |
| --- | --- | --- |
| DEP-05 history treatment for the directory migrations | Repository owner | Record leave-in-history or an out-of-pack rewrite. Do not rewrite history in Batch 01. |
| DEP-06 report states | Product owner | Choose D14’s four states or accept `draft` / `saved`. |
| DEP-01, DEP-02, DEP-03, DEP-07 | Provider, enquiry and website owners | Name the non-production targets. No secrets in git. |
| DEP-04, DEP-08 | Hosting and release owners | Name the staging project and rollback owner. |

## Next batch

`docs/release-readiness/01_BUILD_AND_REVISION.md`

Batch 00’s completion gate is met, so Batch 01’s prerequisite is met. Batch 01 can fix GW-001, GW-002, GW-003, GW-015’s lint errors and GW-017 without the blocked external inputs. It must not commit unrelated dirty files by accident, must not push, and must not claim HEAD `359502ce` is the release candidate.
