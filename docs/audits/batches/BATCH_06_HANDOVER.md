# Batch 06 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 06 — Reports and permissions |
| Date | 30 October 2026, Asia/Singapore |
| Starting SHA | `82acd2a90849a618431d2cc25665915217289f19` |
| Implementation SHA | `500db1a2432541bd24f8add03ceb6ab64435f9a6` |
| Branch | `main`, not pushed |
| Evidence commit | The documentation commit whose parent is the implementation SHA. No push. |

The starting SHA matched `main` before this batch. Untracked `.cursor/`, `apps/platform/public/client-marks/`, `audits/`, `docs/GENIE_WORKS_V1_STAFF_SOP.md`, `docs/release-readiness/` and `reports/` were left unstaged. Batches 01 and 02 had already met their gates. No later commit existed.

## Environment aliases

| Alias | What it is |
| --- | --- |
| `local-db` | Embedded Postgres `127.0.0.1:54339`, database `clinic_genie`. Permission tests roll back. `0035_connection_secret_admin.sql` was applied here. Not seeded and not reset. |
| `rehearsal-db` | Local database `clinic_genie_rehearsal`. The same migration was applied. Two archived fictional clients were made active only for the page check, then restored to archived at `2026-10-30 22:10:41.597578+08`. |
| `rehearsal-app` | Next.js on `127.0.0.1:3405`, platform database `rehearsal-db`, enquiry URL empty. Stopped after the check. |
| `app-dev` | The server on port 3400. Left running. Not pointed at the rehearsal database. |

No provider OAuth call was made. No report status was updated. `.env` was not edited.

## Files changed

Implementation commit, 17 files:

- `packages/db/migrations/0035_connection_secret_admin.sql` — analytics connection writes and SEO site-token writes use `app_is_admin()`, which still includes the service context.
- `packages/db/src/services/auth.ts` — `canWriteConnectionSecrets` and `assertConnectionSecretAdmin`.
- `packages/db/src/analytics/connections.ts` — create, exchange, save and disconnect require an administrator actor.
- `packages/db/src/services/seo-soft-launch.ts` — website API token issue requires an administrator. Other SEO publishing still uses the admin-or-manager publisher check.
- `apps/platform/src/app/actions/analytics.ts` — bind, Wix connect and disconnect are administrator-only. Refresh and CSV import stay with a registry manager.
- `apps/platform/src/app/api/analytics/google/start/route.ts` and `callback/route.ts` — the same administrator gate, before a provider request.
- `apps/platform/src/app/actions/seo.ts` and the SEO settings and form copy — credential rotation is administrator-only.
- `apps/platform/src/components/modules/AnalyticsConnections.tsx` — connect and disconnect controls render only for an administrator. Refresh and import remain.
- Tests in `packages/db/test/connection-secrets.test.ts`, `packages/db/test/seo-site-token.test.ts`, `apps/platform/src/lib/connection-secrets.test.ts` and `apps/platform/src/lib/access.test.ts`.

Applied migrations `0020` and `0028` were not edited.

## GW-011 — verified

D14 says connection credentials stay admin-only. No later decision changes that.

Checked and gated:

- `bindAnalyticsProperty`, `connectWix`, `disconnectAnalytics`
- `GET /api/analytics/google/start` and `GET /api/analytics/google/callback`
- `issueSeoSiteToken` and `rotateSeoSiteTokenAction`
- direct inserts and updates of `analytics_connections` and `seo_site_tokens`

An administrator can store a connection through the service and can insert a connection row. The existing admin token test still rotates a token and the public API reads only the new one. A manager cannot do those writes as staff or when the service is asked to act for that manager. A specialist, reviewer and read-only user are denied the same way. The manager OAuth start on port 3405 returned 307 to `analyticsError=secret_denied` and did not redirect to Google.

Preserved:

- Manager website update in the rolled-back connection test.
- Refresh and CSV import remain available to a registry manager. The manager settings page included both and did not include Connect GA4, Connect Search Console or Connect Wix.
- SEO verification publishing remains available to an admin or manager. The manager connections page still offered that control.
- Worker token refresh still writes `analytics_secrets` as the service role. That table was already service-only.

Secrets:

- `listConnections` returns the public columns only. The test connection object has no ciphertext, nonce or secret reference.
- A manager select of `analytics_secrets` and OAuth ciphertext returned no rows.
- Bind and token-rotation audit metadata did not contain the fixture token or its ciphertext.
- Action and callback logs still record `error.name` only.
- The one-time website token is returned only by the rotate action after the administrator check. The manager action result has no token.
- The settings page shows a connected boolean, not `token_hash`.

