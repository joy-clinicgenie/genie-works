# Genie Works analytics data diagnostic

Date: 12 November 2026, 10:40 Asia/Singapore (02:40 UTC)
Scope: Website Analytics module (Overview, Traffic, Behaviour) and the Search Console figures on SEO. Providers: GA4, Google Search Console, Wix Analytics.
Mode: read-only audit. No code, database row, environment variable or deployment was changed. The only file written is this report.
Status: this report replaces the diagnostic written earlier on 12 November 2026. Every finding below was re-checked today. Where the earlier report was wrong or incomplete, section 9 says so.

## 1. Answer

Production shows no GA4, Search Console or Wix figures because **no sync has run since 2 November 2026, production is unable to run one, and the little data stored before then does not match any period the pages ask for.** The providers themselves are healthy: all 21 stored connections still authenticate today.

Three confirmed causes, each sufficient on its own:

1. **Nothing triggers the sync in production.** The Vercel project has no cron registered. The last sync run in the database finished on 2 November at 10:01 UTC. 91 jobs have been queued since, and one is stuck mid-run.
2. **Production cannot run a sync even if triggered.** Five analytics credential variables are absent from the Vercel project. Every connection was authorised from a developer machine (`http://localhost:3400`) and encrypted with that machine's key.
3. **The stored data cannot satisfy any page request.** Readers need a stored report whose start and end dates equal the selected period. The stored reports cover 23 to 30 October (GA4, one website) and 17 to 27 October (Search Console, five websites). Running the real reader functions against the database returns "unavailable" for Last 7, Last 30 and Last 90 days on every website.

**The earlier "old snapshot reports" finding is not supported.** `report_snapshots` has zero rows in the production database. Production is not showing old snapshot reports instead of synchronised records; there are no snapshot records to show. Whichever way `ANALYTICS_LIVE_REPORTS` is set, the pages come out empty.

**Fixes for most of this exist but are not deployed.** They sit uncommitted in the working tree on branch `analytics-data-fixes` (decisions D51 to D53). Production runs commit `31551b5`, which contains none of them. Section 6 reviews those fixes and finds three defects that should be resolved before they ship, the most serious being that they queue about 221 jobs per daily run against a worker limit of 40.

## 2. What was checked, and how

| Area | Method | Outcome |
| --- | --- | --- |
| Deployed code | `git` comparison of the production commit against local `HEAD` and the working tree | Production `31551b5` has the same tree as local `HEAD` `4a8832e`. 33 files of analytics fixes are uncommitted. |
| Vercel project | `vercel api /v9/projects/genie-works`, `/env` (names, types and targets only), `/v6/deployments`, team plan | Root Directory, cron definitions, variables, deployments, plan |
| Vercel logs | `vercel logs requests` for 12 hours, `vercel logs` runtime for 30 minutes (the Hobby limits) | 622 requests summarised |
| Database | 32 `select` statements as the owner role inside `BEGIN TRANSACTION READ ONLY`, each rolled back. Counts, dates, states and aggregate totals only. | Sections 4.1 to 4.5 |
| Readers | The repository's own `dailySessionSeriesWithPeriod` and `publishedReport`, called from a script outside the repository, in a read-only transaction | Section 4.3 |
| Provider authentication | Each stored token decrypted in memory, then one token request and one metadata request per connection. Nothing was written back and no report data was pulled. | Section 4.6 |
| Unit tests | 9 database-free test files, with the database URLs overridden to an unreachable address | 51 of 51 passed |

**Limits. These were not verified:**

- **The production value of `ANALYTICS_LIVE_REPORTS`.** The variable exists for production but is stored as "sensitive", so Vercel does not return it. Local value: `true`.
- **That the audited database is the production database, by direct comparison.** Production's `DATABASE_URL` is also sensitive. The match is strongly indicated, not proven (section 4.2).
- **What a signed-in user sees on the production pages.** No production sign-in was used.
- **Database test suites.** Not run: the local `.env` points them at the hosted database (section 4.8).
- **Runtime errors older than 30 minutes and cron history.** The Hobby plan does not keep them.
- **Vercel Hobby cron limits** (one run a day, within the scheduled hour). Taken from the earlier report and project documents, not re-read from Vercel's documentation today.

