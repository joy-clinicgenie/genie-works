# Batch 07 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 07 — Seed, responsive UI and documentation |
| Date | 30 October 2026, Asia/Singapore |
| Starting SHA | `13df62d9c1620cf34f618b8d20b6149d6ff617af` |
| Implementation SHA | `7eddb69a5042ab92c56b5ca6d2358fe7ca2fd596` |
| Branch | `main`, not pushed |
| Evidence commit | The documentation commit whose parent is the implementation SHA. No push. |

The starting SHA matched `main` before this batch. Untracked `.cursor/`, `apps/platform/public/client-marks/`, `audits/`, `docs/release-readiness/` and `reports/` were left unstaged. `docs/GENIE_WORKS_V1_STAFF_SOP.md` was previously untracked and is now part of the implementation commit because this batch updates the staff procedure. GW-011 stays fixed. No connection-secret file was edited.

## Environment aliases

| Alias | What it is |
| --- | --- |
| `seed-check-db` | New local database `clinic_genie_seed_check` on `127.0.0.1:54339`. Created, migrated, seeded, then dropped. Not `clinic_genie` and not `clinic_genie_rehearsal`. |
| `local-db` | Embedded Postgres `127.0.0.1:54339`, database `clinic_genie`. The preview-snapshot test rolled back. Not seeded and not migrated by this batch. |
| `check-app` | Next.js on `127.0.0.1:3407`, pointed at `seed-check-db`, enquiry URL empty, dist directory `.next-batch07`. Stopped after the check. |
| `app-dev` | The server on port 3400, listener PID 40673. Left running. Not pointed at `seed-check-db`. |

No provider was called. No mail was sent. No report status was changed. `.env` was not edited. Port 54329 was not used.

## Files changed

Implementation commit, 20 files:

- `packages/db/src/seed.ts` — preview snapshot inserts skip a row that already matches `report_snapshots_current_idx`.
- `packages/db/src/preview-year.ts` — the year-analytics insert uses the same conflict skip.
- `packages/db/test/seed-preview.test.ts` — one rolled-back repeat insert.
- `packages/db/src/migrate.ts` — comment that both 0034 filenames are applied and must not be renamed.
- `apps/platform/src/components/shell/TopBar.tsx` and `Shell.tsx` — header actions wrap below the desktop breakpoint. The greeting is a paragraph. Reports and Add new stay readable.
- `apps/platform/src/components/shell/ClientMark.tsx`, `apps/platform/src/app/sign-in/page.tsx` — brand and client marks use `next/image`.
- Legacy new pages, including `seo/new`, use `Link` for the change control.
- `apps/platform/eslint.config.mjs` — named config export. Generated `.next-*` output is ignored with `.next`.
- `README.md`, `docs/BUILD_STATUS.md`, `docs/HANDOVER.md`, `docs/GENIE_WORKS_V1_STAFF_SOP.md`.

Applied migration files were not edited. `0035_connection_secret_admin.sql` was not edited.

## Fixed and verified

### GW-009 — repeatable seed

`insertPreviewSnapshot` inserts one current row and uses `on conflict do nothing`. A clinic is recorded as updated only when a row was inserted. The year-analytics insert uses the same clause. The partial unique index is still `report_snapshots_current_idx` on client, source, channel, metric, dimension and period, where the row is not superseded.

`seed-check-db`:

| Step | Result |
| --- | --- |
| First `npm run db:seed` | Exit 0. Seeded 6 staff, 3 clients, 14 tasks. |
| Second seed | Exit 0. “Nothing changed.” 29 snapshot rows. 0 current duplicate groups. |
| Three fictional active clinics, short codes CFAC, CEDAR and SUNRISE | Inserted only in this database. Names were Fictional Preview Clinic A, B and C. |
| Third seed | Exit 0. Preview figures and one year of synthetic analytics added. 16865 snapshot rows. |
| Fourth seed | Exit 0. “Nothing changed.” Still 16865 rows. 0 current duplicate groups. |

The database was dropped. `clinic_genie` and `clinic_genie_rehearsal` were not seeded.

### GW-010 — migration filenames

Both applied files remain:

- `0034_client_public_profiles.sql`
- `0034_leads_forms.sql`

Filename order applies the public-profile file first. On the fresh database the first migrate applied 36 files and 0 were already present, and removed 14 imported directory clients. The second migrate applied 0 and skipped 36. Each 0034 name had one `schema_migrations` row, and `0035_connection_secret_admin.sql` had one. No file was renamed or rewritten.

### GW-012 — responsive header

Checked signed in as the fictional administrator on port 3407.