The signed-in administrator page on port 3405 showed Connect GA4, Connect Search Console, Connect Wix, refresh and import for the fictional Harbourview website.

## GW-008 — inspected, not implemented

DEP-06 remains open. No report status was added or migrated. An existing `saved` row is not approved.

### Current behaviour

- `saved_reports.status` allows `draft` and `saved` only (`0033_report_builder.sql`).
- A draft updates the working copy and does not insert `saved_report_versions`. A save-for-review inserts an append-only version with `for_review` true. Update and delete of a version are blocked by triggers.
- Writes use `app_can_edit_client`: specialist members, admin and manager. Reviewer and read-only cannot edit.
- There is no stored PDF file. `POST /reports/[id]/serial` issues a serial for browser print. `GET /reports/[id]/download` builds a CSV from the selected version, or from live figures when no version is selected, and requires export permission.
- Blog `draft` / `in_review` / `approved` / `published` is a different workflow and was not reused.

### Proposal, if the product owner chooses the four states

This is not a decision and it was not built.

| Transition | Who |
| --- | --- |
| Create or update Draft | Specialist member of that client, admin, manager |
| Draft to In review | Those same editors. This inserts the immutable review version. It does not approve the report. |
| In review to Approved | Reviewer member of that client, admin, manager. A specialist cannot approve. |
| Approved to Final | Admin and manager only. Publishing and export stay with those roles. |
| Correction after Final | A new version. The final row is not updated. An editor may open the correction. Only an admin or manager may mark the correction Final. |
| Any transition | Read-only cannot. A specialist cannot set Approved or Final by a direct update. |

Existing rows:

- `draft` remains Draft. A draft has no review version.
- `saved` remains a legacy save-for-review record. It is not In review, Approved or Final. `for_review` true does not mean approved. The forward migration must not rewrite these rows. The screen should keep the label “Saved for review (not approved)” until a person explicitly submits the row into In review.

Final artifact:

- A Final version needs bytes, or a frozen render, stored with that version and returned unchanged. The current CSV can rebuild from live figures, so it is not that artifact.
- Where those bytes live is still the open DEP-06 input. This proposal does not choose a directory, bucket or table.
- Retrieval should keep the current split: a client member may view, and export stays with admin and manager.

Forward migration and tests, not applied:

- Add a new migration after `0035`. Do not edit `0014` or `0033`.
- Widen the status check without updating existing rows to Approved or Final. Keep `saved` as the legacy value.
- Keep version rows append-only.
- Reject Approved and Final from a specialist, reviewer or read-only writer in the service and in the database.
- Add the artifact store only after its location is decided.
- Tests: each role for each transition, cross-client denial, an existing `saved` row stays not approved, a version update still fails, a later metric change does not change a final artifact, and a correction inserts a new version.

## Commands

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run db:migrate` on `127.0.0.1:54339/clinic_genie` | 0 | 1 applied, 35 skipped |
| `npm run db:migrate` on `127.0.0.1:54339/clinic_genie_rehearsal` | 0 | 1 applied, 35 skipped |
| `npm test -w @clinic-genie/db -- test/connection-secrets.test.ts test/seo-site-token.test.ts test/analytics-sync.test.ts` | 0 | 3 files, 18 tests |
| `npm test -w @clinic-genie/db -- test/blog.test.ts test/permissions.test.ts test/provider-fixtures.test.ts test/agency-overview.test.ts` | 0 | 4 files, 28 tests |
| `npm test -w @clinic-genie/platform -- src/lib/connection-secrets.test.ts src/lib/access.test.ts` | 0 | 2 files, 5 tests |
| `npm run typecheck` | 0 | |
| `npm run lint -w @clinic-genie/platform` | 0 | 0 errors, 11 warnings |

The full `npm test` suite was not run. No live provider was called.

## Fixed, blocked and left open

- Fixed and verified: GW-011.
- Blocked: GW-008 and DEP-06. The proposal above is the prepared implementation. It is not approval and it is not the implementation.
- Unchanged and still open: DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-07, DEP-08. GW-009, GW-010, GW-012, GW-014, GW-015 and GW-016 were not taken up.

## Decision still required for DEP-06

The product owner must record one choice in `docs/DECISIONS.md`: implement Draft, In review, Approved and Final, or accept `draft` / `saved` as V1 and amend D14. That same record must say where the final artifact lives. Until then, no report-status migration is authorised.

## Next batch

Batch 07 is `docs/release-readiness/07_SEED_UI_AND_DOCS.md`. Its prerequisites are Batches 01 and 02, which are met. Seed idempotency, the duplicate `0034` filenames, the header, and the documentation refresh do not depend on DEP-06. Independent Batch 07 work can start. It was not started.
