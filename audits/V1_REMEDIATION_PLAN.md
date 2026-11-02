# Genie Works V1 remediation plan

Audit date: 30 October 2026. This plan does not authorise implementation. Do the safety items before any pilot rehearsal. Estimates assume one engineer who already knows the repo. They are not quotes.

## Release rule

Do not start a pilot while any P1 in `audits/V1_BUG_REGISTER.md` is open. Do not add Blog Performance, a form builder, Wix publishing, a crawler, or alert preferences as part of making V1 pass.

## Order

### 1. Make one revision that builds

- GW-001: remove the unused `Link` import.
- GW-003: delete the four debug ingest blocks.
- GW-002: commit only when `git status` is clean and `typecheck`, `lint`, `test` and `build` pass.
- Retest: those four commands, then open `/` from a fresh checkout.

Effort: about half a day.

### 2. Separate fictional rehearsal data from the real directory

- GW-004: stop embedding clinic addresses and contact details in SQL migrations.
- Point a rehearsal environment at local Postgres plus `clinic_genie_enquiry_test`.
- GW-013: turn development magic links off for any process that uses the shared database.
- Keep Google auto-admin off outside a named local experiment.

Effort: about 1 day, plus a decision on git history.

Retest: a new local database has three fictional clients only. `/dev/magic-links` is 404 when the app uses the shared database.

### 3. Prove recovery

- GW-007: `npm run db:backup` and `npm run db:restore-test` on the local database after the migrations through `0034`.
- Include blog activity tables in the export list if a restore check would otherwise miss them.
- Confirm Admin shows the run.
- Do not restore onto the shared database.

Effort: half a day.

### 4. Connect the two data planes the pilot would actually use

- GW-006: enquiry fixture, then status change, failed notification, retry, and export denial.
- GW-005: one scheduled worker pass. Record last success or a safe error per connection. Leave the home page blank when the partition is missing.
- Do not call production inboxes. Do not treat a booking-link click as an appointment or a form start as an enquiry.

Effort: 2–3 days, depending on provider access.

### 5. Close the workflow gaps that staff would notice

- GW-008: report states. Prefer a decision record if `draft` / `saved` is accepted, so the spec and the database match.
- GW-011: admin-only connection secrets, unless D14 is revised.
- GW-009: idempotent seed.
- GW-012: header at 390px and 768px.
- GW-010: document the duplicate `0034` filenames. Do not rewrite applied migrations.

Effort: about 1 week if report states are built. About 2 days if they are explicitly accepted as `draft` / `saved`.

### 6. Only then consider a supervised internal pilot

Pilot entry checks:

- Clean commit, green build, green lint, green Vitest
- Local or otherwise approved data only
- Enquiry fixture connected
- At least one analytics sync success with a visible timestamp
- Restore test recorded
- Magic links off on that host
- A named person who can roll back the app and the database

Production stays closed until those checks pass on a staging project with separate environment variables, a real scheduler, error reporting, and a rollback note. `vercel.json` is not that project. The build fallback `preview-build-only` must not be the runtime secret.

### 7. Documentation

- GW-016 and GW-017: replace the 19 October status with the nine-module V1 description, D14–D21, and this audit.
- Say which legacy routes (tasks, approvals, ads, issues, medical review, timeline) are still reachable and are not V1 launch scope.

Effort: half a day.

## Suggested sequence of retests

| After | Retest |
| --- | --- |
| Steps 1–2 | Typecheck, lint, test, build, signed-out 307, worker 401, public API 404 |
| Step 3 | Admin backup page shows the restore-test row |
| Step 4 | Enquiry fixture counts, retry keeps one enquiry, analytics total matches one partition or stays blank |
| Step 5 | Report state decision or four-state flow; manager cannot write a connection secret; 390px header |
| Pilot gate | Specialist and read-only browser pass on fictional clients; no P1 left |

## What not to do in this pass

- Do not copy enquiry bodies into Genie Works.
- Do not enable `ANALYTICS_LIVE_REPORTS` on a screen that still draws the illustrative series without the caption.
- Do not mark SEO overview figures as Google Search results until a GSC partition is actually read there. D11 still treats that reporting as backlog.
- Do not run `db:reset` against the shared database.
