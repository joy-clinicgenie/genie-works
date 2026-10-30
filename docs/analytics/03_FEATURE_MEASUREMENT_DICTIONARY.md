# Feature and measurement dictionary

This is the complete scoped inventory for this build. Optional rows are explicit capabilities, not promises that Wix exposes every dashboard statistic through an API. Provider field names and query compatibility must be verified during connector discovery. Persist metric version, source and aggregation semantics.

## Metric catalogue
| ID / feature | Purpose | Measurement and aggregation | Source / availability |
| --- | --- | --- | --- |
| M01 Sessions | Volume of website visits | Provider session total for selected range. Add daily values only where provider confirms temporal additivity. Never add page-level sessions to get site sessions | Wix mapped field or GA4 sessions |
| M02 Unique visitors / total users | Reach | Provider distinct count over exact selected range; never sum daily/device/page user counts. Label with provider wording | Wix unique metric if exposed; GA4 totalUsers |
| M03 Active users | Engaged reach, optional detail | GA4 provider-defined activeUsers for range. Not interchangeable with totalUsers | GA4 only unless semantic equivalence documented |
| M04 New users | New measured audience | Provider newUsers definition, affected by device/cookie resets; not identified people | GA4, Wix capability-dependent |
| M05 Page views | Content consumption volume | Repeated views count. Web page_view only; exclude app screen_view in mixed properties with a validated filter/query | Wix page views; GA4 filtered eventCount or validated screenPageViews |
| M06 Views per session | Browsing depth | Compatible page views divided by same-source/same-scope sessions, zero denominator unavailable | Derived or provider metric |
| M07 Engaged sessions | Meaningful measured visits | Use provider configured engagement definition, not a new Clinic Genie definition | GA4 engagedSessions |
| M08 Engagement rate | Share of engaged sessions | engagedSessions / sessions. Aggregate weighted components; changes in percentage points | GA4 engagementRate or compatible components |
| M09 Bounce rate | Short/non-engaged visit diagnostic | GA4 1 - engagement rate; Wix definition kept separately. Do not compare incompatible definitions | Capability-dependent |
| M10 Average engagement time per session | Attention while site foregrounded | GA4 userEngagementDuration / compatible sessions, in seconds. Not average visit duration | GA4 compatible query |
| M11 Provider session duration | Visit duration, optional | Provider average with documented weighting; separate from M10 | Wix only if exposed and defined |
| M12 Contact clicks | Contact intent volume | Sum mutually exclusive tracked click types: phone, WhatsApp, email, booking link. Count events, not people. An activation emits one contact event | One selected interaction source |
| M13 Contact-type clicks | Channel of intent | eventCount filtered to approved event name and safe dimensions | Wix mapping or GA4 custom events/native aggregates |
| M14 CTA/button clicks | Which controls are used | Approved CTA events by stable ID, placement and path. Generic clicks and contact events must not both enter M12 | Instrumentation required |
| M15 Form starts | Interest in submitting | First meaningful interaction once per form attempt; not input focus alone | Approved custom form_start, not overlapping automatic tracking |
| M16 Measured form successes | Tracked accepted submissions | Emit form_submit_success after durable server acceptance; client retries guarded. Provider aggregate may differ from storage | GA4/custom instrumentation |
| M17 Stored enquiries | Actual accepted enquiry records | Count distinct non-test accepted submission IDs by created_at in registry timezone, independent of notifications/status changes | Existing backend, or verified Wix form records adapter |
| M18 Confirmed bookings | Verified outcome | Distinct provider booking ID under documented confirmation/cancellation rule; no click-based inference | Optional verified booking adapter |
| M19 Session action rate | Share of visits containing an action | Distinct action-bearing sessions / eligible same-source sessions. Never event count / sessions labelled conversion rate | Dedicated provider query or consented native session aggregates |
| M20 Enquiry/source distribution | Acquisition context for stored leads | Count backend records by persisted safe attribution. Unknown stays unknown; no join to patient details in analytics | Backend aggregate with explicit attribution policy |
| M21 Landing-page sessions | Entry-page effectiveness | Session count grouped by entry page; not sessions visiting any page | Wix entry dimension or GA4 landingPage |
| M22 Channel/source/campaign share | Acquisition mix | Segment sessions / unfiltered compatible source total. Expose Others and Unknown separately | Dedicated acquisition report |
| M23 Country/city | Approximate geography | Provider-derived coarse location; count chosen sessions metric, not exact patient residence | Provider capability; city optional |
| M24 Device/browser/OS | Technical audience mix | Compatible sessions by reported dimension; distinct user totals not additive | Provider capability |
| M25 Blog/content views | Content usage | Same-source page views filtered by versioned content registry and path. Historical slug/title retained | CMS registry plus page report; Wix blog mapping if available |
| M26 Scroll interactions | Content reach signal | Default GA4 scroll event is approximately 90% depth under configured enhanced measurement; custom thresholds must be named explicitly. Event count or distinct users clearly labelled | Optional tracking |
| M27 Outbound/download/video | Useful content interactions, optional | Approved event definitions and compatible counts; each separate from contact clicks | Existing tracking or separate instrumentation ticket |
| M28 GSC clicks | Organic Google Search visits initiated | Search Console click total, not GA4 sessions | GSC Search Analytics |
| M29 GSC impressions | Search exposure | Provider impression total with consistent property/page aggregation | GSC |
| M30 GSC CTR | Search click propensity | total clicks / total impressions; do not average row CTRs | GSC/derived |
| M31 GSC average position | Search result position diagnostic | Provider range statistic, or impression-weighted compatible rows. Not a fixed keyword rank | GSC |
| M32 Search queries/pages | Search demand and landing visibility | Returned query/page rows may omit data; totals come from separate aggregate report | GSC |
| M33 Realtime active users | Current activity diagnostic, optional | Separate GA4 Realtime report; rolling provider window. Not daily visitors or simultaneous exact headcount | GA4 Realtime, separate from historical KPIs |
| M34 Funnel progression | Sequence drop-off, optional | Same eligible consented session completes defined ordered steps within 30 minutes, or documented provider funnel semantics. One session per step; dates based on session start | Not derivable from daily aggregate reports |

