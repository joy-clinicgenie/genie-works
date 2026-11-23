# Analytics Phase 2.3: provider integration and live data validation

> **Renumbered 23 Nov 2026** when this work moved onto `main` (branch `analytics-phase2`): migrations `0046_analytics_scheduling` and `0047_analytics_worker_invocations` in this record are now `0053` and `0054`, because main already used 0046 and 0048–0052. Decisions are cited by their new numbers D68–D72.

Date: 13 November 2026, Asia/Singapore.
Decision: D70 in `docs/DECISIONS.md`.
Branch: `analytics-phase1-closure`, working tree only. Nothing is committed, pushed, deployed or scheduled.

**Result: no live GA4, Search Console or Wix API request was made, because no authorised non-production provider access exists anywhere. Everything that could be validated without one was: the adapters were checked against the providers' current documentation, six real defects and gaps were fixed locally, and a bounded validation harness was built, tested and run against the fictional provider so the live run is a single command once access is granted. Live validation is the open item.**

**Update, 13 November 2026 (Phase 2.3A, `ANALYTICS_PHASE_2_3A_IMPLEMENTATION.md`):** three findings below are resolved. The privacy filter no longer withholds ordinary clinic keywords and pages, and it now also covers GA4 page dimensions that were stored unchecked; the two GA4 users measures are labelled apart (Total users, New and Returning active users) with no number changed; and a property can no longer be connected under a second client without a recorded reason. This report is otherwise as written.

## How to read this report

Every claim carries one of these labels.

| Label | Meaning |
| --- | --- |
| **[L]** | Verified against a live GA4, Search Console or Wix API. **Nothing in this report has this label.** |
| **[F]** | Verified using the fictional provider (local, consistent by construction). Proves our logic, not the provider's behaviour |
| **[D]** | Verified against the provider's official documentation, read on 13 November 2026 |
| **[C]** | Verified by reading our code |
| **[V]** | Verified by a read-only check of Vercel configuration or the deployed production URL. Not provider data |
| **[N]** | Not verified |

## 1. Executive summary

| Question | Answer |
| --- | --- |
| Was any live provider data fetched? | **No.** The local environment has no Google client, Wix app or token key. Preview has none either. Connection tokens exist only in the production database, encrypted under the production key, and belong to real clinics. Using them is not authorised, so I did not |
| Is the environment safe to continue? | Development is isolated **[C][F]**. Phase 1 is still a conditional pass: the secrets backup file still exists, the editor-history decision is open, and the work is uncommitted |
| What was fixed locally? | Six defects (section 10): GA4 quota never requested; non-numeric provider values stored as NaN; GA4's own warnings ignored; a short page could end paging early; no truncation record; rows withheld by the privacy filter unaccounted |
| What is a finding but not changed? | The privacy filter withholds ordinary clinic queries and pages (7 of 10 sample queries); Wix `timeZone` is never sent; the two "users" figures use different GA4 metrics; the schema lets one property be bound to two clients; GA4 dates follow the property's time zone, which we never compare |
| Can the live run be done safely? | Yes. `npm run analytics:validate` makes at most 14, 8 and 4 requests for GA4, Search Console and Wix, runs the real pipeline into the local database (rolled back), writes numbers only, and refuses without an exact confirmation |
| Should a daily-fact store be built? | **No, not on present evidence** (section 10.1): it would not reduce the request count |
| Production state | Root Directory is `apps/platform`; **zero schedules are registered** **[V]**; the deployed worker route rejects a missing or wrong bearer **[V]** |

Tests: `packages/db` 40 files, 298 passed; `apps/platform` 22 files, 135 passed; typecheck, lint and decision tests all clean (section 12).

## 2. Provider connection validation

### 2.1 Environment readiness, checked before any request