## 3. How data reaches the pages

```
Trigger: Vercel cron  GET /api/internal/analytics/worker             <- not registered (4.1)
  drainMaintenance                 packages/db/src/analytics/maintenance.ts
    enqueueDue -> dueWindow        packages/db/src/analytics/sync.ts       <- one window per provider (4.3)
    runWorkerOnce -> claimNextJob -> executeClaimedJob
      decodeClaimedToken           needs ANALYTICS_TOKEN_KEY               <- missing (4.2)
      ensureAccessToken            needs the provider app credentials      <- missing (4.2)
      pullGa4 / pullWix / pullGsc
      promote -> analytics_report_partitions, _rows, _metric_values, analytics_coverage

Page request (all three tabs: loadAnalyticsOverview, force-dynamic)
  loadAnalyticsForAccess           apps/platform/src/components/modules/AnalyticsShell.tsx
    loadSiteViewWithDb             reads report_snapshots (0 rows in production)
  boardFromSnapshots               always built first
  if ANALYTICS_LIVE_REPORTS:
    loadLiveBundle                 apps/platform/src/lib/live-analytics.ts
      dailySessionSeriesWithPeriod every day in the window must be complete  (4.4)
      publishedReport              start_date and end_date must match exactly (4.3)
    boardFromLive                  replaces traffic figures only (4.5)
```

Line references below are to the deployed commit unless marked "working tree".

## 4. Findings in production

Status key. **Confirmed**: shown by configuration, database rows or executed code. **Suspected**: the code allows it, but the deciding fact was not observed.

### 4.1 P0. No sync has run since 2 November, and nothing is scheduled to run one. Confirmed.

Configuration:

- Vercel project `genie-works` has `rootDirectory: "apps/platform"`. Its `crons.definitions` is `[]` for the current production deployment `dpl_8he86jq6…` (commit `31551b5`, built 12 November 01:45 UTC).
- The deployed commit declares its cron in the repository-root `vercel.json`, which Vercel does not read for this project. The file that would be read, `apps/platform/vercel.json`, exists only as an untracked file in the working tree.
- 12 hours of production request logs contain no request to `/api/internal/analytics/worker`.
- The staff "Refresh" action only queues jobs. `refreshAnalytics` (`apps/platform/src/app/actions/analytics.ts:175-181`) calls `enqueueDue` and never runs the worker.

Database:

| Fact | Value |
| --- | --- |
| Last job created | 2 November 09:57 UTC |
| Last sync run finished | 2 November 10:01 UTC |
| Sync runs ever | 22: 21 succeeded, 1 still `running` |
| Jobs | 116: 91 queued, 21 succeeded, 3 cancelled, 1 leased |
| Stuck job | `gsc.pages`, leased by owner `http`, lease expired 2 November 10:03 UTC, never reaped because no worker has run since |
| Failed or reconnect-required jobs | 0 |
| Site Health tables fed by the same worker (`seo_index_checks`, `seo_speed_checks`) | 0 rows each |

Queued jobs by provider: Search Console 69, GA4 12, Wix 10. All are due (`next_attempt_at` in the past) and all ask for windows ending between 27 October and 2 November.

**Affected:** every analytics tab, the SEO Search Console card and Site Health.

### 4.2 P0. Production lacks the analytics credentials, and the connections belong to a local key. Confirmed.

The production environment has 26 variables. It includes `ANALYTICS_LIVE_REPORTS` and `CRON_SECRET`. It does not include any of these:

| Missing in production | Needed by | Effect |
| --- | --- | --- |
| `ANALYTICS_TOKEN_KEY` | `keyMaterial`, `packages/db/src/analytics/crypto.ts` | Stored tokens cannot be decrypted |
| `ANALYTICS_GOOGLE_CLIENT_ID`, `ANALYTICS_GOOGLE_CLIENT_SECRET` | `refreshGoogle` (`sync.ts:854`), `api/analytics/google/start/route.ts` | No Google token refresh, no Google connect |
| `ANALYTICS_WIX_APP_ID`, `ANALYTICS_WIX_APP_SECRET` | `refreshWix` (`sync.ts:839`), `connectWix` in `actions/analytics.ts` | No Wix token, no Wix connect |

