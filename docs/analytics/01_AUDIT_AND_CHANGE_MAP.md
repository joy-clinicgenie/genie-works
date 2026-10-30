# Existing Analytics audit and simplification
Version 1.1. All eight follow-up images visually inspected on 27 October 2026. Findings below distinguish visible evidence from runtime assumptions.

## Evidence register
All filenames begin `ChatGPT Image Oct 27, 2026, ` and end ` PM.png`. These are screen crops, not necessarily eight independent pages. No browser interaction or repository inspection was possible.

| ID / filename time | Visible page and components | Required disposition |
| --- | --- | --- |
| S01 / 04_38_53 | Analytics, clinic CG-001 Clementi Family & Aesthetic Clinic; clinic selector; Last 30 days and previous dates; updated time; Overview/Traffic/Behavior tabs; four large KPI cards; six smaller stats cards | Retain header, clinic code/name, tabs and four primary metrics. Standardise visible Behaviour spelling while preserving route. Remove duplicated small-card strip after preserving page/post views in Behaviour |
| S02 / 04_38_58 | Performance trend with Previous/Current channel bars; Needs attention; top traffic sources; contact actions; enquiry overview | Keep compact health strip, top sources, contact summary and distinct stored enquiry count. Period bars belong in Traffic report; daily trend only with actual daily facts |
| S03 / 04_39_02 | Enquiry funnel; form performance with completion and failures; contact-action breakdown; landing-page sessions/contact clicks | Move form detail into Behaviour > Forms and enquiries; contact detail into Interactions; landing report into Traffic. Gate funnel sequencing and landing attribution |
| S04 / 04_39_07 | Enquiries by source; device comparison plus bounce rate; Google Search performance | Move source enquiries to Behaviour form tab with acquisition cross-link; device counts to Traffic > Audience; bounce to Behaviour; search detail to Traffic > Organic search |
| S05 / 04_39_11 | Data connection status: website analytics, Google Search, paid campaigns; last export text; AI disclaimer | Retain health functionality in Data sources drawer / Settings. Distinguish imports, API connection, last sync and export. Preserve existing paid-campaign placeholder access without building Ads integration. Put AI scope explanation in help |
| S06 / 04_39_16 | Traffic Overview; sessions/users; daily trend; source/category controls; weekday averages; new/returning donut; device donut; View Report links | Preserve these functions in Traffic default Acquisition view and Audience tab. Keep daily chart only with verified daily input; retain period comparison alternative. Weekday/new-returning contracts added in 12 |
| S07 / 04_39_19 | Behavior Overview; duration/pages-per-session/bounce strip; searchable top pages with Visits/Button clicks/Avg time/Exit rate controls; Top clicks list | Preserve controls and report links under Behaviour. Rename ambiguous Visits after source verification. Add missing exit/time/page-action capability contracts. Separate general navigation clicks from contact counts |
| S08 / 04_39_22 | Three-column navigation flow; page selection instruction; Form submissions: views/starts/submissions, enquiries, source/location controls | Preserve navigation flow capability under Behaviour > Journeys; do not disable an existing verified backend. Sequence-gate only unsupported implementations. Preserve form views and location/source breakdown controls with safe aggregate definitions |

