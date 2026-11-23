# Analytics Phase 2.3A: data accuracy and security corrections

> **Renumbered 23 Nov 2026** when this work moved onto `main` (branch `analytics-phase2`): migrations `0046_analytics_scheduling` and `0047_analytics_worker_invocations` in this record are now `0053` and `0054`, because main already used 0046 and 0048–0052. Decisions are cited by their new numbers D68–D72.

Date: 13 November 2026, Asia/Singapore.
Decision: D71 in `docs/DECISIONS.md`.
Branch: `analytics-phase1-closure`, working tree only. Nothing is committed, pushed, deployed or scheduled. No migration was added.

**Result: all five corrections are implemented and tested locally. Two things came out of the work that you should know first. (1) GA4 page paths and landing pages were being stored with no privacy check at all, so an email address or token in a URL would have been written to the database; that is now closed, but reports already stored are not changed and their size is unknown until the scan is run on a restore point. (2) Phase 1 is still not closed: the secrets backup file and the three editor-history copies of live production values still exist, and only you can decide what happens to them.**

## 1. Changes implemented

| # | Item | What changed | Numbers changed? |
| --- | --- | --- | --- |
| 1 | Privacy filtering | New `privacy.ts`: identifiers and credentials, not words. Applies to Search Console queries and pages **and now to GA4 page, landing and other dimensions**. Evidence is counts and reason labels only | No stored metric value is altered; the rows withheld are counted |
| 2 | GA4 users | Headline stays **Total users** (`totalUsers`). New and returning cards are now **New active users** and **Returning active users** (`activeUsers`), with a meaning that says they are a different measure. Page time column says **per active user**. Dictionary updated | **No** |
| 3 | Property association | `saveConnection` refuses a property another client already has. Audit separates other-client from same-client sharing and checks client and website consistency. A database backstop is **prepared, not applied** | No |
| 4 | Report quality | `quality.ts` tells partial, out of date, truncated, rows left out, provider problem, no data and recorded zero apart. Shown as a short "Data notes" notice on the Analytics pages and the SEO Google panel | No |
| 5 | Phase 1 security | Checked, section 6. Nothing deleted, rotated or changed | n/a |
| + | Stored-value scan | `scanStoredValues` counts values written under the old rules that the new rules would withhold. Read-only, counts only | n/a |
| + | Latent crash fixed | Two Search Console pages that differ only by a removed query string used to give the same key, which violates `unique (partition_id, dimension_key)` and fails the whole job. They are now combined (counts added, CTR recomputed, position weighted by impressions) | No |

## 2. Privacy-filter before-and-after results

### Why the old filter was wrong in both directions

The old `safeSearchQuery` and `safeAnalyticsPath` withheld any text that **contained** words such as `patient`, `symptom`, `phone`, `mobile`, `name`, `message` or `tel` (which also matched "hotel"). They were applied to Search Console only. GA4 page dimensions were never checked.

**Measured before the change** (a GA4 landing-page answer containing an email address and phone number in the query string, and a password-reset link, stored through the real pipeline):

```
stored landing keys:
  "/for-patients"
  "/reset-password/<32-character token>"
  "/thank-you?email=<address>&phone=<number>"
```

After the change the same answer stores `"/thank-you"` and `"/for-patients"`, the reset link is withheld, and the evidence says "1 row withheld (opaque identifier), 2 addresses had a query string removed, both with personal data". The text itself appears nowhere in the stored report or its evidence (asserted by test).

### The new rules

