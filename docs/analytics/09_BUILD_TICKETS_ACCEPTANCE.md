# Ordered implementation and acceptance plan

Implement one ticket at a time, reusing repository build rules. IDs extend the existing CG ticket series with an Analytics namespace. No ticket is completed solely by producing mocks. Production launch remains subject to existing release gates.

| Ticket | Work and dependencies | Concrete done evidence |
| --- | --- | --- |
| CG-AN-01 | Existing repo/runtime audit; use completed eight-screenshot audit; baseline route/component/metric inventory | Screenshot-to-component matrix; current function tests; hardcoded metric list; design token precedence |
| CG-AN-02 | Contracts and additive schema; depends 01 | Reviewed migration, tenant FKs/policies, query identities, source policies, deployment/recovery plan |
| CG-AN-03 | Provider connection shell and permissions; depends 02 | Two synthetic clinics; authorised binding, OAuth failure/reconnect/disconnect, no token exposure |
| CG-AN-04 | GA4 adapters and event audit; depends 03 | Test property results for every template; exact-range users; pageview dedupe; consent evidence |
| CG-AN-05 | Wix discovery/adapters and CSV preview; depends 03 | Actual site model discovery, supported metrics matrix, history probes, pagination and partial failure |
| CG-AN-06 | GSC adapter; depends 03 | Correct property/type/timezone, independent totals, top-row warning, pagination and source state |
| CG-AN-07 | Scheduler/worker, reconciliation and coverage; depends relevant 04-06 | Durable job lease/replay, partition atomicity, quota retry, checkpoint recovery, no form regression |
| CG-AN-08 | Existing Overview simplification; depends 01,07 | Existing four primary KPIs retained with correct definitions; verified trend/period comparison; summaries; duplicate-strip removal; preserved detail functions and screenshot comparison |
| CG-AN-09 | Traffic tabs and drill-downs; depends 08 | Acquisition/audience/landing/search reports, filters, supported source-specific combinations |
| CG-AN-10 | Behaviour tabs and instrumentation gaps; depends 08 | Page/contact/form/content reporting; durable enquiry separation; unsupported journeys gated |
| CG-AN-11 | Export, operational health and onboarding reuse; depends 09,10 | Scoped immutable export; formula safety; source/coverage metadata; second clinic via configuration only |
| CG-AN-12 | Regression, reconciliation, staged rollout and handover; depends 11 | Passing tests, source comparison evidence, feature-flag recovery, named maintenance owner |

## Practical release slices
A: connect one supported traffic provider and show real Overview + coverage; retain existing reports until replacements pass.
B: add Traffic and Behaviour detail and the other providers independently; unsupported panels remain explicit.
C: prove two-clinic reuse, exports, reconciliation and full regression before broader rollout.
Do not commit a calendar estimate before inspecting the repository and provider access. This expansion does not inherit the earlier 20-day launch promise.

## Required scenarios
| Test | Expected result |
| --- | --- |
| A01 Two clinic accounts query guessed site/report/export/job IDs | No cross-clinic rows or metadata; direct API proof |
| A02 Revoked/expired identity or unauthorised configure/export | Request denied; cached UI cleared |
| A03 OAuth forged, expired or replayed state; wrong selected property | No token binding, safe audited failure |
| A04 Paginated report fails after page 2 | Prior complete partition retained; new partition remains partial/unpublished |
| A05 Replayed scheduler/worker and concurrent refresh | One active job, stable results, no additive duplicate rows |
| A06 Refresh-token expiry/revocation or 429 | Locked refresh/backoff or reconnect_required; no infinite retries |
| A07 One user on three days/two devices | Full-range user total from provider; never sum day/device counts |
| A08 Same event recorded in Wix and GA4 | Selected source only; no combined contact/session total |
| A09 Same visitor clicks contact five times | Five clicks; session action rate only from distinct eligible sessions |
| A10 Form save failure then retry then notification retry | No false success, one durable enquiry, notification cannot create another |
| A11 Consent denied/granted and sensitive URL/UTM | Approved behaviour, no sensitive parameters transmitted or logged |
| A12 Date end boundary/month/DST/leap day | Exact expected ranges; GSC Pacific basis retained |
| A13 Tracking started halfway through range | Partial/Not tracked warning and coverage; no fabricated prior zero |
| A14 Prior period zero/missing, rates and weighted positions | New activity/Unavailable, percentage points and valid weighting |
| A15 GSC query rows less than property total | Separate correct total and incomplete-detail warning |
| A16 Provider zero rows vs failed connection | Empty vs failed/not_connected visibly distinct |
| A17 CSV overlap/replay/truncation/formula payload | Preview/reject or controlled replacement; no silent overwrite or executable export |
| A18 Filter/source/clinic switches during requests | No stale clinic data flash or mixed-provider panel |
| A19 Native SPA navigation and nested CTA click | Exactly intended dispatches; existing listeners not duplicated |
| A20 Provider outage and feature-flag revert | Public pages/forms/email unaffected; original report access retained |
| A21 Desktop/tablet/mobile keyboard/screen reader | Readable labels/tables, focus restoration, accessible chart alternative |
| A22 Changed connection/report policy | History preserved with source version; no unsupported stitched users |

## Reconciliation evidence
Choose a completed source-native day, a seven-day range and a month. Compare template totals against provider UI with matching property, date, timezone, filters, acquisition scope and metric definitions. Save query/template hashes and safe values. Mock fixtures must reconcile exactly. Live differences must be measured and explained; no arbitrary pass tolerance. If a dashboard statistic cannot be reproduced, leave that feature unsupported until resolved. Test partial periods separately.

## Handover and rollback
Report commit, changed files, migration IDs, exact lint/typecheck/test results, source query evidence, screenshots, known limitations and recovery path. Feature flag can restore existing UI/read path; disabling scheduler stops new work without deleting history. Restore/forward recovery must be demonstrated before any destructive changes. Initial implementation requires no destructive schema operation. Keep credentials and patient records out of evidence.


## Screenshot regression extension
The complete S01-S08 mapping and extra regression cases in 12_SCREENSHOT_RECONCILIATION.md are required acceptance criteria for CG-AN-08 through CG-AN-12. Newly documented existing controls (weekday averages, new/returning, page exits/time, form views/failures/location and navigation flows) are preserved capabilities, subject to their verified backend contracts. Their presence is not authorisation to invent data or expand into patient profiling.
