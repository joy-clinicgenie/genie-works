# Batch 05 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 05 — Enquiries, notification retry and exports |
| Date | 30 October 2026, Asia/Singapore |
| Starting SHA | `8e6057d0f4a1e6818dd4d85541cc2388b3304eac` |
| Implementation SHA | `3d955f0def636746f92d66d9c87ba4ba8d6a95ba` |
| Branch | `main`, not pushed |
| Evidence commit | The documentation commit whose parent is the implementation SHA. No push. |

The starting SHA matched `main` before this batch. Untracked `.cursor/`, `apps/platform/public/client-marks/`, `audits/`, `docs/GENIE_WORKS_V1_STAFF_SOP.md`, `docs/release-readiness/` and `reports/` were left unstaged. Batches 02 and 03 had already met their gates. No later commit existed.

## Environment aliases

| Alias | What it is |
| --- | --- |
| `local-db` | Embedded Postgres `127.0.0.1:54339`, database `clinic_genie`. Used by the leads regression. Tests roll back. Not seeded or migrated in this batch. |
| `enquiry-fixture` | Local database `clinic_genie_enquiry_test` on the same Postgres. Synthetic rows only. Reset after the browser session. |
| `rehearsal-db` | Local database `clinic_genie_rehearsal`. Platform sessions and append-only history only. |
| `rehearsal-app` | Next.js on `127.0.0.1:3404`, platform database `rehearsal-db`, enquiry target `enquiry-fixture`. Stopped after the check. |
| `app-dev` | The server on port 3400. Left running. Not pointed at the fixture. |

Before the rehearsal process started, the enquiry target was checked and printed only as host `127.0.0.1`, port `54339`, database `clinic_genie_enquiry_test`. The platform target was `127.0.0.1:54339/clinic_genie_rehearsal`. The reader refuses any other enquiry target before it opens a connection, including the platform database name and port 54329. `.env` was not edited. `enquiry:link` was not run. No mail was sent.

## Files changed

Implementation commit, 11 files:

- `apps/platform/src/lib/form-submissions.ts` checks the enquiry URL with `assertEnquiryFixtureUrl` before creating a pool. An empty URL stays disconnected. A refused URL is not opened. Production comparisons still require `is_synthetic = false`. CSV cells that start with tab, carriage return, `=`, `+`, `-` or `@` are prefixed. Notification labels distinguish retry requested, a current source-sender lease, provider acceptance, and the absence of inbox delivery.
- Enquiry, notification, settings and home pages say when the target was refused. Settings says Reachable only after the fixture check succeeds.
- `apps/platform/src/app/actions/enquiries.ts` records a retry as requested. It does not add a mail sender.
- `packages/db/test/enquiry-fixture.test.ts` covers the status cycle, one winner of a concurrent update, a failed notification that stays stored, a duplicate retry, and a sent row that is not reset.
- `apps/platform/src/lib/form-submissions.test.ts` covers the October fixture counts, the production exclusion, formula escaping, and refusal of the platform database and port 54329 before a connection is opened.

Applied SQL files were not edited. No second copy of an enquiry message was added to platform history.

## What was verified on the fixture

October 2026, Asia/Singapore, against the reset fixture:

| Check | Result |
| --- | --- |
| Working list | 5 demonstration rows. Production total 0. Previous period 0. Client, website, form and source breakdowns empty. |
| Client `harbourview-dental` | 2 |
| Website `meridian-skin-staging` | 1 |
| Form `contact` | 2 |
| Follow-up status `new` | 3 |
| Scope `northgate-physio` | 1. The same scope with clinic `harbourview-dental` was 0. |
| 1–31 January 2020 | Connected, 0 rows. Missing dates are not treated as a failed connection. |
| Dashboard counts | Connected, new 0, acknowledged 0, closed 0. |
| Production CSV | Header only. No message body and no `example.invalid` address. |

The list has no source filter. Source is a production breakdown, and that breakdown stayed empty. The five October demonstration rows were campaign 1, direct 2 and organic 2. The referral row is in September and was outside that list.

`TEST-HV-NEW-001` moved New → Acknowledged → Closed → New. The stored message was unchanged. Two concurrent updates from New produced one winner, and a later update that still expected New changed nothing. The enquiry count stayed 6.

The failed notification on `TEST-HV-ACK-002` left that enquiry in place. Two concurrent retries produced one pending row and did not insert an enquiry. A retry of the sent row on `TEST-HV-NEW-001` returned no change: status stayed `sent` and the provider message id stayed the fixture value. A duplicate idempotency key was already rejected by the existing fixture test.

