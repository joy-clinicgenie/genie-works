# Batch 08 handover

## Identity

| Item | Value |
| --- | --- |
| Batch | 08 — Browser and site journeys |
| Date | 31 October 2026, Asia/Singapore |
| Starting SHA | `20c99af6253c9701e9d2cdd3e72985cb7d0e9dd1` |
| Implementation SHA | `dc370be69dd0d77384220f3e6c1809d82f56524d` |
| Tested checkout SHA | `dc370be69dd0d77384220f3e6c1809d82f56524d` |
| Branch | `main`, not pushed |
| Evidence commit | The documentation commit whose parent is the implementation SHA. No push. |

The official browser suite ran against the implementation tree. The documentation commit does not change runtime, schema or dependencies. Untracked `.cursor/`, `apps/platform/public/client-marks/`, `audits/`, `docs/release-readiness/` and `reports/` were left unstaged. `apps/platform/next-env.d.ts` was restored and not committed. GW-011 stays fixed. No connection-secret file was edited. No decision was added. Latest approved decision remains D21.

## Environment aliases

| Alias | What it is |
| --- | --- |
| `platform-db` | New local database `clinic_genie_b08` on `127.0.0.1:54339`. Migrated, seeded, used, then dropped. Not `clinic_genie` and not `clinic_genie_rehearsal`. |
| `enquiry-db` | New local database `clinic_genie_enquiry_test_b08` on `127.0.0.1:54339`. Fixture rows only. Dropped. Not `clinic_genie_enquiry_test`. |
| `prod-app` | `next start` on `127.0.0.1:3408`, dist `.next-batch08`, pointed at `platform-db`. Stopped after the suite. |
| `fixture-app` | `next dev` on `127.0.0.1:3409`, dist `.next-batch08-dev`, used only because production mode refuses the enquiry fixture. Stopped after the suite. |
| `app-dev` | The server on port 3400, listener PID 40673. Left running. Not pointed at either batch database. |

Playwright 1.64.1. Chromium. Trace, screenshot and video were off. The Playwright config does not start or reuse port 3400. Provider environment variables on both temporary processes were empty. No provider was called. No mail was sent. Port 54329 was not used. `.env` was not edited. After the suite, `clinic_genie`, `clinic_genie_rehearsal` and `clinic_genie_enquiry_test` were still present. The two batch databases were not.

## Files changed

Implementation commit, 15 files:

- `apps/platform/src/components/shell/Shell.tsx` — opening the mobile menu focuses its first link. Escape closes it and returns focus to the Open menu button.
- `apps/platform/src/components/modules/ReportBuilder.tsx` — each report-section group checkbox has an accessible name.
- `e2e-batch08/` and `playwright.batch08.config.ts` — the journeys below.
- `.gitignore` — ignores `.next-batch*/` and `e2e-batch08/.run/`.

Applied migration files were not edited.

## Journeys

| Journey | Result |
| --- | --- |
| Signed-out access and role checks | Passed |
| Assigned versus unassigned clients | Passed |
| Client create, edit and archive | Passed |
| In-app blog workflow | Passed |
| Fixture enquiry status, retry and export | Passed |
| Staff deactivation and session revocation | Passed |
| Desktop, mobile and keyboard navigation | Passed |
| Report finalisation and retrieval | Blocked. DEP-06 |
| Live analytics | Blocked. DEP-01 |
| Live enquiry source | Blocked. DEP-02 |
| Mail delivery | Blocked. DEP-03 |
| Website API consumption | Blocked. DEP-07 |

Draft and saved report behaviour was checked and passed. That is not finalisation.

## Roles

Checked on the production server against the D6 matrix, including direct requests.

| Role | Result |
| --- | --- |
| Signed out | Passed. `/` stopped at sign-in. No email form, no Google button, and `/dev/magic-links` returned 404. The Google start route redirected to sign-in and not to a Google host. A blog preview redirected to sign-in. |
| Admin | Passed. Harbourview, Meridian and Northgate were visible. Admin and Add client opened. |
| Manager | Passed. All three clients were visible. Admin was absent and `/admin` returned home. Google start redirected with `analyticsError=secret_denied` and not to a Google host. Connect GA4 and Connect Search Console were not shown. |
| Specialist A | Passed. Harbourview and Meridian were visible. Northgate was not, and its client URL redirected with the access denial. Add client and Admin were refused. Export returned 403. Google start was `secret_denied`. |
| Specialist B | Passed. Only Northgate was visible. The Harbourview client URL was denied. A Meridian enquiry request returned 404. |
| Reviewer | Passed. Harbourview and Meridian were visible. Northgate was denied. The profile said only admins and managers can edit, with no Save details button. Report creation and Add client were refused. The assigned blog could be approved. |
| Read-only | Passed. Only Harbourview was visible. Meridian was denied. Report creation was refused. Export returned 403. Google start was `secret_denied`. The failed-notification list had no Retry button. |

## In-app blog

On the fictional Meridian Next.js website, Specialist A saved a draft and submitted it. The assigned reviewer approved it. Specialist A saw the admin-or-manager publish limit and had no Publish button. The assigned preview returned 200 with `noindex` and `private`, and contained the fictional title. Specialist B received Page not found for the editor and the preview, without the title. The administrator published it. The preview stayed `noindex` and `private`. The public page returned 404 without a token and 200 with a token created for this test. The response contained the fictional title and `noindex`.

