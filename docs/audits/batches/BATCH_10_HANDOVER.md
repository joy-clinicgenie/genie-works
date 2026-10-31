# Batch 10 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 10 — Local re-audit of the release candidate |
| Date | 31 October 2026, Asia/Singapore |
| Starting SHA | `4acb0a585a2b033ecf33acca891fb276f57558a8` |
| implementation_candidate_sha | `85b99c7d11a11feae4d5da93068d754a9dfcd5b4` |
| tested_checkout_sha | `85b99c7d11a11feae4d5da93068d754a9dfcd5b4` |
| Branch | `main`, not pushed |
| Evidence commit | The documentation commit whose parent is the candidate SHA. No push. |

The candidate adds two test commits on top of the Batch 09 evidence. They point the report and form tests at fictional clients and leave the append-only sessions row in place. No application screen, schema or dependency changed. No decision was added. Latest approved decision remains D21.

Untracked `.cursor/`, `apps/platform/public/client-marks/`, `audits/`, `docs/release-readiness/` and `reports/` were left unstaged. The original audit files were not edited.

## Environment

| Alias | What happened |
| --- | --- |
| `audit-worktree` | Detached checkout of the candidate. `npm ci` installed the lockfile. The worktree was removed after the checks. |
| `rehearsal-db` | `clinic_genie_b10_rehearsal` on `127.0.0.1:54339`. Dropped. |
| `restore-db` | `clinic_genie_b10_rehearsal_restore_test`. Dropped after a passed restore. |
| `journey-db` | `clinic_genie_b08` and `clinic_genie_enquiry_test_b08`. Dropped. |
| `journey-prod` / `journey-dev` | Ports 3408 and 3409. Stopped. |
| `app-dev` | Port 3400 was clear. PID 40673 was absent. |

Node v24.15.0, npm 12.2.1, Next.js 16.4.2, Playwright 1.64.1. Lockfile SHA-256 `14853308e5f98f6a02eedf1d16eaaecdcaac9d17bb4442e8761fd8597efbc2d9`. The configured application database was not used. Embedded Postgres for this batch used the worktree data directory and was stopped.

## Files changed

Test commits:

- `packages/db/test/report-builder.test.ts`
- `packages/db/test/leads-forms.test.ts`

Evidence documents:

- `docs/audits/V1_REMEDIATION_STATUS.md`
- `docs/audits/V1_DEPENDENCIES.md`
- `docs/audits/V1_RELEASE_RETEST.md`
- `docs/audits/V1_PILOT_GO_NO_GO.md`
- `docs/audits/batches/BATCH_10_HANDOVER.md`

## Checks

| Result | What |
| --- | --- |
| Passed | Typecheck, platform ESLint with `--max-warnings 0`, 151 automated tests, 8 decision checks, production build, 16 browser journeys, local backup and isolated restore, administrator operations status access. |
| Failed, then fixed in the candidate | The suite on the starting SHA failed because four tests expected the removed directory client or its form rows. The next commit still failed by trying to delete an append-only snapshot. The candidate SHA is the passing run. |
| Blocked | Hosted staging, live provider sync, mail delivery, clinic website consumption, report finalisation, historical-migration decision, and a named rollback owner. |
| Not run | A deployment, a hosted cron invocation, a provider call, and a WCAG conformance audit. |

The production enquiry-fixture guard still refuses the fixture. The journey server reported `enquiryFixturePermitted: false` and `enquirySource: refused`.

## Issue ledger

| Group | IDs |
| --- | --- |
| Fixed and verified | GW-001, GW-002, GW-003, GW-007, GW-009, GW-010, GW-011, GW-012, GW-013, GW-014, GW-015, GW-016, GW-017 |
| Partially fixed | GW-004, GW-005, GW-006 |
| Blocked | GW-008 |
| P0 | None |

Totals: fixed and verified 13, partially fixed 3, blocked 1. By severity of the rows that are not closed: P1 partial 3, P2 blocked 1.

## Recommendations

| Environment | Decision |
| --- | --- |
| Supervised fictional-data rehearsal | Ready locally, with the limits in `docs/audits/V1_PILOT_GO_NO_GO.md`. |
| Connected internal pilot | No-go. Open P1s and DEP-01 through DEP-08. |
| Production | Not approved. |

Retest score 62 / 100. The original audit remains 53 / 100. Failed gates override both numbers.

## Dependencies

DEP-01 through DEP-08 stay open. Roles and next actions are in `docs/STAGING_ACTIVATION.md` and `docs/audits/V1_PILOT_GO_NO_GO.md`.

## Next batch

This pack has no Batch 11 file. A later connected-pilot session needs the dependency inputs above. This session does not start that work.
