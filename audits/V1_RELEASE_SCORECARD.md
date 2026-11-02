# Genie Works V1 release scorecard

| Item | Value |
| --- | --- |
| Date | 30 October 2026, Asia/Singapore |
| Commit | `359502ce015d5b0555609a5311ff969b7c806a74` |
| Tree | Dirty working tree on `main`. Scores describe that tree, not `HEAD` alone. |
| App | Next.js 16.4.2 development server on port 3400, environment label `development` |
| Data | Shared Postgres in `ap-southeast-1`, read-only. Vitest on local embedded Postgres port 54339. |
| Enquiry source | Not configured |
| Recommendation | **NO-GO. 53 / 100.** |

Feature grades are 0–5. Category points equal the average of that category’s feature grades, divided by 5, times the category weight, then rounded to the nearest point. Unverified work cannot score 5. Deferred rows are omitted from the averages.

## 1. Functional completeness — 13 / 20

| Feature | Grade | Why |
| --- | ---: | --- |
| Agency Overview (D21) | 4 | Browser and SQL agree. Tests passed. Illustrative chart is labelled. |
| Client directory and registry | 4 | Services, file links and the specialist write failure are tested. Browser mutations were not run. |
| Website Analytics screens | 2 | Pages load and session totals stay blank. Sync has not produced a usable period. |
| SEO soft launch | 3 | Records, redirects and honest unavailable states. No consumer site was checked. |
| Blog core | 4 | Tests cover review and publish. Connected data has no live revision. Browser did not publish. |
| Leads list and follow-up | 2 | Code and fixture tests exist. Running app is disconnected. |
| Reports library and builder | 3 | Measurement rules passed. D14 states are not the stored states. Library is empty. |
| Settings that V1 actually keeps | 3 | Name and connections. Password and alerts correctly absent. |
| Admin users and audit | 3 | Session revoke is tested. Backup list is empty. |

Average 3.22 / 5 → 12.9 → **13**.

## 2. Security and permissions — 13 / 20

| Feature | Grade | Why |
| --- | ---: | --- |
| Database sessions and staff gate | 4 | Auth.js database sessions, 12-hour max age. Unsigned app routes returned 307. |
| RLS and role split | 4 | 81 database tests passed, including cross-client and specialist website denial. |
| Export and evidence routes | 4 | `canExport` and evidence permission checks are in code and unit tests. Not re-downloaded this audit. |
| Debug telemetry | 1 | Localhost ingest still runs in the layout, session, shell and database client. |
| Directory data in git | 1 | Real clinic contact backfill is in two migrations. |
| Development sign-in on the shared database | 2 | Magic-link page returned 200. Production code path is guarded, this process is not production. |
| Rate limiting and CSRF | 2 | No app rate limiter. Server actions are the mutation path. Export is an authenticated GET. |

Average 3.14 / 5 → **13**. The low grades are also P1 release blockers. They are not averaged away.

## 3. Data integrity and analytics — 7 / 15

| Feature | Grade | Why |
| --- | ---: | --- |
| Website association | 3 | Connections are keyed by website. Isolation tests passed. Live two-site run was not done. |
| Freshness | 1 | 36 jobs queued, 1 sync succeeded, home page blank. |
| Period comparison | 3 | Implemented for complete ranges. No complete live range was on screen. |
| Clicks versus enquiries versus bookings | 4 | Contract tests and home-page copy. |
| GSC timezone | 4 | Stored connections use `America/Los_Angeles`. |
| Missing data | 4 | Blanks and “Not yet synchronised”, not zeros pretending to be measured. |
| Double counting | 4 | Code and tests refuse adding GA4 and Wix. |

Average 3.29 / 5 → 9.9, reduced to **7** because freshness is unverified in the direction that matters: the flag is on and the queue is not draining. A high grade for the blank state must not be read as a grade for the pipeline.

## 4. Forms and enquiries — 5 / 10

| Feature | Grade | Why |
| --- | ---: | --- |
| Stored-submission totals | 2 | Implemented. Source not connected in the running app. |
| Follow-up statuses | 3 | Tested against the fixture pattern. Not clicked in the browser. |
| No second PII copy | 4 | No enquiry table in this database. History rows omit the message. |
| Notification failure keeps the enquiry | 4 | Fixture test passed. No mailbox. |
| Idempotency | 4 | Fixture test: same key does not insert again. |
| Authorised export | 3 | Unit test for the admin/manager gate. File not downloaded. |
| Form-builder screens | n/a | Removed by D20. |

Average of the six graded rows 3.33 / 5 → 6.7, reduced to **5** because the running environment cannot show a single enquiry. The architecture grade is higher than the release grade.

## 5. Integrations and publishing — 4 / 10