A local `leased_until` update on the pending Meridian row is a simulation of the source sender. It is not a sender process and not inbox delivery.

## Rehearsal app

Signed in as the seeded admin on `127.0.0.1:3404`.

- Settings showed Enquiry records as Reachable. The page did not say the enquiry database was disconnected.
- Home showed Enquiries received 0 and “Stored submissions”. It did not say “Connection required”.
- Enquiries showed 5 matching demonstration rows, production total 0, and “None in this period” for every breakdown. The Harbourview filter showed 2.
- `TEST-HV-NEW-001` was saved from New to Acknowledged, then Closed, then New. After reload the history showed those three staff changes and did not include the enquiry message. The message remained on the page, read from the fixture. The notification stayed “Sent” with “Delivery to the mailbox is not confirmed.” The word Delivered was not shown.
- `TEST-HV-ACK-002` stayed Acknowledged after Retry. The label became “Retry requested” and the history line was “Manual retry requested”. The message remained.
- Notification status for October showed Retry requested, Sent, Not configured and Processing. Processing was the local lease. September included `TEST-HV-CLOSED-003` and the Failed label. Delivered was not shown.

Server export responses:

| Request | Result |
| --- | --- |
| No session, `GET /enquiries/export` | 307 to `/sign-in` |
| Admin, with and without contact details, including clinic `harbourview-dental` | 200, `text/csv`, header only. Contact details add Name, Telephone and Email to the header. No message column, no synthetic sentence, no address. |
| Manager, same two paths | 200, header only |
| Read-only, same two paths | 403, `Not allowed` |
| Specialist B, including clinic `harbourview-dental` | 403, `Not allowed` |
| Specialist B, enquiries page with clinic `harbourview-dental` | 200, “You do not have access to that clinic.” No Harbourview reference. 0 matching rows. |

Specialist B’s active membership scope is empty on this rehearsal because the fictional clients are archived. The cross-client request was still denied, and no Harbourview row was returned.

Platform audit rows written for the browser session use these metadata keys only: status events `fromStatus`, `toStatus`, `noteSet`; retry `clinicId`; view `clinicId`, `reference`; export the filter names, `rowCount`, `personSearch`, `contactDetails` and clinic counts. `enquiry_status_events` has no email, contact or message column. Those rows were left in place. They are append-only. The fixture itself was reset afterwards to 6 enquiries and 6 notifications.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `npm test -w @clinic-genie/db -- test/enquiry-fixture.test.ts` | 0 | 2 passed |
| `npm test -w @clinic-genie/platform -- src/lib/form-submissions.test.ts` | 1 | 9 passed, 1 failed. The formula expectation did not match the quoted CSV cell. |
| `npm test -w @clinic-genie/platform -- src/lib/form-submissions.test.ts` | 0 | 10 passed |
| `npm test -w @clinic-genie/db -- test/leads-forms.test.ts` | 0 | 4 passed |
| `npm run typecheck` | 0 | |
| `npm run lint -w @clinic-genie/platform` | 0 | 0 errors, 11 existing warnings |
| `npm run enquiry:reset -w @clinic-genie/db` | 0 | 6 enquiries, 6 notifications, local fixture only |

The full `npm test` suite was not run. No test was skipped.

## Issue and dependency result

| Result | Items |
| --- | --- |
| Partially fixed | GW-006. Fixture connection, totals, transitions, retry and export denial are verified. The live source and the live sender are not. |
| Unchanged | GW-001, GW-002, GW-003, GW-004, GW-005, GW-007, GW-013, GW-015, GW-017 keep their earlier statuses. GW-008 through GW-012, GW-014 and GW-016 stay reproduced. |
| Open | DEP-01 through DEP-08. DEP-02 and DEP-03 stay open. Fixture success is not live-source approval and is not inbox delivery. |

## Blocked work

| Dependency | Role | Smallest next action |
| --- | --- | --- |
| DEP-02 | Enquiry-source owner | Name the non-production enquiry database for the connected pilot. Do not use a patient database, and do not treat `clinic_genie_enquiry_test` as that approval. |
| DEP-03 | Sender owner | Name who runs the outbox dispatcher, which non-production recipient may be used, and whether provider acceptance is enough. Do not add a sender in Genie Works until that is decided. |

## Next batch

Batch 06 is `docs/release-readiness/06_REPORTS_AND_PERMISSIONS.md`. Its prerequisites are Batches 01 and 02, which are met. It can start. DEP-06 still blocks the report-state choice: D14 names four states and the database allows `draft` and `saved` only. This session does not start Batch 06.

Batch 05’s fixture gate is met. The live enquiry source and the live notification sender stay open.