| Check | Result |
| --- | --- |
| Development uses the isolated local database | **Yes** **[C]**. `DATABASE_URL` and `DATABASE_ADMIN_URL` are `127.0.0.1:54339`, database `clinic_genie`. `.env` is git-ignored and untracked. The Phase 1 and 2 guard tests pass |
| Phase 1 conditions | **Not closed.** `~/.genie-works-secrets/genie-works-env-backup-2026-11-12.env` still exists (I checked that it exists; I did not open it). The editor-history decision is open. Nothing is committed (last commit `15162ad`) |
| Preview does not read production records | **[N] independently.** Proving it needs both `DATABASE_URL` values, which are hidden secrets I did not read. Phase 1 addenda 3 to 7 record a separate Neon database for Preview and an owner-confirmed sign-in. The Preview scope does list its own `DATABASE_URL` and `PREVIEW_*` entries **[V]** |
| Vercel Root Directory | **`apps/platform`** **[V]**. The root `vercel.json` (and its schedule) is therefore not read. Confirms the Phase 2.1 finding |
| Vercel schedules | **0 registered in production** **[V]** (`vercel schedules list`: "Found 0 schedules in namespace default") |
| Exposed credentials in the working tree | None found **[C]**. A scan of tracked and untracked files for Google, GCP and private-key patterns and for database URLs on hosted domains matched only `packages/db/test/database-environment.test.ts`, which holds fixtures at `.example.test` hosts. Reported by file name only |
| Worker authentication on the deployed production URL | A call with no bearer on GET and on POST, and with a wrong bearer on GET, returns **401 `{"error":"Unauthorized"}`**, the route's own body **[V]**. No credential was sent and no job can run without one |

### 2.2 Environment variables, by name only (values were never displayed)

| Variable | Production | Preview | Local `.env` |
| --- | --- | --- | --- |
| `ANALYTICS_GOOGLE_CLIENT_ID`, `_SECRET` | present | **absent** | empty |
| `ANALYTICS_WIX_APP_ID`, `_SECRET` | present | **absent** | empty |
| `ANALYTICS_TOKEN_KEY` | present | **absent** | empty |
| `CRON_SECRET` | present | **absent** | empty |
| `ANALYTICS_WORKER_SECRET` | absent (the cron bearer suffices) | absent | empty |
| `PAGESPEED_API_KEY`, `ANALYTICS_LIVE_REPORTS` | present | absent | `ANALYTICS_LIVE_REPORTS` set |

Preview therefore cannot decrypt a connection token, refresh a Google token or authenticate the worker. A live validation through a Preview deployment would first need Preview-only values for these, including a **new** token key that is not production's. The harness avoids that by running locally with one short-lived access token.

Two observations. The `PREVIEW_*` database variables are listed as type `Config`, not `Secret`; the CLI showed an opaque encoded value, which I did not decode. Marking them sensitive is worth doing. And the local `.env` template names a `FORMS_TEST` Wix instance (empty here). Whether a Wix test site exists, and whether it could serve for analytics, is **[N]**.

### 2.3 Property association

| Item | Finding |
| --- | --- |
| Scopes requested | `analytics.readonly` and `webmasters.readonly` only **[C]**: read-only, least privilege |
| GA4 property id | Must be 4 to 12 digits, and the request path is `properties/<id>` **[C]**. Whether the id belongs to the intended website's data stream is **[N]** (needs the Admin API) |
| Search Console property | `sc-domain:` or URL-prefix site, URL-encoded into the path **[C]**. The read-only audit compares its host with the website's host |
| Wix | One site per connection, authorised by the instance token **[C]** |
| **Gap** | The unique index is `(website_id, provider, external_property_id)` **[C]**, so the same GA4 property, Search Console site or Wix site **can be bound to two different clients**, and nothing detects it. A test creates exactly that **[F]** |
| Audit | `npm run analytics:audit -w @clinic-genie/db` (new, read-only). It reports a property connected to more than one website, a Search Console property whose host is unrelated to the website, a missing time zone, and a connection with no stored token. It prints counts and eight-character hashes only. Not run against production **[N]** |

## 3. GA4 findings

