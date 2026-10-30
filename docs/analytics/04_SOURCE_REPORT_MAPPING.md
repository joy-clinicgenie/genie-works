# Provider and report contracts

## Source ownership
| Report family | Legacy Wix website default | Native website default | Never combine |
| --- | --- | --- | --- |
| Traffic, pages, audience | Verified Wix semantic report; Data API for supported totals only | GA4 Data API | Wix sessions + GA4 sessions |
| Interactions | Wix only if report fields exist; otherwise explicit GA4 source for whole family | GA4 approved events | Same clicks from both providers |
| Stored enquiries | Existing backend or verified Wix submission adapter | Existing backend | GA4 successes + backend submissions |
| Organic search | GSC | GSC | Search clicks + website sessions |
| Confirmed bookings | Verified booking adapter if present | Same | Booking-link clicks + bookings |

Provider choice is versioned per website/report family and effective period. A migration within one range creates separate labelled periods or an incompatibility warning. Do not silently stitch user counts or percentages. Keep original source facts available. Native tracking emits agreed events to GA4 and the existing backend where appropriate; a new general-purpose session tracker is not required by this build.

## Wix
Prefer Semantic Model discovery: list models, inspect selected schema and dependencies, then query only returned measure/dimension names. Store model ID, schema hash, field mapping and tested report combinations per connected site. Support pagination, explicit interval and typed values. Its availability is not proof that every Wix dashboard chart is accessible. Authentication requires appropriate app/user identity and Site Analytics read access; establish actual installation flow from current Wix app documentation at implementation.

Data API is a narrower fallback for documented measurement types. The checked Get Analytics Data documentation specifies 62 days of stored data and an exclusive end date. That limit must not be generalised to Semantic Model history, Wix UI or exports. Confirm oldest retrievable date by endpoint/site using bounded probes. Unsupported dimensions return Unavailable, not estimated breakdowns.

## GA4 report templates
Use Data API runReport, current metadata and compatibility validation. Requests are separate report families; do not make one huge cross-product query. Names below are proposed API mappings, with compatibility verification required for each template.

| Template | Dimensions | Metrics / filter |
| --- | --- | --- |
| range_totals | None | sessions, totalUsers, activeUsers, engagedSessions; page views in separate validated web query |
| traffic_daily | date | sessions, totalUsers; view metrics if compatible |
| channels | sessionDefaultChannelGroup | sessions, totalUsers; no firstUser dimensions |
| sources | sessionSource, sessionMedium | sessions, totalUsers |
| campaigns | sessionCampaignName, sessionSource, sessionMedium | sessions; remaining metrics only if compatible |
| landing_pages | landingPage | sessions, totalUsers, engagementRate if compatible |
| pages | pagePath | eventCount filtered eventName=page_view for pure web views; users from a compatible page report |
| audience_device | deviceCategory | sessions, totalUsers |
| audience_country | countryId | sessions; city separate optional report |
| technology | browser or operatingSystem | sessions, separate queries |
| event_counts | eventName | eventCount, filter approved interaction events |
| event_cta | eventName, customEvent:cta_id, customEvent:placement | eventCount; requires registered dimensions |
| event_page | eventName, pagePath | eventCount, compatible only |
| search_visibility | Not GA4 | GSC template below |

Restrict mixed properties to correct web stream/hostname using verified metadata and compatible filters; record the filter in report identity. A GA4 measurement ID is not a property ID. Event parameter registration does not reconstruct previously unreported history. Do not assume passing event_id makes GA4 deduplicate arbitrary custom events: prevent repeated dispatch at the application boundary and document delivery uncertainty.

## GSC templates
Independent search_totals, search_daily, search_queries and search_pages queries, with optional country/device filters. Default type web; maintain consistent aggregationType. Keep query and page dimensions separate initially to limit sparse/truncated results. Use source-native dates and label Pacific Time. API returns top rows and does not guarantee exhaustive results; query totals must not be rebuilt by summing visible queries. Pagination does not remove that limitation. Preserve preliminary/final state when supplied.

## Capability result
Each adapter returns supported/unsupported/permission_missing/not_configured for each template and metric, oldest_available_date, provider_timezone, tracking_start, schema_version and limitations. Bind only after fetching a safe test report from the selected property. A capability must pass on two test clinics before labelled reusable.

## Report template identity
Hash provider, connection version, family, metric version, sorted dimensions, validated filters, inclusive logical date range, source timezone, search type/aggregation and environment. Changes invalidate the correct cache only. Report response includes all these fields and provider quality metadata. No patient ID, contact information or arbitrary raw URLs in query identity.