| Width | What was measured |
| --- | --- |
| 390 | Search, Reports, Add new and the development label were fully inside the viewport. `scrollWidth` was 390. No control boxes overlapped. The greeting was not displayed. |
| 768 | The same controls sat on one row. `scrollWidth` was 768. No overlap and no clipping. The sidebar was hidden and the menu button was shown. |
| 1440 | The sidebar showed the nine modules. The greeting was visible as text. Search, Reports and Add new were on one row. The menu button and the header environment label were hidden. `scrollWidth` was 1440. No overlap. |

The header Reports link opened `/reports`. Add new opened a menu with Add blog and Add client.

Search, Reports, Add new and the menu button have `tabIndex` 0 and are not disabled. Forcing `:focus-visible` on each one matched that state and computed `outline: 3px solid rgb(19, 108, 114)` with a 2px offset. That colour is the action token `#136C72`. A DOM Tab event from the browser tool did not move native focus, so the ring was checked through the forced focus-visible state rather than a hardware Tab walk.

### GW-014 — page headings

The greeting is always a `p`. The live home page had one `h1`: Agency Overview. Server HTML for the nine module routes each had one `h1`: Agency Overview, Clients, Analytics, SEO Overview, Blog, Enquiries, Reports, Platform settings, Admin. The opened Reports page had one `h1`, Reports.

### GW-015 — lint warnings

`npx eslint . --max-warnings 0` in `apps/platform` exited 0. The previous raw anchors, `<img>` marks and anonymous ESLint export are gone. Ignoring `.next-*` build output is the same kind of ignore as `.next`. No lint rule was turned off.

### GW-016 — current documentation

README, build status, handover and the staff SOP now name the nine launch modules, the environment variable names and what each one is for, draft and saved reports, the blocked four-state proposal, and the legacy routes that still open. They do not say live analytics, email delivery or a clinic website reading this API has been verified. Clinic owner, content approver, security reviewer and release approver remain unnamed.

## Partially fixed

None in this batch. GW-004, GW-005 and GW-006 stay partially fixed from earlier batches because DEP-05, DEP-01, DEP-02 and DEP-03 are still open.

## Blocked

| ID | Why it stays blocked |
| --- | --- |
| GW-008 | DEP-06. Report states were not changed. A saved report is not approved. The proposal remains in `docs/audits/batches/BATCH_06_HANDOVER.md`. |
| DEP-01 | No live provider call. |
| DEP-02 | The shared enquiry URL was left empty. The check app said the enquiry database is not connected. |
| DEP-03 | No mail was sent. |
| DEP-04 | No staging deployment. |
| DEP-05 | Historical migration text was not rewritten. |
| DEP-06 | No decision and no final-artifact location. |
| DEP-07 | No clinic website was shown calling the API. |
| DEP-08 | No rollback owner was named. |

## Unverified

- The full `npm test` suite was not run.
- Native keyboard Tab movement was not observed through the browser tool. The focus ring and tab order were checked as described above.
- Live analytics, mailbox delivery and website API consumption were not exercised.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `npm run db:migrate` on `seed-check-db` | 0 | 36 applied, 0 skipped. Both 0034 files once. |
| `npm run db:migrate` again | 0 | 0 applied, 36 skipped. |
| `npm run db:seed` | 0 | First fictional seed. |
| `npm run db:seed` | 0 | Nothing changed. 29 snapshots. 0 duplicate groups. |
| `npm run db:seed` after the three fictional preview clinics | 0 | Preview and year rows added. 16865 snapshots. |
| `npm run db:seed` | 0 | Nothing changed. Still 16865. 0 duplicate groups. |
| `npm test -w @clinic-genie/db -- test/seed-preview.test.ts` | 0 | 1 passed. Rolled back on `local-db`. |
| `npm run typecheck` | 0 | |
| `npm run build` with `NEXT_DIST_DIR=.next-batch07-build` | 0 | |
| `npx eslint . --max-warnings 0` in `apps/platform` | 0 | 0 errors, 0 warnings. |

`seed-check-db` was dropped. The port 3407 process was stopped. Port 3400 PID 40673 was still listening. `apps/platform/next-env.d.ts` was restored and not committed. The temporary dist directories were removed.

## Next batch

Batch 08 can start. Its independent journeys are signed-out and role checks, assigned and unassigned clients, client create/edit/archive, the in-app blog draft through preview path, fixture enquiry status/retry/export, staff deactivation, and desktop, mobile and keyboard passes.

These Batch 08 cases cannot start until the named dependency is closed:

- Report finalisation and retrieval — DEP-06. Current reports are draft or saved. The four-state Final state is proposed only.
- Live analytics — DEP-01.
- A live enquiry source — DEP-02.
- Mail delivery — DEP-03.
- A clinic website rendering a published article or SEO setting from this API — DEP-07.

Do not treat one header check as a complete accessibility audit.
