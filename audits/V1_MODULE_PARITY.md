# Genie Works V1 module parity

Audit date: 30 October 2026. Scope is the dirty working tree on `main` at `359502ce015d5b0555609a5311ff969b7c806a74`.

Grades: 0 missing, 1 UI only, 2 partial or mocked, 3 functional with important gaps, 4 working and covered by core tests, 5 release-ready with negative cases. This audit’s ceiling is 4. Nothing reached 5, because browser negative-role passes and live provider calls were not completed.

Out of scope, and not graded as missing: BL-15–BL-20, RP-05, D20 form builder (former LF-06–LF-09), D11 crawler / bulk redirects / GBP API / `llms.txt` / NLWeb, and D14 password storage plus inactive alert preferences.

## Agency Overview — 80%, grade 4

D21 replaces the older dashboard. The home page is `apps/platform/src/app/(app)/page.tsx` rendering `AgencyOverview` and `DashboardFilters`.

| Check | Status | Evidence |
| --- | --- | --- |
| Active clients, current snapshot, not changed by the client filter | Pass | Signed-in `/` showed 15 active clients. Read-only SQL: 18 clients, 15 active. |
| Linked websites | Pass | UI showed 13. Selection is wired in `page.tsx`. |
| Sessions from the analytics store, with comparison and blanks | Partial | UI said “Not yet synchronised” and “Awaiting data”. One API partition and two metric values exist. 36 jobs are queued. |
| Enquiry follow-up, production rows only, no contact fields | Partial | UI showed “—” and “Connection required”. SQL in `enquiry-counts.ts` excludes synthetic rows and personal columns. Source is unset. |
| Latest unfinished report | Pass | UI showed 0. `saved_reports` on the connected database returned no status groups. |
| Connection notices | Pass | Enquiry database not connected, plus websites not synchronised. |
| Client and period filters | Pass | Comboboxes “All clients” and “Last 30 days” rendered. |
| Illustrative chart | Partial | `ILLUSTRATIVE` series in `AgencyOverview.tsx` is drawn only with the caption that it is illustrative. |
| Tasks on the home page | Out of scope for D21 | Owners and deadlines remain in the task module. D21 does not put them on `/`. |

`packages/db/test/agency-overview.test.ts` and `apps/platform/src/lib/agency-overview.test.ts` passed inside the 116-test run. Browser role isolation was not repeated.

`HEAD` still imports deleted `LaunchDashboard` and reads `report_snapshots`. That committed page is not the page that was tested.

## Client Management — 75%, grade 4

Routes: `/clients`, `/clients/new`, `/clients/[id]`, `/clients/[id]/profile`.

| Check | Status | Evidence |
| --- | --- | --- |
| Clinic name, contacts, owner, active status | Pass in code and prior persistence tests | This audit did not create or edit a client. |
| Services as text, separate from channels | Pass | Migration `0024_client_services_files.sql`, `client-access.test.ts`. |
| Websites, domains, environments | Pass for global roles | Specialist write is denied in the action and in RLS. `permissions.test.ts` expects `RegistryRuleError` instead of a false “saved”. |
| Platform connections on the website | Partial | GA4, GSC and Wix rows exist. This audit did not bind a new property. |
| Notes and titled file links | Pass for the D14 rule | Links are `https` titles and notes, not file bytes. |
| Membership covers every website of the client | Pass | `client-access.test.ts`. Assignment is admin-only. |
| Browser create / edit / archive | Unverified | Not performed, to avoid writing the shared directory. |

The 28 October specialist false-success bug is not the current code path.

## Website Analytics — 40%, grade 2

Routes: `/analytics`, `/analytics/traffic`, `/analytics/behavior`, `/analytics/behaviour`. All returned HTTP 200 while signed in.

