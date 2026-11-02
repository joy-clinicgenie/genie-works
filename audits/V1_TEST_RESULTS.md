# Genie Works V1 test results

Audit date: 30 October 2026. Commands were run from the repository root unless noted. A command that failed is not recorded as a pass.

## Environment for automated tests

Vitest used overridden local URLs:

- `DATABASE_ADMIN_URL` = `postgresql://postgres@127.0.0.1:54339/clinic_genie` (password not recorded)
- `DATABASE_URL` = the local `cg_app` role on the same database
- `ENQUIRY_DATABASE_URL` empty for the test process
- `ANALYTICS_LIVE_REPORTS` empty for the test process

The app on port 3400 was left on its existing environment and was not switched to this local database.

Local Postgres was started with `npm run db:start`. It was already initialised. `npm run db:migrate` against that local URL applied:

- `0031_clinic_websites.sql`
- `0032_clinic_website_fields.sql`
- `0033_report_builder.sql`
- `0034_client_public_profiles.sql`
- `0034_leads_forms.sql`

30 migrations were already applied. This was a local schema update so tests could load. It was not run against the shared database.

`npm run db:seed` against the local URL then failed. See GW-009. Tests still ran because seed users were already present.

## Commands

| Command | Result |
| --- | --- |
| `npm run typecheck` | Fail. `BlogWorkflow.tsx(5,1)` TS6133 unused `Link`. Contracts and db packages completed; the platform package failed. |
| `npm run lint` | Fail. 6 errors, 11 warnings. Errors are `react-hooks/purity` on `Date.now` in `layout.tsx` (the debug timing block) and `react-hooks/set-state-in-effect` in `BackButton.tsx`. |
| `npm test` | Pass. `@clinic-genie/db` 15 files, 81 tests. `@clinic-genie/platform` 7 files, 35 tests. Vitest 4.1.12. About 4.5 seconds of test time. |
| `npm run test:decisions` | Fail overall. 7 pass, 1 fail. Failing test: `tests/day-01-scope-audit.test.mjs` “frozen scope matches the CG-01 record and the files on disk”. |
| `npm run build` | Fail. Next.js 16.4.2 compiled, then the same unused `Link` import failed typecheck. No production artifact. |
| `npm audit --omit=dev` | Pass. “found 0 vulnerabilities”. This is not a full secret scan. |
| `npx playwright test --reporter=line` | Not executed. 2 tests failed before the browser launched. Chromium was not installed in the Playwright cache used by this session (`chrome-headless-shell` missing for both the sandbox path and a retry outside the sandbox). |
| `git check-ignore -v .env` | Pass. `.gitignore:8:.env` ignores `.env`. |

Playwright spec that did not run:

- `e2e/sign-in.spec.ts` — signed-out redirect to `/sign-in`
- `e2e/sign-in.spec.ts` — `admin@example.invalid` development magic link

There is no pull-request workflow that runs these tests. `.github/workflows/npm-publish-github-packages.yml` runs tests only when a GitHub release is created.

## What the passing Vitest suite covers

Not every assertion is listed. These are the suites that ran green on the local database:

- Permissions and RLS, including specialist website denial, deactivated member session revoke, and append-only audit
- Client access, services versus channels, file links
- Blog review, Wix publish refusal, live revision, sitemap, isolation
- Leads follow-up history without the enquiry body, status compare-and-set, routing proposal not marked applied
- Enquiry fixture: retry does not insert a second enquiry
- Report builder: cost per lead, clicks are not leads, draft does not create a review version, other client’s figures hidden
- Agency overview session totals, blanks, and SQL that does not select enquiry personal columns
- Analytics measure, provider fixtures, sync isolation, SEO site token issuance
- Platform unit tests for access, page history, form export labels, analytics board math, SEO workspace, article blocks

Provider fixture tests do not call Google or Wix. Their own descriptions say they are not live APIs.

## HTTP checks against the running dev server

Unauthenticated:

| Request | Status |
| --- | --- |
| `GET /` | 307 |
| `GET /sign-in` | 200 |
| `GET /admin` | 307 |
| `GET /enquiries` | 307 |
| `GET /forms` | 307 |
| `GET /dev/magic-links` | 200 |
| `POST /api/internal/analytics/worker` with no header | 401 |
| `POST /api/internal/analytics/worker` with a wrong bearer | 401 |
| `GET /api/public/seo/{nil uuid}` | 404 |
| `GET /api/public/blog/{nil uuid}` | 404 |

Signed in as the existing Demo Admin session already in the browser. No new magic link was created by this audit. No enquiry detail, export, or client edit was submitted.

These routes returned HTTP 200: `/`, `/clients`, `/analytics`, `/analytics/traffic`, `/analytics/behavior`, `/analytics/behaviour`, `/seo`, `/seo/tasks`, `/seo/pages`, `/seo/redirects`, `/seo/site-health`, `/seo/business-profile`, `/seo/ai-visibility`, `/seo/reports`, `/seo/settings`, `/blog`, `/enquiries`, `/enquiries/notifications`, `/forms`, `/reports`, `/reports/new`, `/settings`, `/admin`, `/admin/users`, `/admin/audit`, `/admin/backups`.

The word “error” appears in the HTML of many of those pages because the app shell includes error-handling script. That match was not treated as a page failure. Meaningful states that were visible:

- Home: 15 active clients, 13 linked websites, enquiries em dash, “Connection required”, reports 0, sessions “Not yet synchronised”, illustrative-trend caption, enquiry database not connected.
- Blog: status tabs all 0 until a client and website are chosen. Copy says article performance is not in this version.
- Desktop 1440px: full sidebar with the nine V1 items.
- Phone 390px: no horizontal document scroll; top bar controls overlap.

A same-origin click on the Blog sidebar link focused the link and did not navigate. Loading `/blog` by URL did navigate. That single click miss was not repeated enough times to call the link broken.

## Read-only database aggregates

Shared app database, transaction `begin read only` then `rollback`:

| Aggregate | Value |
| --- | --- |
| Migrations | 35, including both `0034_*` files |
| Clients | 18 total, 15 active, 3 fictional slugs |
| Websites | 17 |
| Staff | 8, all active, 6 fictional addresses |
| Blog articles | 1 draft, 1 archived, 0 with `live_version_id` |
| Saved reports | no rows |
| Analytics connections | GA4 1 connected; GSC 10 connected, 1 disconnected; Wix 1 connected |
| Connection time zones | GSC `America/Los_Angeles`; GA4 and Wix `Asia/Singapore` |
| Jobs | succeeded 1, cancelled 3, queued 36 |
| Sync runs | succeeded 1, finished 2026-10-30 05:36:36 UTC |
| API partitions | 1 |
| Metric values | 2 |
| Backup runs | none |

No live Google, Search Console, Wix or SMTP call was made. Last successful sync is the job timestamp above, not “real time”.

## Not run

- `npm run db:backup` and `npm run db:restore-test`
- `npm run db:reset`
- Playwright after installing browsers
- Lighthouse on this working tree. `reports/page-speed-audit.md` describes an earlier local production build on port 3401. This tree cannot produce that build until GW-001 is fixed, so those scores are not reused as a pass.
- Keyboard-only and screen-reader passes
- Cross-role browser sessions (specialist, reviewer, read-only)
- Create, update, delete or export in the browser
- Dependency secret scanning beyond `git check-ignore` and `npm audit`

## Core Web Vitals

Not measured in this audit. The earlier laboratory note, if it still applies to a future successful build, reported mobile LCP under 2.5s on the pages it listed and CLS 0. That note is not evidence for this working tree.
