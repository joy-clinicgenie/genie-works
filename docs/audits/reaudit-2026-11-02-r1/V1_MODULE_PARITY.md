# Genie Works V1 module parity

Evidence grade is `grade / 5`, not a percentage of the module that is built. The tested tree is the uncommitted snapshot `db10022b0de6f78c1a747b59ef29535ce2a4d4ac`.

## Agency Overview

Routes: `/`. Decision: D21. Checks: FN-01, DA-01, DA-03, UX-04.
Grade: 3.

The production-mode home page rendered Agency Overview for an administrator. It did not show a live session total. The operations report on that process said there were no analytics connections. Staff scope follows membership. The page does not load enquiry message bodies.

| Feature | Expected | Observed | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| Current counts | Accessible clients, websites, sessions and enquiry follow-up | Fictional seed only | Partial | Signed-in `/` returned 200 | No live source |
| Missing data | Blank or an explicit notice | “no-connections” on the admin report | Pass | Operations JSON | Not shown as a provider zero |

## Client Management

Routes: `/clients`, `/clients/new`, `/clients/[id]`. Decisions: D6, D37. Checks: FN-02, SC-02.
Grade: 4.

The browser journey created, edited and archived a fictional client as admin. The manager can open creation. The specialist cannot. A fresh seed contains `clinic-genie` and `meridian-skin` only. Specialist A, the reviewer, the admin and the manager are Meridian members. Specialist B and the read-only account are not. Websites are created without `enquiry_key`.

| Feature | Expected | Observed | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| Create, edit, archive | Admin and manager | Passed in the browser | Pass | `clients.spec.ts` | None on that journey |
| Assigned access | D37 membership | Fresh `clinic_genie_b08` matched D37 | Pass | Membership query | A later committed test can add rows; that is not the seed |
| Website mapping | Stable key for enquiries | Key null after seed | Partial | Website query | RA-002 |

## Website Analytics

Routes: `/analytics` and the traffic and behaviour views under that area. Decisions: D13, D16, D25. Checks: FN-03, DA-01 through DA-05, IN-02, IN-03.
Grade: 2.

Fixture sync behaviour is largely implemented. One test did not run its assertion because the internal client has no website. The audit server had zero connections and said so. The remote application database, which this audit only read, has one succeeded run from 30 October 2026 and 69 queued jobs. Those jobs were not drained and were not compared with a provider.

| Feature | Expected | Observed | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| Supported metrics | Distinct measures, GA4 not added to Wix | Code and local tests | Partial | Passing analytics tests | No live pair of figures |
| Honest empty state | No fake zero | Audit server: no connections | Pass | Operations JSON | Remote queue not on that screen |
| Sync | A completed window or a safe error | Remote success is three days old; 69 queued | Blocked | Read-only aggregates | DEP-01 |

## SEO

Routes: `/seo` and the settings, redirects, tasks and checklist pages. Decision: D11, D12. Checks: FN-04, IN-01.
Grade: 3.

The soft-launch records and the read API exist. Bulk redirects, a crawler, direct Business Profile management, `llms.txt` and NLWeb stay deferred and were not failed for being absent. This run did not save a redirect in the browser. An SEO API call without a token returned 404.

| Feature | Expected | Observed | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| Settings and tasks | Persist for staff who can edit | Routes present; not walked | Partial | `/seo` 200 | No browser save |
| Deferred tools | Clearly not available | Still out of D11 | Out of the failure list | D11 | Do not build them under this audit |
| Consumer | A site applies saved values | Not observed | Blocked | DEP-07 | Token use is not authorised |

## Blog

Routes: the blog workspace and `/api/public/blog/...`. Decisions: D15, D28. Checks: FN-05, IN-01, SC-05.
Grade: 4.

The browser journey completed in-app review, protected preview and a published API read with a token. Wix blog publishing, scheduling and AI writing stay deferred. No clinic website rendered the article.

| Feature | Expected | Observed | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| Draft through publish | Native websites, approved roles | Journey passed | Pass | `blog.spec.ts` | Consumer site |
| Preview | Authenticated saved version | Journey passed | Pass | Same | None in-app |
| Public read | Token required | Missing token returned 404 | Pass | curl | DEP-07 |

## Leads and Forms

Routes: `/enquiries`, `/enquiries/[id]`, `/enquiries/notifications`, `/enquiries/export`. Decisions: D18, D19, D20, D31, D36. Checks: FN-06, EQ-01 through EQ-06.
Grade: 2.

Both connectors are described on one page. The native reader uses the enquiry database and refuses any target that fails the fixture guard when the process is production. On 2 November 2026 the default month hid the October fixture; an explicit October range showed `TEST-MS-NEW-004` to Specialist A. The Wix reader exists, and follow-up rows are specified without a stored message. Nothing in the application writes `enquiry_key` or a Wix instance and form id. The documented instance environment variables are not read.