| Check | Status | Evidence |
| --- | --- | --- |
| Sessions, visitors, channels, comparisons | Partial | Live path exists behind `ANALYTICS_LIVE_REPORTS`. Connected database: 1 succeeded sync run, 1 `api` partition, 2 metric values. Home total is blank. |
| Campaigns | Fail | No campaign template in `packages/db/src/analytics/sync.ts`. |
| Devices and locations | Partial | GA4 templates exist. Wix does not. Not displayed from a fresh sync. |
| Contact clicks separate from enquiries, form starts and bookings | Pass in the metric contract | `analytics-measure.test.ts`. UI copy on the home page says counts are stored submissions, not clicks or bookings. |
| Last sync and errors | Partial | Jobs: 1 succeeded, 3 cancelled, 36 queued, none with `safe_error_code`. No in-repo cron. |
| Website separation and no GA4+Wix sum | Pass in tests | `refuseCombinedTraffic` and connection actions. Not re-run against two live properties. |
| Worker authentication | Pass | `POST /api/internal/analytics/worker` returned 401 with no header and with a wrong bearer. |

GSC time zone stored on connections is `America/Los_Angeles` (11 rows). GA4 and Wix rows use `Asia/Singapore`. That matches D13 for Search Console.

Seeded `ga4_export` snapshots remain the fallback for several behaviour measures when a live partition is missing. The home page did not present those snapshot sessions as the agency total.

## SEO — 60%, grade 3

Routes under `/seo` returned HTTP 200: overview, tasks, pages, redirects, site health, business profile, AI visibility, reports, settings.

| Check | Status | Evidence |
| --- | --- | --- |
| Search clicks, impressions, CTR, position on the SEO overview | Out of D11 scope | Performance reporting is backlog. Do not treat the overview as a live GSC dashboard. |
| Checklist, tasks, owners | Partial | Staff records. “Run check” stays disabled. |
| Titles, descriptions, canonical, indexable for Next.js | Partial | Stored and returned by `GET /api/public/seo/[websiteId]`. Unauthenticated call returned 404. No clinic site was shown consuming it. |
| Structured data editor | Out of D11 scope | UI says JSON-LD is not stored. |
| Individual 301 redirects | Partial | Supported for the read API. Bulk and pattern rules say they are unavailable. |
| Site health crawler | Out of D11 scope | Disabled control. |
| Business Profile | Partial | Staff-entered branch records. No GBP API, by D11 and D14. |
| AI visibility | Out of D11 scope | Page states NLWeb and `llms.txt` are not implemented. |
| Draft, preview, release batch | Partial | Page settings publish to the read API on save. Settings copy says batches, previews and rollback are not implemented. |
| Wix write-back | Out of scope | UI says publishing to Wix is unavailable. |

Demo number `120` still exists in `OverviewPanels.tsx` for an explicit demo mode. It was not confirmed on the signed-in overview during this pass.

## Blog — 75%, grade 4

Routes: `/blog`, `/blog/new`, `/blog/[id]`, previews, and `GET /api/public/blog/[websiteId]`.

D14/D15: native websites only. Wix publishing is refused. Performance is deferred.

| Check | Status | Evidence |
| --- | --- | --- |
| Statuses Draft, In review, Approved, Published, Archived | Pass in UI and schema | `/blog` showed those tabs, all 0 until a client and website are chosen. |
| Editor, SEO fields, alt text, versions, review before publish | Pass in `packages/db/test/blog.test.ts` | Suite passed. Browser editor was not used. |
| Publish writes `live_version_id` and sitemap API | Pass in tests | Connected database: 1 draft, 1 archived, `live_version_id` count 0. |
| Protected preview | Pass in tests | Not opened in the browser. |
| Clinic site actually rendering the article | Unverified | D15 says the clinic website does not call this API. Public blog URL without a token returned 404. |

The list copy states article performance is not part of this version.

## Leads and Forms — 45%, grade 2

Routes: `/enquiries`, `/enquiries/notifications`, `/forms` (redirects to Enquiries). All HTTP 200 while signed in. Home and notices say the enquiry database is not connected.