`ANALYTICS_WORKER_SECRET` is also absent, so the only accepted worker bearer in production is `CRON_SECRET`. `PAGESPEED_API_KEY` is absent too.

Where the connections came from:

- All 27 OAuth state rows carry the redirect origin `http://localhost:3400`. None carries the production origin.
- Every stored access token has expired. Each job therefore needs a refresh, which needs the app credentials.
- The key in the local `.env` decrypts all 21 stored secrets (section 4.6). Production has no key at all.
- The 21 successful runs were made through the HTTP worker route (the stuck job's owner is `http`). Production has no token key, and a run without the key would have left `reconnect_required` rows; there are none. The successful runs therefore came from a local server pointed at this database. This is an inference by elimination.

**Rollout hazard in the deployed code, confirmed by reading.** If the worker ran in production today, `decodeClaimedToken` (`sync.ts:981-987`) would fail to decrypt, throw `ReconnectError`, and `failClaimedJob` (`sync.ts:570`) would set the whole connection to `reconnect_required`. One run would do this to every connection it reached. The credentials must therefore be in place before any worker run against deployed code, and the key must be the one that encrypted the stored tokens.

**Affected:** all providers. On Settings, `AnalyticsConnections.tsx:68-69` derives `googleReady` and `wixReady` from these variables, so production shows the connect controls as not configured.

### 4.3 P0. Stored reports match no period the pages request. Confirmed.

Reader, `publishedReport` (`packages/db/src/analytics/read.ts:30-53`):

```sql
select … from analytics_report_partitions
where client_id = $1 and website_id = $2 and template_key = $3
  and start_date = $4 and end_date = $5 and published
order by generation desc limit 1
```

Writer, `enqueueDue` (`sync.ts:204-225`) queues every template for one window from `dueWindow` (`sync.ts:135`): GA4 30 days ending today, Wix 62 days ending today, Search Console 30 Pacific days ending three days ago. `enqueueBackfill` (`sync.ts:229`) has no caller outside tests.

All 21 published partitions in the database:

| Template | Websites | Stored window | Fetched |
| --- | --- | --- | --- |
| `ga4.traffic_range` | 1 | 23 to 30 October | 30 October |
| `ga4.acquisition`, `.landing`, `.device`, `.country`, `.traffic_daily` | 1 | 23 to 30 October | 2 November |
| `gsc.totals`, `.pages`, `.queries` | 4 | 17 to 26 October | 2 November |
| `gsc.totals`, `.queries` | 1 | 18 to 27 October | 2 November |
| `wix.data_daily` | 1 | 30 August to 30 October | 2 November |

Windows the pages and worker compute today (output of the real functions at 02:36 UTC):

```
deployed page   last7  2026-11-06 … 2026-11-12
deployed page   last30 2026-10-14 … 2026-11-12
deployed page   last90 2026-08-15 … 2026-11-12
deployed worker ga4    2026-10-14 … 2026-11-12
deployed worker wix    2026-09-12 … 2026-11-12
deployed worker gsc    2026-10-10 … 2026-11-08
```

Result of the real readers against the database:

| Website | Period | Sessions | Users | Channels |
| --- | --- | --- | --- | --- |
| GA4 site | Last 7 | unavailable, 0 of 7 days | no report | no report |
| GA4 site | Last 30 | unavailable, 3 of 30 days | no report | no report |
| GA4 site | Last 90 | unavailable, 3 of 90 days | no report | no report |
| GA4 site | Custom 23 to 30 October | unavailable, 3 of 8 days | 12 | 3 rows |
| Wix site | Last 7 | unavailable, 0 of 7 days | not read for Wix | not read for Wix |
| Wix site | Last 30 | unavailable, 17 of 30 days | not read for Wix | not read for Wix |
| Wix site | Last 90 | unavailable, 59 of 90 days | not read for Wix | not read for Wix |
| Wix site | Custom 2 September to 30 October | 14,571 | not read for Wix | not read for Wix |

So the synchronised records exist and are readable, but only through a custom range that happens to equal a stored window.

Even with a daily cron, the deployed design fails by construction:

- Last 7, Last 90 and most custom ranges never have a GA4 range report, because the worker stores a 30-day window only.
- The previous-period window is never queued, so comparisons for users and channels stay empty.
- The stored windows above are 8 and 10 days long. They were queued by an earlier build; no current preset is 8 or 10 days.

Search Console has the same fault. `loadSearchPerformance` (`apps/platform/src/lib/seo-workspace.ts:180`) reads `gsc.totals` for `searchConsoleWindow` (`:167`). The 30-day option today is 10 October to 8 November. No stored partition has those dates.

**Affected:** Overview and Traffic (users, channels, organic, landing pages, devices, countries, comparisons), the SEO Search Console card.

### 4.4 P1. Session totals need every day in the window, and GA4 omits zero-session days. Confirmed with stored data.

`dailySessionSeriesWithPeriod` (`read.ts:127-160`) returns a total only when the count of complete days equals the window length.

- `ga4ReportBody` sends `keepEmptyRows: false` (`packages/db/src/analytics/providers/ga4.ts:25`), and `promote` writes coverage only for rows returned (`sync.ts:655-661`).
- The stored GA4 daily report for 23 to 30 October is marked `complete`, yet it holds coverage for three days only: 27, 29 and 30 October. The other five days had no sessions and were dropped. The custom range 23 to 30 October therefore reads "unavailable, 3 of 8 days" although the provider answered in full.
- Presets end on today (`presetWindow`, `apps/platform/src/lib/period-options.ts:55`). Today has no coverage until that day's run, so every preset is unavailable before the run.
- **A partial day is stored as final.** The stored range report says 16 sessions for 23 to 30 October. The daily rows for the same window sum to 22. The range report was fetched during 30 October and never refreshed.

**Affected:** Sessions and the trend chart on Overview and Traffic, for every period.

### 4.5 P1. Most of the module does not read synchronised data at all. Confirmed.

- **Behaviour.** `boardFromLive` (`apps/platform/src/lib/analytics-board.ts:344`) replaces traffic figures only. Engagement rate, bounce rate, duration, pages per session, page list, events and form figures come from `boardFromSnapshots` (`:220`). With zero snapshot rows, Behaviour is empty in production in either flag state.
- **New and returning visitors** on Overview and Traffic: snapshot only, same result.
- **Wix websites: sessions only.** `loadLiveBundle` (`apps/platform/src/lib/live-analytics.ts:43`) reads users, channels, landing pages, devices and countries for GA4 only. The worker stores Wix unique visitors, contact clicks and form submissions (`WIX_DATA_MEASURES`, `providers/wix.ts:6`), but no reader uses them. Stored and unread today, for one website over 59 days: 13,593 unique visitors and 761 contact clicks.
- **This matters more than it looks: 10 of the 11 connected websites are Wix.** Only one website has GA4.

**Affected:** Behaviour (all figures), visitor split, and most of Overview and Traffic for every Wix website.

### 4.6 Provider authentication and property mappings are healthy. Confirmed.

Probe of all 21 active connections, using the credentials in the local `.env`:

| Provider | Connections | Token decrypts | Token step | Access check |
| --- | --- | --- | --- | --- |
| GA4 | 1 | 1 of 1 | Refresh HTTP 200 | Property metadata HTTP 200, 92 metrics |
| Search Console | 10 | 10 of 10 | Refresh HTTP 200 | Site HTTP 200, permission `siteOwner`, all URL-prefix properties |
| Wix | 10 | 10 of 10 | Token issued HTTP 200 | Site analytics data HTTP 200 |

Other mapping facts from the database:

- 22 connections: 21 connected, 1 disconnected. None is in `reconnect_required`.
- Each of the 11 websites has exactly one traffic source, so no GA4 and Wix conflict exists.
- One Wix website has no Search Console connection.
- GA4 time zone is Asia/Singapore, matching the reporting calendar.
- No sync run has ever recorded a provider error.

Authentication is not a cause. One caveat is **suspected**: connecting from production will need the production callback URL registered on the Google OAuth client. That is in the Google console and was not checked.

### 4.7 P2. `ANALYTICS_LIVE_REPORTS` is not a root cause. Value unverified.

- The variable is set for production only, created 2 November 10:07 UTC, type sensitive. Preview deployments do not have it.
- `load-analytics-board.ts:21` returns the snapshot board when the flag is off.
- Flag off: snapshot path, zero snapshot rows, empty pages.
- Flag on: live path, no matching partition (4.3), empty pages.
- `envFlag` (`packages/db/src/env.ts:37`) in the deployed commit does not trim, so a value such as `true ` or `"true"` reads as off. Whether production is affected is **suspected**, not known.

### 4.8 P1. Local, preview and production share one database, and the local setup can write to it. Confirmed.

| | Local | "Staging" (Vercel preview) | Production |
| --- | --- | --- | --- |
| Exists | Yes, dev server running on port 3400 since 09:59 today | No separate environment. Preview builds of the same project only. | `genie-works-ashen.vercel.app` |
| Code | Working tree with uncommitted D51 to D53 fixes | Branch builds | `31551b5` |
| Database | Hosted Neon database `neondb` (embedded Postgres on 54339 is running but unused) | Same `DATABASE_URL` entry as production | Sensitive, not readable |
| `ANALYTICS_LIVE_REPORTS` | `true` | Absent, so off | Present, value unreadable |
| Token key and provider credentials | All present | Absent | Absent |
| Worker trigger | Manual call. `ANALYTICS_ALLOW_REMOTE_WORKER=1` lets it target a remote host. | None | None |
| Cron | Not applicable | Not applicable | Not registered |

Evidence that the local database is production's:

- Its first migration ran 29 October 13:05 UTC, four minutes after Vercel's Neon variables were created (13:01 UTC).
- Sign-in audit events at 00:52, 01:45 and 02:00 UTC today line up with production page requests starting 00:52 UTC.
- `docs/audits/platform-performance/CG_LATENCY_AUDIT_REPORT.md` already records that the local `.env` points at the shared Neon database.

Consequences:

- A local "Refresh" or worker call writes production rows. Section 4.2 infers that every stored report was produced this way.
- `DATABASE_ADMIN_URL` in the local `.env` is the owner role, which bypasses row-level security.
- No guard against a remote database was found in `packages/db/test/helpers.ts`. Running `npm test` with this `.env` would point the database suites at the hosted database. They were not run.
- Local and production read the same rows, so a difference between the two screens comes from code, flag and credentials, never from data.

### 4.9 P2. Sync coverage is thin even for what was stored. Confirmed.

| Provider | Connected | With any stored report | Never synced |
| --- | --- | --- | --- |
| GA4 | 1 | 1 | 0 |
| Search Console | 10 | 5 (one of them without `gsc.pages`) | 5 |
| Wix | 10 | 1 | 9 |

The 2 November runs stopped part-way through the queue. Nine Wix websites and five Search Console properties have never produced a row.

### 4.10 P3. Housekeeping. Confirmed.

- **Schema is behind the deployed code.** The database has migrations up to `0043`. The deployed commit ships `0044_website_enquiry_forms.sql` and `0045_wix_inbox_messages.sql`; neither table exists. This belongs to the enquiries work, not analytics, and is noted for the owner.
- **Debug logs in a public repository.** `.cursor/debug-af0448.log`, `debug-c3d738.log` and `debug-f8030a.log` are tracked in the deployed commit, and the GitHub repository is public. A pattern scan found no tokens, connection strings or email addresses; the content is timings and counts. The working tree adds an ignore rule but the files remain tracked.
- **`.github/workflows/webpack.yml`** runs `npx webpack` in a repository with no webpack configuration. Unrelated to analytics.

### 4.11 Ruled out

- **Page caching.** All three pages export `dynamic = "force-dynamic"`. Today's production requests to `/analytics`, `/analytics/traffic` and `/analytics/behavior` returned 200 with cache result `MISS` (81 requests across three deployments).
- **Runtime errors on the pages.** The only runtime log lines in the last 30 minutes are a `pg` SSL-mode deprecation warning. No analytics request returned 4xx or 5xx in 12 hours.
- **Provider authentication, permissions and property mappings** (4.6).
- **Code drift between `main` and production.** Production `31551b5` and local `HEAD` have identical trees.
- **Old snapshot reports displacing live data** (section 1 and 4.7).

## 5. Root causes ranked

| # | Cause | Status | Priority | Pages affected |
| --- | --- | --- | --- | --- |
| 1 | No cron registered; no sync since 2 November (4.1) | Confirmed | P0 | All analytics tabs, SEO Search Console card, Site Health |
| 2 | Analytics credentials absent in production; tokens encrypted with a local key (4.2) | Confirmed | P0 | All |
| 3 | Exact-date readers against one worker window; stored windows match no preset (4.3) | Confirmed | P0 | Overview, Traffic, SEO card |
| 4 | Every-day-complete rule, GA4 zero-day gaps, partial day stored as final (4.4) | Confirmed | P1 | Sessions and trend on Overview and Traffic |
| 5 | Behaviour, visitor split and Wix detail never read synced data (4.5) | Confirmed | P1 | Behaviour; Overview and Traffic for 10 of 11 websites |
| 6 | One shared database; local machine can write production (4.8) | Confirmed | P1 | Operational risk |
| 7 | Deployed worker would mark connections `reconnect_required` on a configuration fault (4.2) | Confirmed by reading | P1 | Settings, all sync |
| 8 | 14 of 21 connections have never synced (4.9) | Confirmed | P2 | Wix and Search Console websites |
| 9 | Flag value unreadable; untrimmed parsing (4.7) | Suspected | P2 | All |
| 10 | Schema behind code, tracked debug logs, stray workflow (4.10) | Confirmed | P3 | None in analytics |

## 6. Review of the uncommitted fixes (branch `analytics-data-fixes`)

The working tree holds fixes for causes 1, 3, 4, 5 (GA4 only), 7 and 9. They are uncommitted, the branch points at the same commit as `main`, and nothing is deployed. 51 database-free unit tests pass. The database suites were not run (4.8).

What the fixes do correctly, by reading and by executing `dueJobs` and `analyticsPeriod`:

- The cron is declared in the repository-root `vercel.json` (moved there on 12 Nov; `apps/platform/vercel.json` no longer exists). Vercel reads it only after the project Root Directory is changed from `apps/platform` to the repository root.
- A missing key or app credential becomes `not_configured`; the connection keeps its status.
- `dueJobs` (`sync.ts:175`, working tree) queues GA4 and Search Console reports for Last 7, 30 and 90.
- Rolling presets end yesterday; GA4 date reports keep empty rows; live mode ignores snapshot windows.
- GA4 Behaviour figures and the visitor split are read from new templates.

Three defects were found in them.

### 6.1 P1. The fix queues far more jobs than the worker can run. Confirmed.

`dueJobs`, executed today, returns 31 jobs for a GA4 connection, 18 for a Search Console connection and 1 for a Wix connection. With the current 21 connections, one due run queues:

```
GA4   1 × 31 =  31
GSC  10 × 18 = 180
Wix  10 ×  1 =  10
total         221 new jobs per run
```

The worker runs at most 40 jobs per call (`jobLimit`, `worker/route.ts:10-13`; hard maximum 100) and stops starting jobs after 65 seconds (`maintenance.ts:71`). The plan is Hobby, and the cron is daily. So about 221 jobs arrive per day and at most 40 leave.

Effects:

- The new ordering takes the newest window first (`sync.ts:507`, working tree). GA4 and Wix windows end later than Search Console windows, so Search Console is served last and starves.
- The windows move every day, so yesterday's unfinished jobs are never reused. Nothing cancels them. The queue grows without limit.
- The 91 obsolete jobs already queued stay in the queue behind everything else.

### 6.2 P1. Pages are empty every morning until the cron has run. Confirmed by reading.

`analyticsPeriod` (`apps/platform/src/lib/period-range.ts:45`, working tree) moves a rolling preset to end yesterday as soon as the Singapore date changes. The reports for that window are queued only when the cron fires at 02:00 UTC, which is 10:00 in Singapore, and on Hobby possibly later within the hour. From 00:00 until the run completes, the exact-date readers find nothing and there is no fallback to the previous day's report.

### 6.3 P2. Five presets are never prepared and show no notice. Confirmed by reading.

The period control (`PeriodSelect.tsx`) offers Today, Yesterday, Last 14 days, Last 365 days and This month in addition to 7, 30 and 90. `PRESET_LENGTHS` is `[7, 30, 90]`. For the other five:

- no GA4 range report is ever queued, so users, channels, landing pages, devices, countries and Behaviour stay unavailable;
- the "This range has not been prepared" notice does not appear, because `load-analytics-board.ts:27` (working tree) builds it for `custom` only;
- Last 365 days can never show sessions, because daily history is kept for 180 days (`GA4_DAILY_DAYS`).

### 6.4 Not addressed by the fixes

- Wix websites still show sessions only (4.5). This is 10 of 11 websites.
- The shared database and local write path (4.8).
- The production credentials (4.2). This is configuration, not code.

## 7. Recommended fixes

Nothing here has been implemented. Order matters for the first three.

1. **Provision the credentials first.** Add `ANALYTICS_TOKEN_KEY`, `ANALYTICS_GOOGLE_CLIENT_ID`, `ANALYTICS_GOOGLE_CLIENT_SECRET`, `ANALYTICS_WIX_APP_ID` and `ANALYTICS_WIX_APP_SECRET` to production through the approved secret process. The token key must be the one that decrypts the stored secrets, or every connection has to be reconnected. Register the production callback URL on the Google client. Do this before any worker run (4.2 hazard).
2. **Then ship the cron and the `not_configured` handling together.** Change the Vercel Root Directory to the repository root and deploy the root `vercel.json`. Confirm that `crons.definitions` lists `/api/internal/analytics/worker`.
3. **Resolve job capacity before enabling the new windows (6.1).** Pick one and record it in DECISIONS:
   - reduce the work: one daily Search Console report with a `date` dimension summed by the reader, in place of 18 range jobs per property; or
   - raise throughput: run the worker several times a day (needs a paid Vercel plan or an external scheduler) and raise the job limit; or
   - both.
   Whichever is chosen, cancel a queued job once its window is superseded.
4. **Retire the existing backlog with approval.** 91 queued jobs and one stuck lease refer to windows no page reads. Cancelling them is a database change and needs the owner's approval.
5. **Close the morning gap (6.2).** Keep showing the latest stored window until the new one is published, labelled with its dates, or have the readers fall back to the most recent published window of the same length.
6. **Cover or remove the unprepared presets (6.3).** Either queue them, show the "not prepared" notice for them, or take them out of the analytics period control.
7. **Decide the Wix scope (4.5).** Either read the unique visitors, contact clicks and form submissions already stored, or say on the page that a Wix website reports sessions only.
8. **Separate the environments (4.8).** Give local development and preview their own database. Remove the owner-role URL and `ANALYTICS_ALLOW_REMOTE_WORKER=1` from the local `.env` until then. Add a guard so database test suites refuse a non-local host.
9. **Commit the working tree.** 33 modified and 5 new files hold the only copy of the D51 to D53 work.
10. **Make the read path visible.** Show administrators whether the page is in snapshot or live mode, and record the intended production value of `ANALYTICS_LIVE_REPORTS` in `docs/ENVIRONMENT.md`.
11. **Housekeeping (4.10).** Apply or withdraw migrations 0044 and 0045, untrack the debug logs, remove `webpack.yml`.

## 8. Acceptance tests

| # | Test | Type | Pass condition |
| --- | --- | --- | --- |
| A1 | Cron registered | Deployment check | Vercel `crons.definitions` lists the worker path. One scheduled call produces `analytics_sync_runs` rows whose `started_at` falls inside the scheduled hour. |
| A2 | Credentials usable | Production check | After one run, no job has `safe_error_code = 'not_configured'` and no connection is `reconnect_required`. |
| A3 | Configuration fault is harmless | Unit | With the token key unset, a claimed job ends `not_configured`, stays queued, and the connection status is unchanged. |
| A4 | Capacity | DB integration | With 1 GA4, 10 Search Console and 10 Wix connections, the jobs queued by one due run are all finished by the scheduled runs of the same day. Repeated over 7 simulated days, the queued count does not grow. |
| A5 | Superseded jobs retire | DB integration | A queued job whose window is no longer requested becomes `cancelled` on the next due run. |
| A6 | Presets resolve | DB integration | After one day's runs with fixture providers, Last 7, 30 and 90 return sessions, users and channels, each with a previous-period value. |
| A7 | Morning gap | Unit | At 00:30 and 09:30 Asia/Singapore, before that day's run, Last 7 shows the latest published window with its dates, not "unavailable". |
| A8 | Other presets | Unit | Today, Yesterday, Last 14, Last 365 and This month each show figures, or a visible "not prepared" notice, or are absent from the control. |
| A9 | Zero-session day | Unit | A GA4 response that reports a day with 0 sessions yields coverage for that day and an available period total. An absent or failed response leaves the period unavailable. |
| A10 | Partial day not final | DB integration | A range report fetched during its last day is replaced by the next day's run, and the range total equals the sum of the daily rows. |
| A11 | Search Console card | Unit | `loadSearchPerformance` returns totals for the 7, 30 and 90 day options after one day's runs. |
| A12 | Wix scope | Unit | A Wix website shows unique visitors, contact clicks and form submissions, or an explicit "sessions only" statement. |
| A13 | Behaviour source | Unit | With live reports on, each Behaviour figure comes from a provider report or carries the "recorded export" label. |
| A14 | Flag parsing and visibility | Unit | `envFlag` reads `" true "` as on. An administrator can see the active read path on the Analytics page. |
| A15 | Environment isolation | Guard test | The database suites and the worker script refuse a non-local database host unless an explicit non-production override is set. |
| A16 | Isolation and permissions | DB | New jobs and readers keep cross-client isolation. Read-only, specialist and reviewer roles cannot queue provider work. |
| A17 | Reconciliation | Manual | For one completed window per provider, Genie Works sessions, users, clicks and impressions equal the provider console for the same dates and time zone. |
| A18 | All connections synced | Production check | Each of the 21 connections has a published report fetched within the last 24 hours. |

## 9. What changed from the earlier report of 12 November

| Earlier statement | Today's finding |
| --- | --- |
| Production database contents could not be verified. | Queried read-only. Sections 4.1 to 4.5 and 4.9 are new evidence. |
| "Old snapshot reports" partly true; snapshot period alignment might be moving the window (old 4.4). | Not supported. `report_snapshots` has zero rows, so alignment has nothing to align to. Removed as a cause. |
| Provider state could not be verified. | All 21 connections authenticate (4.6). |
| Production runs `cefa989`. | Production now runs `31551b5`, deployed 12 November 01:45 UTC. Same analytics code. |
| "No `.env` exists locally and no local database was running." | A local `.env` now exists and points at the hosted database, with a dev server running against it (4.8). |
| Section 10 listed findings as "Fixed". | The fixes are uncommitted and undeployed. Production is unchanged. Three defects were found in them (section 6). |
| Debug `fetch` in the worker route. | Absent from the deployed route. The tracked log files remain. |

## 10. Next step

Review this report. No change should be made until it has been reviewed. The decisions needed first are the job-capacity approach (fix 3), the Wix scope (fix 7) and the environment separation (fix 8). Fix 1 is a configuration change for the owner and needs no code.