| Feature | Expected | Observed | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| One page, two sources | Labels and separate rows | Copy is present; only the native fixture was readable | Partial | Page text and October search | RA-002 |
| Native list | Mapped to client, website and form | October range worked | Partial | Development server | Default month shows 0 |
| Wix list | Forms API for that website’s form | Not configured and not called | Partial | Code inspection | No binding path |
| Follow-up | New, Acknowledged, Closed | Not saved in this run | Partial | Tests refused to reset the shared fixture | EQ-03 |
| Export | Admin and manager, production rows | Production export 503; read-only denial passed | Partial | curl and browser | No successful fictional export in this run |

## Reports

Routes: `/reports`, `/reports/new`, `/reports/[id]`. Decision: D23, superseding D14’s four states. Checks: FN-07, SC-04, OP-03.
Grade: 3.

The browser saved a draft, confirmed status `draft`, then Save for review, confirmed status `saved`, and did not show Approved or Final. One JSON file appeared under the worktree `docs/report/`. A draft did not create a second file. An independent fictional file kept its name and bytes when a repeat write found the file already present. The logical database backup does not include that directory.

| Feature | Expected | Observed | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| Draft | No artifact | Status `draft`, then one file only after review save | Pass | `reports.spec.ts` and one JSON file | Local only |
| Saved JSON | Frozen version | Repeat write returned `created: false` and the old name remained | Pass | Artifact script | Not in `db:backup` |
| Retrieval | Authorised | The screen prints the file path | Partial | Report page | No HTTP retrieval |
| Hosted durability | Separate from local success | Not tested | Blocked | D23 names the repo folder | Serverless disk is not evidence |

## Settings

Routes: `/settings` and the analytics start and callback routes. Decisions: D14, D35 for secrets. Checks: FN-08, SC-03, SC-05.
Grade: 4.

Secret writes are administrator-only in the passing tests. The browser denied non-admin and signed-out Google starts before a provider request. The audit server had no provider credentials, by design.

| Feature | Expected | Observed | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| Profile | Staff can see their own settings | Page 200 for admin | Partial | Timing fetch | Profile edit not walked |
| Connections | Admin-only secrets | Denials passed | Pass | `roles.spec.ts` | No successful bind |

## Admin

Routes: `/admin` and `/api/internal/operations/status`. Decisions: D6, D29. Checks: FN-09, OP-03, OP-04.
Grade: 3.

Deactivation revoked the existing session. Unsigned operations status returned 401. The administrator body classified the production-mode process as local rehearsal, refused the enquiry fixture, reported no worker bearer and no backup on that database. Users can be created through the existing admin flows; this run relied on the seeded six staff accounts.

| Feature | Expected | Observed | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| Deactivation | Session ends | Journey passed | Pass | `deactivation.spec.ts` | None |
| Operational report | No secret values | JSON keys only | Pass | Admin fetch | Not hosted monitoring |
| Backup visibility | A recorded restore | Empty on the journey database | Partial | Operations JSON | The passing restore was on the other database |

## Source matrix

Resend is a historical source email provider. It is not an enquiry source. The platform sign-in URL is not a consuming clinic website.

| Source | Authorisation | Local fixture | Live read | Hosted | Notification | Blocker |
| --- | --- | --- | --- | --- | --- | --- |
| Wix forms | D31 and D36. No connection approved. Env names exist and are not read by code. | Binding test failed before follow-up. | Not called. | Not verified. | Labelled unavailable. No retry. No Genie Works sender. | RA-002, DEP-02 |
| Native enquiries | D18 and D36. Local fixture is not an approval. | October range showed one fixture row. Production mode refused it. | Not approved. | Not verified. | Fixture outbox only. Historical D32/D33 and D35 stay historical. | DEP-02, and the November window for the current fixture dates |
| Wix analytics | D25. No site named. | Fixture mode can refuse non-local hosts. Not used for a Wix call. | Not called. | Cron file only. | Not applicable. | DEP-01, DEP-04 |
| GA4 | D25. No property named. | One fixture test crashed on a missing internal website. Other fixture tests passed. | Not called. Remote database has an old succeeded run and 69 queued jobs. | Not observed. | Not applicable. | DEP-01 |
| Search Console | D13 and D25. Dates stay on Pacific time. No site named. | Not reconciled. | Not called. | Not observed. | Not applicable. | DEP-01 |
| Blog consumer | D15 and D28. Token use is not authorised. | In-app API read passed. Missing token returned 404. | No website rendered the article. | Not verified. | Not applicable. | DEP-07 |
| SEO consumer | D12 and D28. | Missing token returned 404. | No website applied a setting. | Not verified. | Not applicable. | DEP-07 |