## Observed findings and corrective actions
| ID | Evidence | Finding | Required correction |
| --- | --- | --- | --- |
| V01 | S01 | Four primary KPIs repeated across six small cards. Sessions, visitors, contacts and submissions appear twice | One primary KPI strip. Move page views to Pages and post views to Content; no metric discarded |
| V02 | S02/S03 | Same 41 contact clicks and 19/11/6/5 breakdown repeated, with additional funnel text | One compact Overview summary linking to one canonical Interactions report |
| V03 | S01/S02/S08 | Successful submissions 13 and stored enquiries 14 are distinct counts; this can be valid but source/scope needs explaining | Retain both, label tracked successful submissions versus stored enquiries. Explain gap; never force totals to match |
| V04 | S04/S08 | First enquiry-source table sums 14 (organic 8); form source panel sums 13 (organic 7) beside 14 enquiries | Establish panel count unit/filter. Same backend scope must reconcile, or label the 13 as measured submissions if confirmed. Do not edit facts to fit |
| V05 | S01/S07 | 2,388 page views / 1,263 sessions = about 1.89, not displayed 2.3 | Validate definitions/source/date; expected same-scope pages per session rounds to 1.9. If intentionally different, show explicit source/scope and provider metric definition |
| V06 | S01 | Unique visitors explanatory text says One person | Replace with measured distinct visitor/user identifiers. Cross-device or cookie changes can count the same person differently |
| V07 | S02/S06 | Period chart states two recorded periods and no daily chart; Traffic nevertheless has daily curve | Verify daily table/provider responses. Period totals cannot generate daily shape. Source/coverage labels must explain any real difference |
| V08 | S02/S03 | Overview says page-level sessions are not recorded, but landing report shows sessions by path | Distinguish entry-page session totals from all visited-page sessions. Verify entry dimension; if absent mark unavailable |
| V09 | S04 | Device counts alone do not establish visitors struggle to contact; bounce included as a separate row without device breakdown | Label device mix neutrally. Claim friction only using supported per-device outcomes, denominators and evidence |
| V10 | S04 | Search subtitle excludes average position but row includes it; unchanged 8.2 shown as upward 0% | Correct subtitle; unchanged neutral state; position measured in positions, not percent improvement |
| V11 | S05 | Not connected shown alongside populated reports elsewhere; Last export says See the period above | Show whether values are recorded/imported/demo/API data; provide actual timestamp or Unavailable; no inference that values are live |
| V12 | S08/S03 | Navigation first-page home 783 differs from landing-page home sessions 429 | Reconcile cohort, metric, timeframe and source; can be different only with explicit scope. Flow edge validity must be verified |
| V13 | S07 | Top pages Visits values 812/525/430/334/287 sum exactly to 2,388 page views | Confirm likely page-view meaning; cannot establish a sessions report from the label. Rename to Page views only after verifying input |
| V14 | S01/S06/S07 | Reporting range includes 27 October; updated at 10:01 and current date is 27 October | Mark current day partial and compare equivalent elapsed periods, or default completed dates. Preserve 30-day preset |
| V15 | S05 | Paid-campaign and AI text mixed into Analytics status | Preserve existing campaign status access; no Ads/GEO expansion. Use concise context-specific help |
| V16 | S08 | Flow occupies a small left area in a very wide card | Responsive focused flow panel; use remaining space for selected path detail/drop-off definitions, or a constrained card |

## Confirmed styling to preserve
Pale aqua canvas and active tab, dark teal text, teal primary sessions card, white rounded panels, thin dividers, compact labels, line/bar/donut charts and the existing generous desktop grid. Screenshots do not establish exact font family or token values. Inspect CSS/tokens rather than guessing or replacing them. Keep clinic name/code and current date selection conventions. Use the existing 30-day default if persisted; do not silently replace with the earlier proposed 28-day default.

## Repository discovery still required
Map every screenshot component to actual route/file/hook/query and permission. Inventory chart controls, View Report destinations, visitors, durations, form-location report and flow source before moving UI. Retain public-site tracking including existing GoogleAnalyticsPageViews.tsx if present. Check hardcoded values, source/refresh behaviour and all unsupported state handling. Screenshot appearance alone is not API evidence.

## Simplification acceptance
Overview has one four-card KPI strip, one genuine trend or honest period comparison, and compact source/action-enquiry/page summaries. Detailed existing features remain accessible in Traffic or Behaviour. Preserve existing usable control behaviour, report links and saved selections. Visual evidence review is complete; runtime, responsive behaviour and replacement regression remain open.
