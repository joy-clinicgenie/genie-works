# UI and API contracts

## Existing design
Reuse the app shell, installed typeface, spacing, panel, button, select, tooltip, chart, table, empty-state and drawer components. Only add a shared component when an existing primitive cannot satisfy the contract. Accessible labels, visible focus, table headings, keyboard drawers and chart data alternatives are required. Status must use text/icon as well as colour. On narrow screens stack cards and use labelled table overflow without losing actions. Capture 1440px, 1024px and 390px as proposed QA widths, adapting to existing breakpoints.

## State model
A report is loading, ready, partial, empty, not_tracked, not_connected, unsupported, stale, failed or forbidden. Empty means a successful complete query with no observations. An unavailable report cannot show zero. A fresh database fetch containing old provider data is still old coverage. Display per-panel states; a GSC failure must not blank GA4 traffic. Loading placeholders should preserve card sizes. Source changes cancel/ignore obsolete responses.

## Interaction rules
- Date/source changes fetch a new scoped snapshot and update a shareable URL. Never put secrets or patient text in URLs.
- Header filters and tabs persist within a website; switch clinic resets all dependent state and aborts old requests.
- Hover/focus tooltips expose definitions. A clicked KPI changes the trend metric only when supported; it never navigates to an unrelated page.
- Ranking click adds a visible filter only when that joint report is supported. A purely visual row highlight is not a new measurement.
- Pagination/sort retain filters; server totals cover all rows, not just the visible page. Limit 25/50/100. Deterministic tie-break by canonical dimension key.
- Refresh shows queued/running/completed/failed status, disables repeat enqueue and retains snapshot until a complete replacement exists.
- Export lets staff choose current table or whole selected report. Both carry the same context and coverage notes. Separate export permission is enforced.
- Data sources opens per-family mappings and health. Configure/reconnect controls appear only for authorised staff.

## Proposed endpoints
Reuse existing API prefix/conventions where present. Authenticated staff endpoints only; validate client/site membership server-side on every call, job lookup and download.

| Method and path | Input | Output / rule |
| --- | --- | --- |
| GET /api/analytics/context | websiteId | Allowed providers, capabilities, policies, timezone, safe health |
| GET /api/analytics/reports | websiteId, template, from, to, source, filters, sort, cursor, limit | Snapshot envelope; allowlisted query templates only |
| POST /api/analytics/refresh | websiteId, report families | 202 job refs, or existing equivalent pending job |
| GET /api/analytics/jobs/:id | None | Tenant-scoped progress and safe error |
| POST /api/analytics/connections/start | websiteId, provider | Verified server OAuth start URL; configuration permission |
| GET /api/analytics/connections/callback | provider callback | Validate state; server exchange; clean redirect |
| POST /api/analytics/connections/:id/bind | selected property/site/stream | Validated binding/version and backfill job |
| DELETE /api/analytics/connections/:id | None | Disconnect, pause jobs, audit; no implicit history deletion |
| POST /api/analytics/imports/preview | Authorised CSV + declared metadata | Safe preview, coverage/overlap/issues, no fact mutation |
| POST /api/analytics/imports/:id/commit | Preview version + replacement policy | Atomic validated import with provenance |
| POST /api/analytics/exports | Existing report query | Export job/ref; no arbitrary SQL |
| GET /api/analytics/exports/:id | None | Scoped download or generation status; expiry checked |

Use 400 invalid query, 401 authentication, 403 denied (or consistent 404 concealment), 409 version/state conflict, 429 rate limit and safe 5xx errors. Unsupported source/filter combinations return a typed capability error, never unfiltered substitute data. OAuth callback is the protocol-specific exception to normal staff request shape but remains state-bound.

## Report envelope example
```json
{
  "report": "traffic_daily",
  "websiteId": "demo-a",
  "source": "ga4",
  "connectionVersion": 1,
  "range": {"from": "2026-09-01", "to": "2026-09-28", "timezone": "Asia/Singapore"},
  "state": "ready",
  "rows": [],
  "totals": {},
  "comparison": null,
  "coverage": {"complete": true, "missingDates": [], "provisionalDates": []},
  "quality": {"thresholded": false, "truncated": false},
  "syncedAt": "2026-10-27T00:00:00Z",
  "measuredThrough": "2026-09-28",
  "metricDefinitionVersion": "cg-analytics-v1",
  "provenance": "api",
  "snapshotGeneration": 1
}
```
Synthetic contract example only. A ready empty report is valid, not fabricated live data. Totals are explicit provider/compatible aggregates, not client-side sum(rows) for all metrics. Metric cells can carry typed unavailable/suppressed states. Unavailable quality flags must be unknown, not false.

## Security details
Use CSRF protection appropriate to the current cookie/session model on mutations. Protect workers with service authentication and bounded privileges. Verify OAuth redirect allowlist, single-use state and actor binding. Cache key always includes tenant/site/environment/query version. Signed downloads are short-lived and issued only after authorisation. No client can pass an arbitrary provider property ID to query another clinic.