| Context | Rule |
| --- | --- |
| Search query | Withheld for: an `@`; an access token, key or `name=value` credential; a national id; a self-disclosure such as "my phone number is"; an opaque token or id; a run of 8 or more digits that is not a date, a year pair or a price (13 or more is a card-length number). Otherwise kept. Length capped at 200 |
| URL or page path | Query string and fragment **always removed**. Each path segment is checked for the same identifiers, after decoding twice (so `%2540` cannot hide an `@`). Non-web schemes (`mailto:`, `tel:`, `sms:`, `whatsapp:`, `javascript:`) are withheld. The words in a path are never a reason. GA4 placeholders such as `(not set)` are kept |
| Query-string parameter | Classified by **whole-word key** (`hotel_id` is not a `tel` field; `firstName` is `first`, `name`) and by **value shape**. Only the category is counted, never the value |
| Dimension (channel, device, country) | Kept unless it looks like an identifier |

### Results on the test corpus (all values fictional)

| Corpus | Old filter | New filter |
| --- | --- | --- |
| 30 ordinary clinic queries kept | **12 of 30** | **30 of 30** |
| 28 sensitive queries withheld | **15 of 28** | **28 of 28** |
| 21 ordinary page paths kept | **9 of 21** | **21 of 21** |
| 17 sensitive paths withheld | **11 of 17** | **17 of 17** |

Ordinary text the old filter lost included "symptoms of gum disease", "mobile dentist near me", "hotel near dental clinic", "patient reviews dentist", "dentist phone number singapore", "/for-patients", "/patient-reviews", "/blog/phone-etiquette", "/hotel-partnerships" and "/telehealth".

Sensitive text the old filter **missed** included "dentist 9123 4567" and "john tan 91234567" (it only caught a whole string that was a number), NRIC-shaped ids, a JWT-shaped token, a UUID, a 32-character hex token, "my nric is", a double-encoded email in a path, and `/appointment/confirm/<uuid>`.

**Protection was not weakened.** A test runs both filters over the sensitive corpus and fails if the new one lets through anything the old one blocked. It found none. Where the new filter keeps something the old one blocked, it is ordinary text with no identifier in it.

### Honest limits

- A person's **name**, an address written in words, or **health information typed as ordinary text** ("i have hiv") has no identifier shape. It is not detected by the new filter, and was not by the old one. Obfuscated identifiers ("john at gmail dot com") are not detected. Google withholds rarely-used queries from Search Console itself.
- A run of 8 or more digits is treated as a phone number. A product code or price with 8 digits and separators could be withheld wrongly. Dates and year pairs are exempted; a long numeric id in a URL is withheld.
- Key-value credentials need an `=` or `:` (`password=…`). A bare word is not one.

### Policy reading to confirm

`docs/analytics/08_REPORTING_PRIVACY_RULES.md` says to keep "symptoms" and "free-text messages" out of events, exports and logs. I read that as **a patient's own text**, not a public search keyword that contains the word. That reading is what your brief asked for, and it is written into the policy document as an interpretation for the policy owner to confirm. It is not my decision to make.

### Evidence kept

`withheldByPrivacyFilter` in each report's quality record keeps its earlier shape (`rows`, `clicks`, `impressions`) and adds `sessions` for GA4 and `byReason` (a count per fixed label: `email`, `phone_number`, `long_number`, `government_id`, `credential`, `opaque_identifier`, `self_disclosure`, `non_web_scheme`). Only additive measures are summed; rates and distinct counts never are. `queryStringsStripped` counts addresses that lost a query string and how many of those carried personal data.

## 3. Metric-definition decisions

| Figure | GA4 metric | Label now | Changed? |
| --- | --- | --- | --- |
| Headline Users (Overview, Traffic); denominator of the conversion rate | `totalUsers`, one request for the exact period | **Total users** | Label and number unchanged. Meaning now says "users Google Analytics recorded any event for, counted once over the whole period. Not the same measure as sessions or active users" |
| New / returning cards | `activeUsers` by `newVsReturning` | **New active users**, **Returning active users** (was "New visitors", "Returning visitors", with a meaning written for the export) | **Words only** |
| Page time | `userEngagementDuration` ÷ `activeUsers` | column **Avg. time per active user** (was "Avg. time") | Words only |
| Conversion rate meaning | enquiries ÷ `totalUsers` | "…divided by Total users" (was "…divided by visitors") | Words only |
| A website on the recorded export | n/a | Original wording kept | No |