| Brief item | Status | Evidence |
| --- | --- | --- |
| Correct property association | Partly | See 2.3. Stream check **[N]** |
| Valid dimensions and metrics | **Yes** | All 16 names we use (`sessions`, `totalUsers`, `activeUsers`, `engagementRate`, `bounceRate`, `averageSessionDuration`, `screenPageViewsPerSession`, `screenPageViews`, `userEngagementDuration`; `date`, `sessionDefaultChannelGroup`, `landingPage`, `deviceCategory`, `country`, `pagePath`, `newVsReturning`) appear in Google's published schema **[D]**. That confirms the names, not that a given property returns them **[N]**. `checkCompatibility` is satisfied by our own earlier request, so it cannot catch a rejected field; a 400 would fail the job **[C]** |
| Sessions | Daily rows added across days; range total fetched separately. The harness compares the two | **[F]** match. **[N] live** |
| Distinct users | `totalUsers` is fetched for the exact range and never added across days (D13) **[C]**. **Finding:** the headline Users figure uses `totalUsers`, but the Behaviour page's pages and new-or-returning figures use `activeUsers`. Google defines them differently: `activeUsers` counts distinct users who visited, `totalUsers` counts users who logged any event **[D]**. The platform shows two different "users" without saying so. Not changed (a definition decision) |
| Channel grouping | `sessionDefaultChannelGroup`; bundle-derived windows equal direct windows **[F]**. Live **[N]** |
| Landing pages, devices, countries | 90-day bundles. Live row counts are what the harness will record, because the landing bundle (90 days × pages) is the likeliest to exceed one page **[N]** |
| Engagement and bounce | `bounceRate` is (sessions − engaged sessions) ÷ sessions, a fraction **[D]**, so `engagementRate + bounceRate = 1`. The harness checks it **[F]**. Live **[N]** |
| Date and timezone | **Gap, now recorded.** GA4 dates follow the property's time zone, which the response reports in `metadata.timeZone` **[D]**. We stored our own setting (`provider_timezone`) and never compared it. The pull now records `providerTimeZone` and, if different, `timezoneMismatch` beside the report **[F]**. Separately, the pages' presets use the Singapore calendar (D8, D52) while GA4 windows are read in the property's zone. For a property outside Singapore a window ending "yesterday" can be a day off at the edge **[C]**. Not changed |
| Zero-session days | A recorded zero is stored as 0; a day GA4 never returned is absent and unavailable **[F]** (test). Whether live GA4 returns zero days with `keepEmptyRows` is **[N]**; Google says rows with all-zero metrics are not returned unless it is set, and that only recorded data can appear **[D]** |
| Incomplete periods | Coverage is `partial` for the provider's current day **[C][F]** (Phase 2.1). GA4 and Wix windows are treated as settled only 48 hours after they end; that figure is an assumption **[N]** |
| Pagination | `limit` 10,000, `offset`, at most 20 pages **[C]**. Google's maximum is 250,000 rows a request **[D]**. **Fixed:** the loop ended on any short page; it now also compares with `rowCount` ("total rows in the result, independent of limit and offset" **[D]**) and keeps reading if more remain **[F]**. Reaching the page cap with more to read is now recorded as `truncated` **[F]** |
| Quota | **Fixed.** The request never set `returnPropertyQuota`, so the quota Google can report was never returned and the code that read it always saw nothing **[C]**. Google documents the field as "toggles whether to return the current state of this property's quota" **[D]**. It is now set **[F]**. Live consumption **[N]** |
| Sampling, thresholding, "(other)" | **Gap, now recorded.** `metadata.dataLossFromOtherRow`, `subjectToThresholding` and `samplingMetadatas` exist **[D]** and were ignored. They are now stored in the report's quality record and change no number **[F]** |

## 4. Google Search Console findings

