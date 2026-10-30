# Batch 01 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 01 — Produce a reproducible version that builds |
| Date | 30 October 2026, Asia/Singapore |
| Starting SHA | `359502ce015d5b0555609a5311ff969b7c806a74` |
| Implementation candidate | `2ff49401703730a43dd6c4127cee95c319575d1f` |
| Tested checkout | `2ff49401703730a43dd6c4127cee95c319575d1f` |
| Branch | `main`, ahead of `origin/main` by the local commits from this batch |
| Evidence commit | The documentation commit whose parent is the implementation candidate. No push. |

The clean checkout was a detached worktree of the candidate. Its configuration file was created there and removed with the worktree. It was not copied from the shared application environment.

## Environment aliases

| Alias | What it is |
| --- | --- |
| `local-db` | Embedded Postgres `127.0.0.1:54339`, database `clinic_genie`. Started for this batch. Tests and the clean-checkout render used it. |
| `checkout-dev` | Next.js development server from the clean worktree, port 3401, label `development`. Enquiry URL empty. Google sign-in variables empty. Development magic links enabled for that local process only. |
| `app-dev` | The existing server on port 3400. Not used for these checks and not pointed at the clean checkout. |

No remote application database was queried, seeded, migrated or restored.

## Files changed

Implementation commit, 54 files. It contains the agency overview home page, its database helpers and tests, the shell and navigation work already in the tree, decision D21, and these Batch 01 fixes:

- Removed the unused `Link` import from `apps/platform/src/components/modules/blog/BlogWorkflow.tsx`.
- Removed temporary localhost ingest calls and their timing from `apps/platform/src/app/(app)/layout.tsx`, `apps/platform/src/lib/session.ts`, `apps/platform/src/components/shell/Shell.tsx` and `packages/db/src/client.ts`. The shell still copies a stored navigation preference into its cookie.
- `BackButton` still stores the page stack and shows Back on a nested page. The target is read from that stored stack instead of setting state inside the effect. No lint rule was disabled.
- `tests/day-01-scope-audit.test.mjs` now expects `docs/00_` through `docs/20_` and the existing platform tree. Product name, booking mode, unconfirmed Vercel access, the unbooked reviewer, and the failure and unauthorised tests are unchanged.
- `apps/platform/src/lib/agency-overview.test.ts` fails if those source files contain the ingest host or debug session header.

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
| Fixed and verified | GW-001, GW-002, GW-003, GW-017 |
| Partially fixed | GW-015. Six lint errors are gone and lint exits 0. Eleven warnings remain, listed below. |
| Reproduced | GW-004, GW-005, GW-006, GW-007, GW-008, GW-009, GW-010, GW-011, GW-012, GW-013, GW-014, GW-016 |
| Blocked | DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06, DEP-07, DEP-08. They do not undo this batch. DEP-05 still blocks closing GW-004. |
| Unverified this batch | Playwright, seed, backup, restore, provider calls, and the 390px header. |

Retained lint warnings, both before and after the fix:

- `apps/platform/eslint.config.mjs` anonymous default export
- Raw `<a>` on the new-page routes for approvals, Google Ads audits, Google Ads changes, issues, medical review and tasks
- `<img>` in `sign-in/page.tsx`, `ClientMark.tsx` and `Shell.tsx` (two)

## Commands

| Command | Where | Exit |
| --- | --- | ---: |
| `npm run lint` | Working tree, before the fix | 1 (6 errors, 11 warnings) |
| `npm run typecheck` | Working tree after the fix, then clean checkout | 0 |
| `npm run lint` | Working tree after the fix, then clean checkout | 0 (11 warnings) |
| `npm run test:decisions` | Working tree after the fix, then clean checkout | 0 (8 passed, 0 failed) |
| `npm test` | Local database, working tree and clean checkout | 0 (81 database tests, 36 platform tests) |
| `npm run build` | Working tree and clean checkout | 0 |
| Unsigned `GET /` on `checkout-dev` | Clean checkout | 307 to sign-in |
| Signed-in `GET /` on `checkout-dev` | Clean checkout, fictional `admin@example.invalid` | 200 |

The signed-in document title was `Dashboard | Clinic Genie`. The page contained the heading `Agency Overview` and did not contain `LaunchDashboard`. Performance entries did not include the debug ingest host. The page contained one image, and that image loaded. The untracked client-mark files were not in the checkout.

`npm ci` in the worktree warned that two install scripts were blocked. The checks above still passed.

## Decisions still required

| Input | Role | Smallest next action |
| --- | --- | --- |
| DEP-05 history treatment for the directory migrations | Repository owner | Record leave-in-history or an authorised rewrite outside this pack. Do not rewrite history in Batch 02. |
| DEP-06 report states | Product owner | Choose D14’s four states or accept `draft` / `saved`. |
| DEP-01, DEP-02, DEP-03, DEP-07 | Provider, enquiry and website owners | Name the non-production targets. No secrets in git. |
| DEP-04, DEP-08 | Hosting and release owners | Name the staging project and rollback owner. |

## Next batch

`docs/release-readiness/02_SAFE_ENVIRONMENT.md`

Batch 01’s completion gate is met, so Batch 02’s prerequisite is met. Batch 02 can start. Its external inputs remain recorded and do not have to be solved before the fictional rehearsal work. This session stops here.