## Staff features
| Function | Purpose | Rules |
| --- | --- | --- |
| Date/comparison controls | Repeatable reporting | Inclusive UI dates converted per adapter; prior equal-length period or prior year with explicit leap-day mapping |
| Source selector | Honest comparison | Deliberate switch, no blending; definitions and gaps follow source |
| Metric tooltip | Staff understanding | Definition, unit, scope, source, formula, exclusions, tracking start and limitations |
| Table search/sort/pagination | Find reports quickly | Server-side, stable tie-breaker, no change to headline total |
| Filters/drill-downs | Investigate findings | Apply only supported dimension combinations; visible chips and Clear all |
| Refresh | Request newer data | Enqueues bounded deduplicated job, retains current snapshot, shows progress |
| Sync health | Diagnose data availability | Last attempt, last success, measured-through, next run, partial/failed state |
| Connect/reconnect | Reusable onboarding | Privileged OAuth flow, explicit property/site binding and audited changes |
| CSV historical import | Preserve older data | Preview mapping, source/timezone, duplicate/overlap check, row/coverage validation |
| Export | Share exact report | Scoped server export with provenance, dates, filters, units and missingness |
| Annotations | Explain changes | Deployment/tracking/source changes only; safe staff text, no patient details |

## Additivity and distinct counts
The database stores additive counts separately from exact-range aggregates. Request full-range distinct user totals and selected segment totals from the provider, cache by canonical query. A missing full-range result returns Pending or Unavailable, never sum(daily users). For historic ranges outside provider reach with no stored exact-range result, unique visitors remains unavailable. A report request should schedule and retain range snapshots for common weekly/monthly reporting before source history expires.

Do not calculate action rates or ordered journeys from aggregate event counts. Repeated contact clicks can exceed sessions. Rate formatting cannot repair a wrong numerator.


## Additional features observed in all eight screenshots
These supplement M01-M34; implementation contracts, units and edge cases are in 12_SCREENSHOT_RECONCILIATION.md.

| ID / feature | Purpose | Measurement / source |
| --- | --- | --- |
| M35 Returning audience | Repeat measured visits | Provider-defined returningUsers/newVsReturning only after metadata/compatibility check; Wix mapping per site. No totalUsers - newUsers shortcut |
| M36 Average sessions by weekday | Timing pattern | Sum complete daily sessions for weekday / number of covered occurrences including covered zero days; incomplete dates excluded and disclosed |
| M37 Average time on page | Page attention diagnostic | Actual provider page-time metric with documented numerator/denominator; GA4 page engagement per active user labelled separately, never passed off as Wix time on page |
| M38 Exit rate | Ending-page diagnostic | Documented exits / eligible page visits or views at identical grain; backend sequence data or exposed provider field required. No bounce-rate substitution |
| M39 Form views | Form exposure | Approved form_view event once per actual rendered/visible form instance under chosen policy; not all page views. Event counts versus distinct attempts explicit |
| M40 Failed submission attempts | Form reliability | Count deduplicated failed submit attempts with safe failure category, not validation text. Retry recovery remains separate; absence of events is not proof of no failures |
| M41 Form completion | Completion of form attempts | Successful started attempts / eligible started attempts in a bounded same-cohort report, not ratio of unrelated event totals |
| M42 Navigation flows | First pages opened in order | Session-entry cohort with ordered pageview events and validated transition counts, end/other/unknown handling and coverage; existing verified adapter preferred |
| M43 Page button-click rankings | Which pages host interactions | Approved CTA event counts grouped by event page, not inferred landing-page credit; existing selector retained |
| M44 Enquiry locations | Coarse acquisition geography | Authorised aggregate counts by explicitly defined visitor geo or configured clinic branch. Those meanings must not be conflated; no patient address or inferred precise residence |
