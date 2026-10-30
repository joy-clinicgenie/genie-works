# CG-AN-01 current-state audit

Checked 27 October 2026 against the running Clinic Genie platform. Screenshot IDs S01–S08 are appearance evidence from `01_AUDIT_AND_CHANGE_MAP.md` and `12_SCREENSHOT_RECONCILIATION.md`. They do not prove a live provider.

## Design precedence

The installed UI governs. `apps/platform/src/app/layout.tsx` loads Plus Jakarta Sans into `--font-jakarta`. `apps/platform/src/app/globals.css` sets `--font-sans` to that face, then ui-sans-serif, system-ui, Segoe UI, Helvetica and Arial. Brand tokens are `#ddf7f8`, `#136c72`, `#173c40`, `#f6fbfc`, `#ffffff` and `#d7e7e9`. The pack’s Helvetica note is a fallback only. This expansion does not change the font or the global theme.

## Routes

| URL | File | Disposition |
| --- | --- | --- |
| `/analytics` | `apps/platform/src/app/(app)/analytics/page.tsx` | Keep. Overview. |
| `/analytics/traffic` | `apps/platform/src/app/(app)/analytics/traffic/page.tsx` | Keep. Traffic. |
| `/analytics/behavior` | `apps/platform/src/app/(app)/analytics/behavior/page.tsx` | Keep. US spelling in the path. |
| `/analytics/behaviour` | absent at audit time | Add a compatibility redirect to `/analytics/behavior`. |
| `/settings` | `apps/platform/src/app/(app)/settings/page.tsx` | Owns provider connections. No new Analytics sidebar item. |
| `/reports/breakdown/[kind]` | `apps/platform/src/app/(app)/reports/breakdown/[kind]/page.tsx` | Keep. Current “View Report” target. |

Shell: `AnalyticsShell.tsx`, `AnalyticsSubnav.tsx`, `SiteHeader.tsx`, `ClientPicker.tsx`, `PeriodSelect.tsx`. Default range is `last30` in `apps/platform/src/lib/period-options.ts`. Clinic, range, from and to stay in the query string.

## Screenshot to component

| Shot | What is on screen | Source in this repo | Input |
| --- | --- | --- | --- |
| S01 | Header, clinic, Last 30 days, three tabs, four large KPIs, six smaller cards | `HomeDashboard.tsx` embedded by the overview page | `report_snapshots` via `loadSiteView` |
| S02 | Previous/Current channel bars, Needs attention, sources, contact actions, enquiry count | `HomeDashboard.tsx` `TrendChart`, `SourceBars` | Period totals. The chart is not daily. |
| S03 | Funnel, form performance, contact breakdown, landing pages | `AnalyticsDetail.tsx` | Same snapshots, including `landing_sessions` |
| S04 | Enquiries by source, device list plus bounce, Google Search table | `AnalyticsDetail.tsx` | Snapshot metrics. Position change uses the generic percent helper. |
| S05 | Connection status and AI note | `AnalyticsDetail.tsx` | `account_references` labels only. Not an OAuth connection. |
| S06 | Traffic totals, daily curve, source controls, weekday bars, two donuts | `TrafficBoard.tsx`, `SourceBreakdown.tsx` | Daily curve and weekday bars call `dailySessions` in `session-shape.ts`, which spreads a period total. Donuts use stored new/returning and device rows. |
| S07 | Duration, pages per session, bounce, searchable page metrics, Top clicks | `BehaviorBoard.tsx`, `BehaviorPanels.tsx` | `page_visits` is allocated from page views in `preview-year.ts`. The visible word is “Visits”. |
| S08 | Navigation flow and form views/starts/submissions, source and location controls | `NavigationFlows.tsx`, `BehaviorBoard.tsx` `FormSplit` | `nav_flow` rows are stored path labels, not an event sequence. Locations are seed geography labels, not clinic branches. |

`GoogleAnalyticsPageViews.tsx` is not in this repository. Public-site tracking stays in the sibling website repo and is not copied here. There is no scheduler and no Playwright project.

## Hardcoded or shaped figures

- `packages/db/src/preview-year.ts` inserts labelled synthetic snapshot rows for CFAC, CEDAR and SUNRISE. The note on each row says they are not a live export.
- `apps/platform/src/lib/session-shape.ts` builds a daily series and weekday averages from a period total. S06’s curve is that series.
- Overview “Needs attention” is static copy in `HomeDashboard.tsx`, not a failed sync.
- A saved `account_references` row is not a live GA4, Wix or Search Console connection.
- The debug ingest previously observed in `site-view.ts` is absent from the current file.

## Provider gaps before this expansion

- No OAuth client, token store, property binding or worker.
- GA4 `totalUsers` cannot be rebuilt by adding daily user counts. The current visitor number is one stored period row.
- Wix Analytics Data API history is 62 days on that endpoint only. Semantic Model fields are not known until a site responds.
- Search Console dates are Pacific, with about 16 months of retention and a top-row cap. Nothing in the current search card records that.
- Confirmed bookings have no provider evidence.
- Enquiry totals are snapshot metrics, separate from the enquiry database read used by the Enquiries module.

## Baseline

Playwright is not installed. Browser checks use the in-IDE browser. Lint, typecheck and Vitest results are recorded in `docs/analytics/HANDOVER.md` after the commands run.
