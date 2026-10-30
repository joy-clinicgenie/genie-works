# Screenshot reconciliation and preserved function contracts
Version 1.1 | 27 October 2026. Read with the complete S01-S08 inventory in 01.

## Displayed values are audit evidence
The clinic name and figures below are transcribed solely to reconcile the images. They are not certified live clinic results and must not be seeded into production. A populated screenshot cannot prove a live API or database query.

| Measure | Screenshot evidence | Check |
| --- | --- | --- |
| Sessions | 1,263; previous 1,188 | Change about +6.3%, internally consistent |
| Unique visitors | 972; previous 905 | Change about +7.4%, internally consistent; definition must not claim distinct real people |
| Contact clicks | 41; previous 36 | +13.9%; 19 WhatsApp + 11 phone + 6 email + 5 booking = 41 |
| Successful form submissions | 13; previous 9 | +44.4%; keep distinct from accepted backend enquiry totals |
| Stored enquiries | 14; previous 11 | +27.3%; source and exclusion policy required |
| Page views | 2,388; previous 2,140 | +11.6%; page rankings 812+525+430+334+287 also sum 2,388 |
| Post views | 241; previous 266 | About -9.4%; retain in Content after duplicate strip removal |
| Average pages/session | Behaviour displays 2.3 | Same-source 2,388/1,263 = 1.8907, ordinarily 1.9. Confirm metric scope before changing |
| Form starts | 31; form successes 13 | Aggregate 13/31 = 41.9% is arithmetic only. Cohort membership is unverified |
| Submission failures | 1 | A failed attempt may later recover; do not subtract from stored enquiries or equate all non-completers to failures |
| Form views | 104 | Define count unit and event activation; not page views by default |
| Device sessions | 884 mobile + 354 desktop + 25 tablet | Sum 1,263; shares round to 70/28/2%. No proof of contact difficulty |
| Channel sessions | 684 organic + 221 paid + 204 direct + 78 referral + 52 social + 24 email | Sum 1,263; valid arithmetic does not prove provider lineage |
| Source enquiries, Overview | 2 direct + 8 organic + 2 paid + 1 referral + 1 social | Sum 14 |
| Source panel, Behaviour | 2 direct + 7 organic + 2 paid + 1 referral + 1 social | Sum 13 alongside Enquiries 14. Unit or one missing attribution must be resolved |
| Search | 531/15,840 current; 488/14,220 previous | CTR about 3.3523% current and 3.4318% previous; display 3.4% and 3.4%, difference about -0.0795 percentage points before rounding |
| Search position | 8.2 current and previous | Display No change if true underlying values equal. No green upward +0% |
| Landing-page sessions | 429+278+227+177+152 | Sum 1,263; only valid if entry-page metric, not visited-page session attribution |
| Home flow entry | 783 versus landing home 429 | Reconcile source, period, cohort and unit; no silent conflicting entry totals |
| Flow columns | Second step 313+188+172+110 = 783; third 423+188 = 611; claimed drop-off 172 | Arithmetic can conserve 783 = 611+172, but edge paths, cohort and drop-off placement need actual sequence evidence |

## Preserve controls and definitions missing from the first pack

### Traffic: sessions by source and category
Keep the two visible selectors and View Report. Metric choices must come from supported report capabilities, with source-specific labels. Grouping choices can include channel/category and source/medium, but never reinterpret session source as first-user source. Each choice replaces data, legend and definition together. Preserve existing choices discovered in code. The screenshot proves dropdown appearance, not which hidden options currently work.

### Traffic: new versus returning
The screenshot shows New 826 and Returning 146, an apparently exclusive split totalling 972. Do not reproduce this by totalUsers minus newUsers. GA4 new and returning users can overlap over a multi-day period; if such metrics are used, use separate labelled bars/counts with overlap note, not a forced 100% donut. A provider-supported mutually exclusive session classification can use a donut only if labelled sessions and query denominator match. Preserve an existing verified Wix visitor split under its original definition. Lack of capability means Unavailable, not fabricated 85/15 shares.

### Traffic: average sessions by weekday
Keep the weekday bar report and report link. For each weekday, use sum of daily sessions divided by count of complete covered source-local dates of that weekday. Include covered zero dates, exclude missing/partial dates and disclose covered/eligible occurrences. Do not average raw rows across different scopes or use a simple mean of seven weekday averages as the whole-period average. Labels are average sessions per Monday, etc. The shown 47/48/52/51/50/23/22 cannot be independently verified without actual daily rows.

### Behaviour: top-page metric selector and search
Preserve Visits, Button clicks, Average time on page and Exit rate capabilities, search input and View Report. Resolve Visits to Page views or session visits from actual code/provider definition, not appearance. The screenshot values happen to sum to displayed page views; that is a diagnostic clue, not source proof. Changing metric updates unit, ranking order, tooltip, scale and unavailable states. Page button clicks are event-page counts. Average duration uses a documented page denominator; GA4 engagement per active user is a separate label. Exit rate requires measured exits and eligible page units or validated sequences. If unsupported, keep a disabled selector item with explanation rather than manufacturing a result or deleting a previously working feature.

### Behaviour: Top clicks
Services menu 101 and Directions 14 are generic navigation/utility interactions. WhatsApp 19, Call 11, Email 6 and Book a visit 5 form the contact total 41. All six displayed rows total 156; never label 156 as contact clicks. Retain the full Top clicks report in Interactions. Use stable CTA IDs and placement/page dimensions when supported. Directions remains a separate action, not a confirmed clinic visit or contact enquiry.