| Brief item | Status | Evidence |
| --- | --- | --- |
| Property mapping | URL-encoded property in the path; host audit for mismatch | **[C][F]**. Live **[N]** |
| Clicks, impressions | Daily rows added | **[F]** match. Live **[N]** |
| CTR, average position | CTR = clicks ÷ impressions; position = impression-weighted average of daily positions; never summed or averaged plainly **[C][F]**. Google describes position as the highest placement per query averaged across impressions **[D]**, which supports weighting but does not prove daily-weighted equals the range figure **[N]** |
| Queries, pages, dates | `type: "web"`, dimension `query`, `page`, `date`, `dataState: "final"` **[C]**. Google's reference says **`searchType` is the deprecated field**, so our `type` is correct **[D]** (I had recalled it the other way round and checked) |
| Pagination | `rowLimit` 25,000, `startRow`; Google's own loop reads until a response has 0 rows **[D]**. Ours stops at a short page **[C]**, which is equivalent unless the API returns a short page mid-result **[N]** |
| Truncated results | Google exposes at most 50,000 rows a day per search type, sorted by clicks, and "does not guarantee to return all data rows but rather top ones" **[D]**. **Fixed:** hitting our page cap with more to read is now recorded as `truncated`; before, a list could be silently incomplete **[F]** |
| Final versus incomplete | `dataState: "final"` is the documented default: only finalised data **[D]**. Windows end three Pacific days back **[C]**. The size of the real delay and whether `final` data can still change **[N]** |
| Reporting delays, retention | Data retention (the commonly cited 16 months) **[N]**: Google's pages I could read did not state it. The longest window we read reaches back 180 days |
| Daily-derived against direct totals | **[F]** match to the unit. **[N] live.** This is the comparison the brief warns about. The harness records both numbers and the absolute and percentage difference for 7 and 30 days, for clicks, impressions, CTR and position. **If they differ live, both are preserved and the recommendation is to store the direct property total for those windows** (section 10) |
| Row lists against the total | Pages and queries rows are compared with the property total as `expected_difference`: lists are top-N, anonymised queries are not listed (**[N]**: I could not confirm this from the pages I could read), and the privacy filter removes rows |
| **Privacy filter drops ordinary rows** | **Finding, with accounting added.** `safeSearchQuery` and `safeAnalyticsPath` reject any text containing words such as `name`, `tel`, `phone`, `mobile`, `message`, `patient`, `symptom`, `email` **anywhere**. Of ten ordinary clinic queries, seven are withheld ("symptoms of gum disease", "mobile dentist near me", "hotel near dental clinic" because of `tel`, "patient reviews dentist", ...); of six site paths, four ("/for-patients", "/patient-reviews", ...) **[F]**. Those rows were dropped without a trace, so lists and totals could not be reconciled. **Fixed:** the count, clicks and impressions withheld are now stored in the report's quality record **[F]**. The filter itself is unchanged: it is a privacy control and loosening it is your decision |

## 5. Wix Analytics findings

| Brief item | Status | Evidence |
| --- | --- | --- |
| Endpoint, measures | `GET /analytics/v2/site-analytics/data`; `TOTAL_SESSIONS`, `TOTAL_UNIQUE_VISITORS`, `CLICKS_TO_CONTACT`, `TOTAL_FORMS_SUBMITTED` all exist in the enum **[D]** |
| Native definitions | "Total sessions": site visits, a session ends after 30 minutes of inactivity. "Total unique visitors": distinct individuals, each counted once regardless of visits. "Clicks to contact": sessions where a visitor clicked to contact via WhatsApp, phone or email, **not including form submissions** **[D]**. Kept as Wix's own; the platform never adds Wix and GA4 traffic and never sums Wix visitors across days **[C]** |
| Reporting period | Wix stores 62 days; a `startDate` more than 61 days back is an error **[D]**. Our window starts 61 days before today **[C]** |
| End date | The end date is exclusive ("`2024-01-01` to `2024-01-03` returns the 1st and 2nd") **[D]**. We send the inclusive end plus one day **[C]**, which is correct. A test pins it **[F]** |
| **`timeZone` parameter** | The endpoint accepts `timeZone` **[D]**. **We never send it**, so day boundaries follow whatever Wix defaults to, which is not stated in what I read **[N]**. The connection stores a time zone (`Asia/Singapore`) that this request ignores. The harness requests the same window with and without it and reports how many days change. Not changed: it would alter which sessions fall on which day |
| Zero values | A missing value has always been read as 0. Whether Wix omits zeros or returns them is **[N]**. **Fixed:** a value present but not a number is dropped, not stored as NaN **[F]** |
| Pagination and limits | One request, at most 100 values per measure, 62 days fits **[D]**. Rate limits are not stated on the page I read **[N]** |
| Website-specific mapping | One connection per website with its own instance token **[C]**. All ten Wix sources preserved. Live **[N]** |
| Contact clicks, forms | Fetched and stored with the other measures **[C][F]**. The live bundle shows sessions only; contact clicks and form submissions are stored but not on this page **[C]** |
| Internal consistency | The harness compares the sum of daily values with the API's own `total` for each measure: sessions, contact clicks and forms should equal it; unique visitors should not (distinct visitors are not additive), and that gap is reported as `expected_difference` **[F]**. Live **[N]** |