| Check | Status | Evidence |
| --- | --- | --- |
| Totals by client, website, form, source, with comparisons | Partial in code | `form-submissions.ts`. Not runnable while the URL is empty. |
| New, Acknowledged, Closed, including reopen, on the clinic-website row | Pass in `leads-forms.test.ts` and `enquiry-fixture.test.ts` | Not exercised in the browser. |
| No second copy of name, phone, email or message | Pass | No `enquiries` table in this database. History table has no those columns. |
| Notification sent / failed / retry, enquiry kept | Pass in the fixture test | `sent` means provider acceptance (D19). No live mailbox was called. |
| Export admin/manager, production rows, message omitted | Pass in `form-submissions.test.ts` | Not downloaded this audit. |
| Form builder, consent editor, routing proposal UI | Out of scope | D20. `/forms` opens Enquiries. |
| Duplicate idempotency key | Pass in the fixture test | A second insert with the same key does not create another enquiry. |
| Form starts, clicks and bookings mixed into enquiry totals | Pass as a refusal | Home copy and report-builder tests keep them apart. |

## Reports — 55%, grade 3

Routes: `/reports`, `/reports/new` returned HTTP 200. Connected database has no saved-report rows. Home showed “Reports in progress 0”.

| Check | Status | Evidence |
| --- | --- | --- |
| Library by client and period | Partial | Flat list. Website is stored (`0033_report_builder.sql`) and not shown as a library column. |
| Status Draft, In review, Approved, Final | Fail against D14 | Check constraint allows `draft` and `saved` only. |
| Traffic, search, enquiries from recorded figures | Pass in `report-builder.test.ts` | Clicks are not leads. Cost per lead stays blank unless cost and enquiry count both exist. |
| Blog performance section | Out of scope | Template lines render as not recorded. |
| Immutable approved file in the client workspace | Fail | Versions exist for “save for review”. Nothing marks Final. Client Reports tab is still the older snapshot screen. |
| Cross-client denial | Pass in RLS | `0014_saved_reports.sql` uses `app_can_access_client`. Browser cross-client download was not repeated. |

## Settings — 70%, grade 3

`/settings` returned HTTP 200.

| Check | Status | Evidence |
| --- | --- | --- |
| Display name | Pass by earlier reload test and current form | Not edited this audit. |
| Password | Out of scope | D5/D14. Page says no password is stored. |
| Notification preferences | Out of scope until an alert exists | D14. Page lists them as outside Genie Works. |
| Timezone and default ranges | Resolved as fixed | D8/D14: Asia/Singapore and the existing period control. Not a user setting. |
| Website connections | Partial | UI exists. Secrets are server-side. D14 says credentials are admin-only; `canManageRegistry` also allows a manager. |
| Last sync on the settings row | Partial | Connection `verified_at` is not a successful job time. |

## Admin — 60%, grade 3

`/admin`, `/admin/users`, `/admin/audit`, `/admin/backups` returned HTTP 200 for the signed-in admin. Unsigned `/admin` returned 307.

| Check | Status | Evidence |
| --- | --- | --- |
| Create staff for the existing sign-in method | Partial | D14: invite creates the staff row and does not send mail. Not executed. |
| Deactivate and revoke sessions | Pass in `permissions.test.ts` | The test commits, then restores the fictional specialist, on the local database only. |
| Audit log append-only, no enquiry body | Pass in tests and schema | Export metadata can include filters. Message body is not a column. |
| Backup status | Fail for evidence | `backup_runs` on the connected database is empty. Restore was not run. |
| Retention and deletion | Out of scope until a policy exists | D14. Settings says deletion is unavailable. |
| Monitoring of failed sync | Partial | Job rows exist. Admin does not show the 36 queued jobs as an operated queue. |

## Extra routes, not V1 shell items

Still implemented and not in the left menu: tasks, approvals, issues, timeline, Google Ads, medical review. They are legacy agency modules from D1. They are not V1 release criteria and were not scored.

## Integrations inventory

| Integration | In this repo | Observed |
| --- | --- | --- |
| GA4 | OAuth, encrypted secrets, worker | 1 connected row. Not called live. |
| Google Search Console | Same | 10 connected, 1 disconnected. Not called live. |
| Wix analytics | 62-day window in code | 1 connected row. Not called live. |
| Enquiry database and outbox | Read and status update only | Environment variable empty. |
| Transactional email | Not sent from this app | Outbox lives in the clinic-website database. |
| Public SEO and Blog APIs | Bearer token, read-only | 404 without a token. |
| Vercel cron | Absent | `vercel.json` has no `crons`. |