### Forms: views, starts, successes, failures and completion
Retain form_view/form_start/form_submit_success concepts and existing backend success/attempt logging if implemented. Define form view as actual visible form instance, deduplicated per rendered instance/session policy; page loads without a form do not count. Define form attempt ID as random, short-lived, not a patient identifier. Failures count submit attempts by safe category (validation, network, rejected, storage unavailable) with no raw field content. Retries of the same accepted request cannot add stored enquiries. Different deliberate attempts may occur in one session.

Cohort completion = distinct started attempts in cohort that achieved accepted success within 24 hours / distinct eligible started attempts in cohort. Cohort date is first meaningful start; recent cohorts stay provisional until window closes. Use consented matching data and preserve the approved existing policy if different, with explicit definition/version. Aggregate API counts that cannot establish cohort membership may be displayed side by side; ratio must be called Submission events / start events, explicitly not completion or conversion rate. Do not display 41.9% as verified completion merely because 13/31 calculates it. Store cohort summaries in versioned report partitions; raw attempt linkage, if newly required, needs privacy/minimisation/retention decision before collection.

### Enquiries by source and Locations
Reuse backend accepted-submission aggregates from existing Enquiries infrastructure, not browser success events. All source rows including Unknown must reconcile to the same non-test stored total, website, form filters and date basis. The discrepancy 14 versus 13 may instead reflect different units; verify before correcting labels. A clinician/manual import enquiry is included or excluded under documented policy and identified in provenance, not guessed from screenshots.

The Locations control is visible but its content is not shown. Discover its current meaning in code. If it means clinic branch, map approved branch ID and label Clinic location. If it means visitor geography, expose only coarse consented provider aggregates and label Visitor country/region. Avoid linking analytics visitor geo to an identifiable stored submission. For backend geography without lawful, approved aggregate evidence, report unavailable. Preserve any existing safe implemented report.

### Journeys: navigation flows
Keep existing first/second/third page selection and View Report behaviour when a verified implementation exists. Metric is consented sessions with ordered pageview events, cohort based on session entry and selected range. Session ordering uses event timestamp plus stable event-order tie-breaker; document whether repeated consecutive identical pages are kept or collapsed (baseline: keep valid navigation events, remove only duplicate instrumentation). Select page changes a clearly labelled starting cohort; default is entry page, not arbitrary visits to page.

Each parent outgoing edges plus Drop-off/Other/Unknown must equal its eligible count. Use one session per path position; top-N branches preserve Other counts. Drop-off means no next observed navigation within the defined 30-minute inactivity session, not browser-close or clinical loss. Preserve incomplete tracking caveats; late-arriving data can change counts. Don't derive edge flows from page totals or a landing-page table. A sankey can use separate child counts if each edge is measured; no invented proportional allocation. Show a path table alternative for accessibility. Reconcile the home 783 entry against 429 landing sessions using explicit filters before release.

### Health and dates
Keep current selection/history conventions. The shown 28 Sep-27 Oct and preceding 29 Aug-27 Sep are adjacent 30-day ranges. At an update on 27 Oct 10:01, 27 Oct is incomplete. Either preserve that choice with Partial today and equivalent-elapsed comparison or show last 30 completed dates by default (27 Sep-26 Oct on 27 Oct). Do not silently reinterpret the displayed range.

A saved reference is not live integration, as the screenshot already states. Preserve this distinction and existing historical records. Every populated report needs api/imported/recorded/demo provenance. Not connected does not by itself imply fabricated data. Never call the screenshot numbers live. Expose source-specific last successful sync, measured-through, last import and last report export as separate timestamps; See period above is not a timestamp. Preserve form-notification health link without duplicating private operational records. Paid campaigns/AI remain current status/help links, not new implementation scope.

## Additional provider templates / schema implications
Add capability-gated templates: weekday_daily_sessions (derive from traffic_daily); new_returning with verified overlap semantics; page_button_clicks; page_time; page_exits; form_views; form_failure_attempts; form_completion_cohorts; enquiry_sources; enquiry_locations; navigation_edges. Version each independently, storing metric unit, count scope and filters in the query hash. Existing report partition/row/value tables can store their aggregates. No raw journey/attempt table is mandated by screenshots. Enable new raw collection only if already authorised and technically justified.

## Regression checks added to ticket plan
- S01 metric strip rendered once; page/post views remain accessible after removing six-card duplicate strip.
- Header keeps current clinic code/name, 30-day preset, date comparison and three-tab navigation. UK English label Behaviour preserves any existing route.
- Same-scope page views/sessions derive 1.8907 before rounding; different provider scope must be visibly explained.
- Enquiry source totals reconcile or explicitly distinguish measured events from backend enquiries; Unknown preserved.
- Daily curve cannot render from only Previous/Current totals; a period comparison remains available.
- Selector controls/search/View Report/form Locations/navigation flow preserve working behaviour with keyboard support.
- New/returning overlap cannot create false exclusive donut; weekday averages correctly handle missing and zero dates.
- 101 menu + 14 directions do not inflate contact total 41.
- Form completion cannot use unmatched event totals; failed attempts and retry recovery never create extra enquiries.
- Flow edge/Other/Drop-off accounting conserves session cohort and states source/coverage.
- Search average-position subtitle and change icon agree with included metric; no false green +0%.
- Status drawer distinguishes API connection from imported/recorded values and provides actual available timestamps.