## 6. Direct versus derived comparisons

**[F] only.** The fictional provider is consistent by construction, so every derived value matches. This proves the comparison, derivation and reporting logic, and proves that a real discrepancy is reported (a test makes the range total two short and the harness returns `differs`, absolute 2, 10.5%).

| Provider | Comparisons | Match | Expected difference | Differs | Requests | Evidence file |
| --- | --- | --- | --- | --- | --- | --- |
| GA4 | 7 | 7 | 0 | 0 | 10 of 14 | `docs/audits/evidence/ANALYTICS_PHASE_2_3_FICTIONAL_ga4.json` |
| Search Console | 12 | 8 | 4 (row lists against total) | 0 | 5 of 8 | `..._gsc.json` |
| Wix | 5 | 4 | 1 (distinct visitors) | 0 | 3 of 4 | `..._wix.json` |

The comparisons run:

- GA4: sum of daily sessions against a direct range request (7 and 30 days); bundle-derived channel windows against direct channel reports; channels added up against the range total; engagement rate plus bounce rate equals one.
- Search Console: derived clicks, impressions, CTR and position against the property total (7 and 30 days); sum of page rows and of query rows against the total.
- Wix: each measure's sum against the API total; sessions with and without `timeZone`.

**Live: [N]. Tolerance is a stated assumption**, 0.5% for additive counts and 0.1% for ratios, and any gap above it is reported as `differs` with both numbers, never altered.

The reconciliation steps in the brief map to the harness as follows: fetch a small fixed window (step 1: a 7- and 30-day window ending after settling, the 180-day bundle exactly as production fetches it); store in the isolated database (step 2: the local database, rolled back); run the existing reader (step 3: `publishedReport` reads what the pipeline published); compare (steps 4 and 5); a difference is recorded with its quality record for investigation (step 6); data stays with the correct website and client (step 7: tested, nothing is stored for a second clinic).

## 7. Request latency measurements

**No live latency exists [N].** The Phase 2.2 capacity figures therefore still rest on assumed 1, 2 and 4 second requests.

What was measured is our own cost, from the fictional evidence **[F]**: a job takes 2 to 10 ms end to end locally (the 180-day bundles are the slowest, 8 to 10 ms for 360 and 180 rows). That is parse, derive, store and publish, with no network.

The harness records, for every request it makes: provider, template, period, job duration, slowest single round trip, HTTP status, rows, pages, whether a retry was needed, quota tokens where the provider reports them, and any warning from the report. It does not record a token, a body, a property id or a site URL. A test asserts none of those can appear. `npm run analytics:validate -w @clinic-genie/db -- --provider ga4 --fictional` shows the shape; the live evidence has the same form.

Planned live cost: 14 GA4, 8 Search Console and 4 Wix requests, 26 in all, against the 160 of a full day. The full workload is not run.

## 8. API limits and pagination findings