| Feature | Grade | Why |
| --- | ---: | --- |
| GA4 / GSC / Wix connections | 2 | Rows exist and secrets are server-side. Providers were not called. |
| Worker authentication | 4 | Wrong and missing bearers returned 401. |
| Scheduler | 0 | No cron in the repo. |
| Native blog publish | 3 | Tested in the database. No live revision in the app database. Clinic site does not call the API (D15). |
| SEO read API | 3 | Token tests passed. Bare request returned 404. No website was shown applying the payload. |
| Wix blog and Wix forms write | n/a | Excluded by D14. |
| Email delivery | 0 | This app does not send mail. Outbox retry is a row update. |

Average of the six graded rows 2.00 / 5 → **4**.

## 6. UI, UX and accessibility — 4 / 7

| Feature | Grade | Why |
| --- | ---: | --- |
| Desktop navigation | 4 | Nine V1 items, skip link, sidebar at 1440px. |
| Visual system | 4 | Pale ground and teal actions match the design-system direction. Tokens were not measured with a colour picker. |
| Empty and disconnected states | 4 | Home and blog say what is missing. |
| Narrow layout | 2 | 390px header overlap. No document-level horizontal scroll. |
| Keyboard and focus | 1 | Not completed. Focus was seen on the menu button only. |
| WCAG 2.2 AA | 1 | Not retested. Two `h1` elements on the desktop home page. An earlier Lighthouse file does not apply to a tree that fails to build. |

Average 2.67 / 5 → **4**.

## 7. Performance and stability — 2 / 5

| Feature | Grade | Why |
| --- | ---: | --- |
| Production build | 0 | Fails typecheck. |
| Dev server page loads | 4 | Signed-in module routes returned 200. |
| Core Web Vitals | 1 | Not measured here. |
| Debug work on the request path | 1 | Timing fetches on each shell render. |
| Query shape | 3 | Home page does not load enquiry bodies. Analytics backlog is operational, not an N+1 found in this pass. |

Average 1.80 / 5 → **2**.

## 8. Automated testing and code quality — 2 / 5

| Feature | Grade | Why |
| --- | ---: | --- |
| Vitest | 4 | 116 tests passed on the local database. |
| Typecheck and lint | 1 | Both failed. |
| Playwright | 0 | 2 tests did not launch. Browser binary missing. |
| Dependency audit | 4 | `npm audit --omit=dev` reported 0 vulnerabilities. |
| CI on pull requests | 1 | Tests run on GitHub release publish only. |
| Decision-record suite | 2 | 7 pass, DAY-01 fails as previously documented. |

Average 2.00 / 5 → **2**. The domain suite is green. Playwright did not run, and the build failed, so the category stays at that average.

## 9. Deployment and recovery — 1 / 5

| Feature | Grade | Why |
| --- | ---: | --- |
| Vercel project and env split | 1 | `vercel.json` build command only. No project link, no cron, build secret fallback `preview-build-only`. |
| Migrations | 3 | 35 applied on both databases, including both `0034` files. Seed is not idempotent. |
| Restore evidence | 0 | No `backup_runs` on the app database. Restore not run. |
| Monitoring and alerting | 0 | No health route, error tracker, or alert destination in the repo. |
| Rollback and owners | 1 | Handover still lists staging and named owners as open. |

Average 1.00 / 5 → **1**.

## 10. Documentation and handover — 2 / 3

| Feature | Grade | Why |
| --- | ---: | --- |
| Decisions D11–D21 | 4 | They are the usable spec. D21 matches the home page. |
| Staff SOP | 3 | `docs/GENIE_WORKS_V1_STAFF_SOP.md` is present and untracked. Not walked step by step. |
| Build status, handover, tracker | 1 | Still describe 19–28 October, including a blank Blog. |
| Environment docs | 2 | `.env.example` is ahead of `README.md`. |

Average 2.50 / 5 → **2** (weight 3 points: 2.50 / 5 × 3 = 1.5, rounded to 2).

## Total

13 + 13 + 7 + 5 + 4 + 4 + 2 + 2 + 1 + 2 = **53**.

Bands: 95–100 production candidate, 85–94 internal pilot candidate, 70–84 not ready, below 70 significant gaps. 53 is below 70.

Any failed mandatory gate overrides the number. Gates that fail today: open P1s, build, clean revision, enquiry source, analytics scheduler, backup evidence, and deployment separation. Detail: `audits/V1_GO_NO_GO.md`.

## Confidence

Medium for code, permissions tests, and the signed-in admin walkthrough. Low for live GA4, Search Console, Wix, email delivery, restore, keyboard access, and non-admin roles in the browser. Low-confidence areas were not given a passing grade.
