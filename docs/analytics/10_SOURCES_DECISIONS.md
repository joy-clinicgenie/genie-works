# Evidence, sources and decisions
Checked 27 October 2026. Recheck current official contracts during implementation. Source facts below support capability boundaries; the architecture, schema and operating schedules are Clinic Genie design proposals.

## Official sources
| Source | Fact used / boundary |
| --- | --- |
| [Wix Analytics introduction](https://dev.wix.com/docs/api-reference/business-management/analytics/introduction) | Distinct Semantic Model, Data and Sessions APIs; tracking APIs are not automatically reporting APIs |
| [Semantic Model introduction](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/introduction) | Inspect schemas and dependencies; explicit date interval; paginate beyond up to 1,000 rows |
| [List Semantic Models](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/list-semantic-models) | App/user identity and Site Analytics read permission |
| [Get Semantic Model](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/get-semantic-model) | Field discovery; actual response must determine mapping |
| [Query Semantic Model Data](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/query-semantic-model-data) | Query fields, filters and pagination; do not invent field names |
| [Wix Data API Get Analytics Data](https://dev.wix.com/docs/api-reference/business-management/analytics/data/get-analytics-data) | Documented 62-day history for this endpoint and exclusive end date; not universal Wix retention |
| [Wix Traffic Overview](https://support.wix.com/en/article/wix-analytics-overviews) | Reporting is affected by cookie consent and blockers |
| [GA4 Data API basic reports](https://developers.google.com/analytics/devguides/reporting/data/v1/basics) | runReport for reporting; property-specific requests |
| [GA4 dimensions and metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema) | sessions, totalUsers, eventCount, engagement metrics and dimension names; compatibility still needs testing |
| [GA4 API quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas) | Quota-aware scheduling and concurrency are required; do not hardcode a universal allowance |
| [GA4 realtime](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runRealtimeReport) | Dedicated realtime report, separate historical reporting |
| [GSC Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) | Source-native PT inclusive dates, page/query dimensions, top-row limitations and pagination |
| [GSC prerequisites](https://developers.google.com/webmaster-tools/v1/prereqs) | Correct property permissions and OAuth required |

The Wix Get Analytics Data page was available via official search extracts; full-page retrieval failed. Confirm its current full contract before implementation. The research does not prove installed-site permissions or actual model availability.

## Decisions locked for this proposal
Three Analytics destinations. Overview stays concise. Existing platform/design remains. One provider per report family and period. Backend accepted enquiries separated from measured intent. GSC has separate search scope/timezone. Cached database reporting with durable scheduled sync. No public-site dependency on Analytics. Multi-clinic configuration and strict tenant isolation. No fabricated live data or unsupported dimensions.

## Open evidence and implementation decisions
| Item | Owner / resolution | Blocks |
| --- | --- | --- |
| Eight screenshots | Complete: S01-S08 visually inspected and mapped in 01; reconcile actual repository components next | Runtime/function regression and safe reorganisation |
| Complete earlier research artefact | Retrieve if made available, compare recommendations | Claim of complete prior-research reconciliation |
| Actual application repository/runtime | Implementer inventories routes/code/schema/dependencies | Code changes and regression proof |
| Running design system/font | Inspect installed tokens; preserve current typeface | New UI integration |
| Selected DB/auth/job infrastructure | Inspect current implementation; reuse compatible services | Executable migrations and scheduling |
| Google/Wix permissions, IDs and app setup | Account owner grants required access; bind explicitly | Live connector validation |
| Wix semantic metrics/history per site | Adapter discovery/test queries | Specific Wix reports/backfill claims |
| Event names, activation dates and consent | Audit current tracking; map to versioned definitions | Accurate interaction reporting |
| Retention and any raw journey tracking | Clinic/platform owner decides before collection | Raw session events, not aggregate planning |
| Confirmed bookings adapter | Verify existing provider evidence or mark absent | Confirmed outcome reporting |

User approval of a plan is not required for routine reversible implementation choices already in scope. These items identify missing evidence and credentials, not a blanket permission gate. No paid vendor selection or production migration is authorised merely by this pack.