Google's definitions (read from the Data API schema, 13 Nov 2026): `activeUsers` is distinct users who visited; `totalUsers` is users who logged at least one event regardless of whether the site was in use. They differ, and new plus returning active users need not equal Total users. The platform does not show GA4's own `newUsers` figure, and the dictionary now says so.

Regression tests pin the metric lists of every GA4 template (`totalUsers` in `ga4.traffic_range`; `activeUsers` in `ga4.pages` and `ga4.visitor_type`), the Search Console derivations (sessions add; CTR is clicks over impressions; position is impression-weighted), and that a kept value is stored unchanged (120, 45 and a genuine 0 come back as 120, 45 and 0). A board test shows 70 new + 30 returning shown beside 300 Total users with nothing forcing them to agree.

Documented in `docs/analytics/03_FEATURE_MEASUREMENT_DICTIONARY.md` ("Which users figure is which"). The report builder's catalogue item "Total users and new users" (`packages/contracts`) still says "new users"; I did not change that label because it is a shared contract. The figure it would draw is "new active users".

## 4. Property-association findings

| Finding | Evidence |
| --- | --- |
| The schema allowed the same GA4 property, Search Console site or Wix site under two **clients** | Unique index is `(website_id, provider, external_property_id)` only **[C]** |
| Client and website consistency is already enforced by the database | A composite foreign key ties a connection to a website of the same client; secrets, jobs and partitions carry the same triple **[C]**. The audit checks it anyway and expects empty results |
| Two code paths create connections | `bindConnectionFromState` (OAuth) and the Wix action both call `saveConnection`, so one guard covers both **[C]** |
| Production's real associations | **Not read.** Needs a restore point. Command prepared |

**Safeguard now in the application** (`saveConnection`): a new binding is refused if another client has the same provider and property (compared without regard to case or a trailing slash). The check takes a lock per property, so two simultaneous binds cannot both pass; a test holds one open and shows the second waits. The message says "already connected to another client" and names neither the client nor its id (tested). A deliberate share needs a reason of at least 10 characters, which is written to the audit log. The same property on another website of the **same** client (live and staging) is still allowed, and a property can be reconnected after it was disconnected elsewhere. **Existing connections are not touched**: a test creates a legacy duplicate and shows both stay connected while a third is refused.

**The audit** (`npm run analytics:audit`) now reports, as counts and eight-character hashes:

- `property_bound_to_other_client` (severity **action**)
- `property_shared_within_client` (**review**, probably fine)
- `client_website_mismatch` and `secret_scope_mismatch` (**action**; should always be empty)
- `connected_without_secret`, `missing_time_zone`, `gsc_site_does_not_match_website`

It also prints `storedValues`: how many stored dimension values would now be withheld or still carry a query string (section 5).