| Limit | Value | Source | Our behaviour |
| --- | --- | --- | --- |
| GA4 rows per request | default 10,000, maximum 250,000 | **[D]** | We use 10,000; up to 20 pages (200,000 rows), then `truncated` |
| GA4 quota | Reported only when `returnPropertyQuota` is set | **[D]** | Now set |
| GA4 daily and hourly token limits, concurrency | 200,000 a day, 14,000 an hour per property, 10 concurrent | From Phase 2.1; not re-read | **[N]** this phase |
| Search Console rows per request | 1 to 25,000, default 1,000 | **[D]** | 25,000 |
| Search Console rows per day | 50,000 per search type, sorted by clicks | **[D]** | Not enforceable; `truncated` records only our own cap |
| Search Console query rate | 1,200 a minute per site; 40,000 a minute and 30,000,000 a day per project | **[D]** | One request at a time; far below |
| URL Inspection | 2,000 a day and 600 a minute per site | **[D]** | Maintenance pass is once a day (D69) |
| Search Console load quota | 10-minute and 1-day chunks; after exceeding the short-term one, wait 15 minutes | **[D]** | A 429 is retried with backoff and pauses the connection (D68) |
| Wix history | 62 days; start more than 61 days back is an error | **[D]** | Window starts 61 days back |
| Wix values per measure | at most 100 | **[D]** | 62 fits |
| Wix rate limit | not stated on the page read | **[N]** | 429 handling is generic |

## 9. Data accuracy risks

Ranked by what could put a wrong or missing number in front of a person.

1. **Privacy filter drops ordinary pages and queries without a trace** (now counted). Lists look complete and are not. High.
2. **Two different "users" figures** on the analytics pages. Medium; a labelling or definition decision.
3. **Search Console derived totals unproven live.** The brief is right that daily rows need not equal the provider total. If they differ, the derived `gsc.totals` would be wrong by that amount. Medium until measured.
4. **GA4 property time zone is not compared** (now recorded) and presets use the Singapore calendar. Low if all properties are in Singapore time; unknown **[N]**.
5. **Wix day boundary unknown** because `timeZone` is not sent. Low to medium.
6. **One property can be bound to two clients.** Not detected anywhere. Medium; cheap to audit, and a unique index across clients would prevent it (a schema change, not made).
7. **GA4 thresholding, sampling and "(other)" rows** were invisible and are now recorded. They affect low-traffic properties most, which includes small clinics.
8. **A reused window** (section 5 of the Phase 2.2 report) assumes settling times **[N]**.
9. **Non-numeric provider values** could be stored as NaN and shown as available. Fixed.
10. **Truncated lists** presented as complete. Fixed (recorded).

## 10. Recommended changes

Fixed locally in this phase (safe, tested, no metric meaning changed):

| # | Change | Where |
| --- | --- | --- |
| 1 | Request GA4 property quota | `providers/ga4.ts` |
| 2 | Non-finite provider numbers are dropped, never stored | `ga4.ts`, `gsc.ts`, `wix.ts` |
| 3 | Record GA4's time zone, thresholding, sampling, "(other)" rows and row count; flag a time zone mismatch | `ga4.ts`, `sync.ts` |
| 4 | Use `rowCount` so a short page cannot end paging early | `sync.ts` |
| 5 | Record `truncated` at the page cap (GA4 and Search Console) | `sync.ts` |
| 6 | Count rows, clicks and impressions the privacy filter withholds | `sync.ts` |

Not changed; each needs your decision:

| # | Recommendation | Why it is yours |
| --- | --- | --- |
| A | Narrow the privacy filter to whole words and exact segments, or review withheld rows | It is a privacy control. Loosening it changes what patient-adjacent text can be stored |
| B | Pick one users metric for the page, or label both | Changes a number people see |
| C | Send `timeZone` to Wix, after the live comparison shows what changes | Changes which sessions fall on which day |
| D | Store the direct property total for Search Console windows if live totals differ from derived ones | Changes the Phase 2.1 derivation |
| E | Add a unique index across clients on `(provider, external_property_id)`, after the audit is clean | Schema change |
| F | Show "withheld" and "truncated" on reports | UI change; the brief forbids redesign |
| G | Mark the `PREVIEW_*` variables sensitive | Vercel configuration |
| H | Compare GA4 property time zone with Singapore when connecting | Changes the connect flow |

### 10.1 Evaluation: a reusable daily-fact store