This does not show that a clinic website rendered the article. DEP-07 stays open. No SEO setting was published to a website.

## Fixture enquiries

The production server showed the refusal text, did not list `TEST-HV-NEW-001`, and export returned 503. That refusal is the production check.

On the development server, against `enquiry-db` only:

- Specialist A set `TEST-MS-NEW-004` to acknowledged and the page confirmed the follow-up save.
- The reviewer saw the view-only sentence and had no Save follow-up button.
- Specialist B received 404 for that Meridian enquiry and did not see the Harbourview failed row.
- An administrator retry removed `TEST-HV-ACK-002` from the failed list. The pending list then said Retry requested.
- The administrator CSV returned 200 and did not contain the fixture reference or the fictional fixture address.
- Read-only had no Retry button and export returned 403.

Retry requested is not provider acceptance and not mailbox delivery. The CSV is not a live export. Messages were not copied into the platform database.

## Staff deactivation

An administrator added `temp-b08@example.invalid` on `platform-db` only. A session for that person could open Agency Overview. After the Deactivated checkbox was saved, the session row count was 0 and a reload stopped at sign-in. The database was dropped. No shared staff record was deactivated.

## Layout, keyboard and accessibility

| Check | Result |
| --- | --- |
| 390, 768 and 1440 on `/clients` | Passed. Page overflow 0, header overflow 0, overlapping controls 0. Below 1024 the Open menu button was visible. |
| Keyboard | Passed. The first Tab stop was Skip to main content. Enter on Open menu focused Dashboard. Tab focused Clients. Enter opened `/clients`. |
| Focus | Passed. Skip link, Clients after the colour transition, clinic name and specialty were a 3px solid outline in `rgb(19, 108, 114)`, the action token `#136C72`. |
| Labels and headings | Passed on `/sign-in`, `/`, `/clients`, `/clients/new` and `/reports/new`. Findings: none. |

An immediate sample of the Clients link can read `rgb(63, 92, 97)`, which is the ink-soft text colour, because `transition-colors` includes the outline colour. The passing assertion waits until the outline is the action colour.

Automated findings are limited to those pages and that keyboard path. There was no axe-core scan, no screen reader, no contrast measurement and no Lighthouse run. This is not a WCAG conformance claim. Escape closes the mobile menu in the component. The passing suite did not press Escape.

## Fixed and verified

- Mobile menu keyboard focus. The menu is inserted before the Open menu button, so Tab from that button did not enter it. Opening the menu now focuses the first link.
- Report section group checkboxes had no accessible name. Each group checkbox is now named from its section label. The `/reports/new` control scan then reported none.

GW-011, GW-012, GW-013 and GW-014 stay fixed and verified. The browser evidence above is additional. GW-004, GW-005 and GW-006 stay partially fixed. GW-008 stays blocked.

## Blocked

| ID | Why it stays blocked |
| --- | --- |
| GW-008 / DEP-06 | No decision, no new report state, and no final artifact. Draft and saved were checked only. |
| DEP-01 | No live analytics read. Google starts for non-admins and signed-out users were denied before a provider. |
| DEP-02 | The enquiry journey used a local fixture. The production server refused it. |
| DEP-03 | No mail was sent. Retry requested is not inbox delivery. |
| DEP-04 | No staging deployment. |
| DEP-05 | Historical migration text was not rewritten. |
| DEP-07 | The public API returned one fictional article to a test token. No clinic website rendered it. |
| DEP-08 | No rollback owner was named. |

## Unverified

- A clinic website applying a published article or SEO setting.
- Report finalisation, approval, a final artifact and retrieval of that artifact.
- Live GA4, Search Console, Wix, or mailbox delivery.
- Full WCAG conformance, screen-reader behaviour, colour contrast and Lighthouse.
- The full `npm test` suite, `npm run typecheck` and ESLint in this batch.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| `npx playwright install chromium` | 0 | Playwright 1.64.1. Chromium launched. |
| `npx tsx e2e-batch08/prepare.mts` | 0 | `platform-db`: 36 applied, 0 skipped. Seed 6 staff, 3 clients, 14 tasks. Three fictional clinics restored there only. `enquiry-db`: 6 enquiries, 6 notifications. |
| `next build` with `NEXT_DIST_DIR=.next-batch08` | 0 | Production build after the two source fixes. |
| `npx playwright test --config=playwright.batch08.config.ts` | 0 | 16 passed, 14.8s. |

Earlier runs in the same session failed on selectors and on the menu-focus and unlabelled-checkbox defects. Those runs are not the official result. The 16-passed command above is the result for this tree.

Both temporary servers were stopped. Port 3400 PID 40673 was still listening. `apps/platform/next-env.d.ts` was restored. `.next-batch08` and `.next-batch08-dev` were removed. `platform-db` and `enquiry-db` were dropped.

## Next batch

Batch 09 is staging operations. Its file says local preparation can proceed before full staging readiness. Local deployment, monitoring and rollback notes can be prepared. This session does not start that batch.

Hosted staging cannot start. DEP-04 still has no authorised staging project. DEP-01, DEP-03 and DEP-08 still block the hosted scheduler, mail and a named rollback owner. Production remains a separate decision.