**Database backstop, prepared and not applied** (`packages/db/prepared/`): `analytics_property_one_client.sql` (pre-flight, one nullable column `cross_client_ack_reason`, a `security definer` trigger that sees every client's rows, serialised per property), the `.down.sql` rollback, and a `README.md` with the conflict-handling procedure. It lives **outside** `migrations/` so `db:migrate` can never run it; a test asserts that. Tests apply it inside rolled-back transactions on the local database and show it:

- refuses to apply, and applies nothing, while a property is under two clients (the error names a count, not a property);
- on clean data, refuses a second client (including `700802/` against `700802`), allows another provider, the same client, a disconnected row, and an acknowledged exception, and refuses reconnecting a disconnected row into a conflict;
- does not change any row count;
- rolls back cleanly, leaving every connection row identical.

Order of work, before it can become a migration, is in `packages/db/prepared/README.md`: restore point, audit on the restore point, decide per finding with the account owner which client the property belongs to, disconnect the wrong binding (history kept) or acknowledge a deliberate share, re-audit until clean, then promote. Nothing is deleted at any step.

## 5. Report-quality improvements

| State | Decided from | Message (fixed vocabulary; no provider text, no withheld value) |
| --- | --- | --- |
| Complete | Nothing below applies | Not shown |
| **Partial** | Days recorded < days expected; a partial report; GA4 sampling (share used); thresholding; an "(other)" row; a GA4 time zone that differs from the website's | "5 of 7 days are recorded. Totals cover only those days." |
| **Out of date** | Last successful sync older than 48 hours | "The last successful sync was 3 days ago. Figures may be out of date." |
| **Truncated** | The pull stopped at its page cap with more to read | "This list stopped at the number of rows the system reads. More rows exist and are not shown." |
| **Rows left out** | Rows withheld by the privacy filter, or addresses that lost personal details after the "?" | "3 rows were left out (12,000 clicks) because they carried personal identifiers or access tokens. Lists exclude them; totals do not." |
| **Provider problem** | Reconnect needed, or the last sync failed and nothing recent succeeded | "The last sync did not complete: Google Analytics was limiting requests. Figures shown are the last ones stored." An unknown code becomes "returned an error", never provider text |
| **No data** | The provider answered and the stored report is empty | "…returned no data for this period. That is a recorded absence, not an error." |
| **Recorded zero** | Available value of exactly 0 | "…measured this period and counted 0 sessions. This is a recorded zero, not missing data." |

A figure with none of these simply has no notice, so the pages' existing "not prepared yet" wording still applies. A missing value is never called a zero: a test shows a period with 5 of 7 days recorded gives "Partial" and not "Recorded zero", and that a recorded zero day counts as covered while an unreturned day does not.

**Where it appears.** A single "Data notes" notice under the source line on the Analytics Overview, Traffic and Behaviour tabs, and under the explanatory box in "Site performance on Google" on the SEO page. It uses the existing `Notice` component, so the design and information architecture are unchanged. Each line starts with a word in bold ("Truncated:", "Rows left out:") inside a `role="status"` region, so meaning never depends on colour; the tone is warning when something changes how far to trust a figure and neutral otherwise. Notes are grouped by state and list the subjects they apply to ("Landing pages, Pages: …"), ordered by what matters most, and the component escapes whatever it is given (tested with an injected `<img onerror>`).

Reading the evidence required adding `quality` to what `publishedReport` returns (an additive field). The Analytics page now makes one extra read for sync status; the existing "no duplicate reads" test was updated from 3 to 4 queries for that reason.

## 6. Security verification

Nothing was deleted, rotated or changed. Everything below is a read, a comparison or a count.

| Check | Result |
| --- | --- |
| **Secrets backup** `~/.genie-works-secrets/genie-works-env-backup-2026-11-12.env` | **Still exists.** Mode 600, directory 700, 4,955 bytes, written 12 Nov 11:04. No Time Machine destination, no cloud-storage client, not in Desktop, Documents or Downloads. **Whether its contents are in your password manager cannot be verified from here, and while the file exists it is still the only copy I know of.** Open: you |
| **Editor history** | **All three folders still exist**: VS Code `46536c5b` (2 files) and `-1f3b6621` (3 files), Cursor `-57b8f261` (7 files, 29 Oct). Phase 1 recorded these hold **live production values** (database URLs, token key, provider secrets). Not deleted. Open: you |
| Stale dev server holding old values | **None running** (no `next dev` process), so the Phase 1 concern about a server started before the cleanup is closed |
| **Working tree and history, by value** | The 39 non-empty, non-trivial values from the backup were searched for in every tracked file, every untracked file (39) and all **109 commits**, printing names only. **No credential found.** Six names matched: `EMBEDDED_PG_DIR`, `SEED_ALLOWED_DB_PATTERN`, `AUTH_URL`, `AUTH_GOOGLE_HD`, `UPLOADS_DIR` (paths, a pattern, a URL, a public domain: configuration, not secrets) and `FORMS_WIX_INSTANCE_ID` (see next row) |
| Wix installation id in history | Appears in a **test file** (`apps/platform/src/lib/wix-form-map.test.ts`) in **51 earlier commits** and not at HEAD. **Phase 1 already found this** (C1), replaced it at HEAD with a made-up id, and judged it an identifier that is useless without the app secret. **The repository is public (Phase 1), so the old value remains visible in published history.** I do not propose rewriting history. Open: you, only if you disagree with Phase 1's judgement |
| Key-shaped strings in the tree | Only fixtures at `.example.test` hosts (`database-environment.test.ts`). **I introduced one** in this phase (a fictional `AIza…` string in the privacy corpus), found it with this scan, and changed it to be built at runtime so nothing key-shaped is stored |
| No env files in the tree or scratch | `.env` is ignored and untracked; no `.env*` or `.vercel` anywhere in the repository or the scratch directory |
| **Development isolation** | `DATABASE_URL` and `DATABASE_ADMIN_URL` are `127.0.0.1:54339`; every analytics provider variable is empty; the Phase 1 and 2 guard tests pass |
| **Preview isolation** | The Preview-scoped database variables (`PREVIEW_DATABASE_URL`, `…_UNPOOLED`, `PREVIEW_POSTGRES_URL`, `…_NON_POOLING`, `PREVIEW_PGHOST`, `PREVIEW_POSTGRES_HOST`) all have a **host different from production's** (pooler suffix ignored), and the Neon project id differs. Of the Preview values the CLI returned (46 entries; the sensitive ones come back empty), **none equals any production value**. By **name**, which includes sensitive variables, **none of the production-only secrets** (token key, Google and Wix analytics secrets, cron secret, Resend key, Wix forms secret) is set in Preview. **Limit:** the Preview-scoped `DATABASE_URL` itself is a sensitive variable that the CLI will not return, so that exact value was **not** compared. I relied on Phase 1's record that it was set to the Preview database. **One further limit:** Preview signs in through a Google OAuth client whose callback was registered for Preview (Phase 1, addendum 7). If that is the same client as production's, its client secret is shared across environments; the secret is sensitive, so equality was not checked |
| How the Preview check was done | Preview-scope variables were pulled with `vercel env pull` into a private (mode 700) scratch directory, compared as hostname booleans without printing any value, and the directory deleted straight away. Production values were taken from the existing backup file; production was not pulled. The temporary link wrote a short-lived Vercel token locally; that file was deleted |

### Unresolved actions that need your approval

1. Move the secrets backup into the password manager, then delete the file (Phase 1, C9).
2. Decide on the three editor-history folders: delete them, or record that you keep them. They hold live production values; deleting history does not replace rotating those values if this Mac is ever in doubt (rotation is also yours to decide).
3. Whether to keep Phase 1's judgement that the Wix installation id in old, public commits is an identifier and not a credential.
4. Confirm the reading of "symptoms" and "free-text messages" in the privacy policy (section 2).
5. Run `npm run analytics:audit` on a **restore point** of production, and decide what to do about any `property_bound_to_other_client` findings and any stored values the scan reports.
6. Approve committing the working tree (Phase 1, condition 3). It has now passed a by-value credential scan. **The repository is public, so a commit and push publishes everything in it**, including these reports and the fictional fixtures.
7. Mark the `PREVIEW_*` variables sensitive in Vercel (carried over from Phase 2.3).

## 7. Tests and actual results

Environment: `ANALYTICS_FIXTURE_MODE=1`, hosted enquiry URLs blanked, local database.

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, all workspaces |
| `npm run lint` | exit 0 |
| `npm test` in `packages/db` | **44 files, 351 passed, 0 failed** (Phase 2.3: 40 files, 298) |
| `npm test` in `apps/platform` | **23 files, 145 passed, 0 failed** (Phase 2.3: 22 files, 135) |
| `npm run test:decisions` | 8 passed, 0 failed |
| `npm run analytics:validate -- --provider {ga4,gsc,wix} --fictional` | all three completed within their request caps with the same verdicts as Phase 2.3: existing provider integrations still work through the new filters |
| `npm run db:migrate:status` | `Applied: 48, Pending: none` (no migration added) |

**One run failed, then passed twice.** In the first full `npm test` after the last code change, the 3-day capacity simulation test (`analytics-worker-capacity.test.ts`) took **284 seconds** and hit its 120-second timeout; it normally takes about 3. The same file alone passed in 8 seconds, and the full database suite then passed in 17 seconds. I could not reproduce it and did not establish the cause. My hypothesis, untested, is a database plan that went bad after thousands of rolled-back transactions left the tables with heavy dead-tuple churn: that test runs thousands of statements inside one transaction on tables the planner thinks are empty. It predates this phase (the 100-day simulation in Phase 2.2 showed the same sensitivity). Treat it as an intermittent risk, not a fixed defect.

New tests (56 in `packages/db`, 10 in `apps/platform`; 3 older ones were replaced because the behaviour they described is gone):

| File | Tests | Covers |
| --- | --- | --- |
| `analytics-privacy.test.ts` | 20 | Legitimate queries and paths kept; sensitive ones withheld; reasons; encoding; query strings by parameter; before-and-after differential with a no-regression check; evidence contains no input text; GA4 landing stored without query string, identifier paths withheld and counted; bundle path; Search Console withheld and merged duplicates; merging does not add up users |
| `analytics-property-association.test.ts` | 15 | Cross-client refusal without naming the other client; same-client sharing; normalisation; reconnect after disconnect; audited override; legacy duplicates untouched; serialisation of simultaneous binds; audit kinds and severities; read-only; no cross-client visibility; the prepared guard (pre-flight, enforce, override, security definer, rollback, outside `migrations/`) |
| `analytics-report-quality.test.ts` | 14 | Every state from crafted inputs and from reports stored through the pipeline; grouping and order; no echo of withheld text; zero versus missing; cross-client isolation of reports |
| `analytics-safeguards.test.ts` | 7 | Stored-value scan (counts, no values, read-only); metric definitions pinned; kept values stored unchanged; a re-pull supersedes by flag and deletes nothing; the application role cannot delete reports, rows, metric values, jobs or connections |
| `live-analytics-quality.test.ts` (platform) | 6 | Quality reaches the board unchanged in number; nothing said when complete; partial is not zero; the notice renders with a leading word, a status role and escaping |
| `analytics-board.test.ts` (platform) | +4 | Audience labels and numbers; export wording preserved |

The brief's checks: legitimate clinic queries retained (30 of 30); sensitive information excluded (28 of 28 queries, 17 of 17 paths); existing integrations functional (above); reports cannot cross client boundaries (quality, association and existing RLS tests); no metric definition silently changed (pinned); no published report deleted (re-pull test and the delete-privilege test).

## 8. Files and migrations changed

**Migrations: none.** `migrations/` is unchanged (still 0001 to 0047). The database guard is in `packages/db/prepared/` and is not run by `db:migrate`.

New:

| File | Purpose |
| --- | --- |
| `packages/db/src/analytics/privacy.ts` | Privacy classification and evidence |
| `packages/db/src/analytics/privacy-scan.ts` | Read-only scan of stored values |
| `packages/db/src/analytics/quality.ts` | Report quality states and notes |
| `packages/db/prepared/analytics_property_one_client.sql`, `.down.sql`, `README.md` | Prepared guard, rollback, procedure |
| `packages/db/test/analytics-privacy.test.ts`, `privacy-corpus.ts` | Tests and fixtures, including the frozen old filter |
| `packages/db/test/analytics-property-association.test.ts`, `analytics-report-quality.test.ts`, `analytics-safeguards.test.ts` | Tests |
| `apps/platform/src/lib/audience-labels.ts` | Labels for audience figures |
| `apps/platform/src/components/modules/QualityNotices.tsx` | The notice |
| `apps/platform/src/lib/live-analytics-quality.test.ts` | Tests |
| this report | |

Changed:

| File | Change |
| --- | --- |
| `packages/db/src/analytics/measure.ts` | `safeSearchQuery`, `safeAnalyticsPath`, `sensitiveQueryKeys` delegate to `privacy.ts`. CSV header and metric-name checks keep their stricter word list |
| `packages/db/src/analytics/sync.ts` | GA4 dimensions classified; Search Console uses the classifier; `mergeDuplicateRows`; evidence via `PrivacyTally` |
| `packages/db/src/analytics/connections.ts` | Cross-client guard, `normalisePropertyId`, audited override |
| `packages/db/src/analytics/read.ts` | `publishedReport` returns `quality` |
| `packages/db/src/analytics/validation.ts` | Audit kinds, severities, consistency checks |
| `packages/db/scripts/analytics-association-audit.ts` | Also prints the stored-value scan |
| `packages/db/src/index.ts` | Exports |
| `apps/platform/src/lib/analytics-board.ts`, `live-analytics.ts`, `seo-workspace.ts` | Audience measure, quality notes |
| `apps/platform/src/components/modules/AnalyticsPanels.tsx`, `seo/OverviewPanels.tsx` | Labels and the notice |
| `apps/platform/vitest.config.ts` | `oxc: { jsx: { runtime: "automatic" } }` so component tests can run. Test runner only |
| `packages/db/test/analytics-provider-validation.test.ts`, `apps/platform/src/lib/analytics-board.test.ts`, `live-analytics.test.ts` | Updated for the new behaviour |
| `docs/analytics/03_FEATURE_MEASUREMENT_DICTIONARY.md`, `08_REPORTING_PRIVACY_RULES.md`, `docs/DECISIONS.md` (D71), `docs/BUILD_STATUS.md` | Documentation |

Unchanged: `vercel.json`, every provider module's request shape, the encrypted token code, the Analytics layout and navigation.

## 9. Remaining blockers

1. **No live validation yet.** Unchanged from Phase 2.3: no authorised non-production property or token.
2. **Phase 1 not closed** (section 6, items 1 to 3 and 6).
3. **Stored data written under the old rules is unmeasured.** GA4 landing pages and paths stored before 13 Nov may contain query strings or identifiers. The scan counts them on a restore point. Fixing any would be a new report generation, not an edit or a delete, and is your decision.
4. **Production associations unread.** The audit has not been run against anything but the local database.
5. **The database guard is not applied** and must not be until the audit is clean.
6. **Policy confirmation** of the "symptoms" reading.
7. **Vercel Root Directory** is still `apps/platform` (Phase 2.3), so no schedule can fire. Not touched.
8. **Intermittent slow test** (section 7).
9. **Not done from the Phase 2.3 recommendations:** H (compare GA4 property time zone at connect time), C and D (Wix `timeZone`, Search Console direct totals: both need live evidence), and the shared report-builder label.

## 10. Readiness for live provider validation

**Ready, with one change to the plan.** The live run in Phase 2.3 (`npm run analytics:validate … --live`, at most 14, 8 and 4 requests) now goes through the corrected pipeline, so it will also be the first test of the privacy rules on real provider output. That adds two things to check on the first real answer:

- the evidence's `withheldByPrivacyFilter` and `queryStringsStripped` counts: a high number of withheld rows on a real property would mean the rules need tuning against real text;
- `quality` notes in the output: whether GA4 reports a time zone different from the connection's, thresholding, or sampling for a small clinic.

What is still needed to run it is unchanged: a **non-client** property for each provider that Clinic Genie owns, a short-lived read-only token for each, and your written approval for about 26 requests. In addition, before any production data is touched at all, run `npm run analytics:audit` on a restore point so the association and stored-value findings are known.

Phase 2.4 has not started and will not without your instruction.