**Recommendation: do not build it now.** The evidence, by the brief's headings:

| Heading | Assessment |
| --- | --- |
| API request savings | **None.** At steady state the plan is 100 jobs a day (Phase 2.2). Of those, 25 are additive and could in principle come from stored days: GA4 daily sessions and four bundles (5), the Search Console bundle (10 connections) and the Wix window (10). The other 75 (GA4 distinct users and rate reports, Search Console pages and queries) are not additive and cannot be rebuilt from daily rows. Each of the 25 is already **one request**, and a store still needs one request a day to learn the newest days. So the request count stays 100 |
| What it would save | Rows and bytes per request: a 180-day bundle would fetch about 3 days instead (roughly 60 times fewer rows), and a 90-day bundle about 30 times fewer. That matters only if a request needs extra pages. The landing-page bundle (90 days × pages) is the single case that could. Its live row count is unknown **[N]**; the harness measures it |
| Data accuracy | Worse or equal. GA4 revises for about two days and Search Console `final` lags three, so the last few days must be fetched again anyway; a merge adds a second place for a stale day to hide. Reconciliation is currently a direct comparison with an exact-window request; with a store it needs its own check |
| Database storage | One row per day, per dimension value, per metric. For 21 sources that is small for channels and devices; for landing pages it grows with the number of distinct pages and cannot be sized without live row counts **[N]** |
| Retention | Partitions are kept as they are today. A store would need a policy; Search Console's own retention is **[N]** |
| Reporting-period support | Already exact by window. A store adds derivation at read time, which the readers do not do |
| Schema changes | A new table for daily facts with row level security and a backup entry, a change to the derivation code, and read-path changes |
| Migration complexity | New migration plus a backfill from existing partitions, or a re-fetch of history |
| Rollback | Drop the table and revert the derivation; partitions are untouched, so the rollback is clean |

Reconsider if the live run shows the landing bundle needs more than about 3 pages, or if measured latency makes 100 jobs a day tight. Neither is knowable today.

## 11. Exact files modified

New:

| File | Purpose |
| --- | --- |
| `packages/db/src/analytics/validation.ts` | Measured job runner, comparisons, GA4, Search Console and Wix plans, evidence assembly, association audit |
| `packages/db/scripts/analytics-live-validate.ts` | Validation command with its guards |
| `packages/db/scripts/analytics-association-audit.ts` | Read-only association audit command |
| `packages/db/test/analytics-provider-validation.test.ts` | 26 tests |
| `docs/audits/evidence/ANALYTICS_PHASE_2_3_FICTIONAL_{ga4,gsc,wix}.json` | Sample evidence, fictional |
| this report | |

Changed:

| File | Change |
| --- | --- |
| `packages/db/src/analytics/providers/ga4.ts` | `returnPropertyQuota`; metadata, row count, non-finite values |
| `packages/db/src/analytics/providers/gsc.ts` | Invalid rows dropped and counted |
| `packages/db/src/analytics/providers/wix.ts` | Non-finite points dropped |
| `packages/db/src/analytics/sync.ts` | `MAX_PROVIDER_PAGES`, quality record, `rowCount` paging, truncation, withheld accounting |
| `packages/db/src/testing/fictional-analytics-provider.ts` | Rates, API totals, and breakdowns consistent with the range total |
| `packages/db/src/index.ts`, `packages/db/package.json` | Exports; `analytics:validate`, `analytics:audit` |
| `.env.example`, `docs/ENVIRONMENT.md`, `docs/DECISIONS.md` (D70), `docs/BUILD_STATUS.md` | Documentation |

No migration, no UI change, no change to `vercel.json`, to any metric definition or to any Phase 1 or 2 safeguard. The only change to stored data is extra keys inside the existing `quality` JSON of newly written partitions.

## 12. Test results

Environment: `ANALYTICS_FIXTURE_MODE=1`, hosted enquiry URLs blanked, local database.

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, all workspaces |
| `npm run lint` | exit 0 |
| `npm test` in `packages/db` | **40 files, 298 passed, 0 failed** (Phase 2.2: 39 files, 272) |
| `npm test` in `apps/platform` | **22 files, 135 passed, 0 failed** (unchanged) |
| `npm run test:decisions` | 8 passed, 0 failed |
| `npm run analytics:validate -- --provider {ga4,gsc,wix} --fictional` | all three completed within their request caps |
| CLI guard checks | plan-only by default; `--live` refused without the token, property id and exact confirmation; refused under fixture mode; a non-local database refused; local audit ran read-only |
| `npm run db:migrate:status` | `Applied: 48, Pending: none` (no new migration) |

The 26 new tests cover: the quota flag; GA4 metadata, quota and row count; non-numeric values; time zone mismatch, thresholding and sampling recorded; truncation at the page cap; paging by `rowCount`; zero day against missing day; Search Console invalid rows, withheld accounting, the privacy-filter finding and truncation; Wix missing and invalid values; zero, missing and failed kept apart (including a 503 that stores no report and a real empty answer that stores an empty one); the harness for all three providers; a deliberate discrepancy being reported; the request cap; evidence containing no secret; cross-client isolation; the association audit; read-only behaviour; and Postgres accepting `NaN` as at least zero.

**Not completed:** every live test. `next build` was not run (no route changed).

## 13. Outstanding access requirements

Nothing below has been requested or used.

| Need | Exact access | Who |
| --- | --- | --- |
| GA4 live validation | A **non-client** GA4 property that Clinic Genie owns (a test site is enough), and a short-lived OAuth access token for an account with read access, scopes `analytics.readonly` only | You |
| Search Console live validation | A **non-client** verified site, read access, `webmasters.readonly` token | You |
| Wix live validation | A Wix site Clinic Genie owns, and an access token for the analytics app. The forms test site may qualify | You |
| Authorisation | Written approval to make up to 14, 8 and 4 read-only requests, and to keep numbers-only evidence in the repository | You |
| Production association audit | `npm run analytics:audit` against a restore-point branch, or the production `DATABASE_URL` for one command with `ANALYTICS_AUDIT_REMOTE_CONFIRM` set. It reads in a read-only transaction | You |
| Production queue inventory | `npm run analytics:recover` against the same restore point (Phase 2.2) | You |
| Preview-based validation (optional) | Preview-only values for the Google client, Wix app, a new token key and `CRON_SECRET` | You |

The command, once you have a token: `VALIDATION_ACCESS_TOKEN=… VALIDATION_PROPERTY_ID=… VALIDATION_CONFIRM=read-only-nonproduction:<provider>:<today UTC date> npm run analytics:validate -w @clinic-genie/db -- --provider <ga4|gsc|wix> --live --out <file>`. Run it without `ANALYTICS_FIXTURE_MODE`.

## 14. Production activation blockers

1. **No live validation.** Derived Search Console totals, GA4 window parity, live latency, live row counts and Wix day boundaries are all unmeasured.
2. **Root Directory is `apps/platform`**, so no schedule can fire **[V]**.
3. **Zero schedules registered** **[V]**. Expected, but nothing runs.
4. **Phase 1 not closed**: secrets backup, editor history, uncommitted work.
5. **Migrations 0046 and 0047** are not applied in production (assumed; not read) **[N]**.
6. **The production queue and connection associations have not been inspected** **[N]**.
7. **Privacy-filter and users-metric decisions** (recommendations A and B).
8. **Preview cannot run the worker** (no analytics variables), so it cannot be a staging step for synchronisation until values are added.

## 15. Readiness for Phase 2.4

**Not ready for activation. Ready for one specific next step.** If you provide the access in section 13, a live run takes one command per provider and about 26 requests. Its evidence decides, in order: whether derived Search Console totals can stay (recommendation D); the live latency that the Phase 2.2 capacity figures need; the landing bundle's row count (the daily-fact question); and the Wix day boundary (recommendation C). Without that access, the remaining work is decisions A, B, E and G, the production inventories under your authorisation, and closing Phase 1.

Phase 2.4 has not started and will not without your instruction.
