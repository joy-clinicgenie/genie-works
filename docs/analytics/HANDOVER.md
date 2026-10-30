# Analytics expansion handover

Date: 27 Oct 2026. Migration `0020_analytics_connections.sql` is applied. Decision D13 is recorded. The spec pack is in `docs/analytics/`. Playwright is not installed, so the browser pass used the in-IDE browser.

## Flag

`ANALYTICS_LIVE_REPORTS` defaults off. With it off, Overview, Traffic and Behaviour keep reading `report_snapshots`. Set it to `true` and restart the server to read promoted partitions. If no complete partition matches the period, the page says Unavailable or Not connected. Turn the flag off and restart to return to the snapshot screens. `report_snapshots` are not dropped.

## Checks

`npm run typecheck` exited 0 for contracts, db and platform.

`npm run lint` exited 0 with 10 existing warnings (anonymous eslint export, `<a>` on new-item pages, `<img>` on sign-in and the shell). No lint errors.

`npm test -w @clinic-genie/db -- test/analytics-measure.test.ts test/analytics-providers.test.ts test/analytics-sync.test.ts`

```
Test Files  3 passed (3)
Tests  16 passed (16)
```

Those tests cover tenant isolation, secret hiding, forged and replayed OAuth state, pagination failure leaving the previous partition, a single lease, 429 retry, `invalid_grant` reconnect, exact-range users versus daily sessions, overlapping source policy, reconnect after disconnect, URL and CSV guards, and labelled provider fixtures. They do not call Google or Wix.

`POST /api/internal/analytics/worker` without a matching `ANALYTICS_WORKER_SECRET` returned 401 `{"error":"Unauthorized"}`.

## Browser

Signed in as the seeded admin on the dev server at port 3400, flag off.

- Overview for CG-001 showed the existing snapshot figures (1,263 sessions, 972 visitors, 41 contact clicks, 13 form submissions) and the Behaviour label.
- CG-004 showed Not recorded and “No export has been recorded”, not a shaped zero chart.
- Traffic kept source and category controls and the weekday list.
- Behaviour kept search, the Visits metric tabs, Top clicks and navigation flows. Searching “contact” left `/contact`. Choosing the home step updated the flow status.
- `/analytics/behaviour?...` redirected to `/analytics/behavior` and kept the clinic and range.
- Settings, at desktop width and at 390×844, showed Analytics providers as Not configured, Clementi as Not connected, and Cedar’s own website after the clinic control. No connect buttons appeared, because the provider credentials are empty.

The flagged Overview, Traffic and Behaviour renderer was not shown in the browser. The running server has the flag off, and a second dev server could not start beside it.

## Blocked live providers

No Google OAuth client, Wix app id, Wix app secret, token key, worker secret, granted property, or Wix semantic-model response is configured. Discovery and sync therefore cannot return live rows. Nothing was invented to fill the charts. Wix field names are stored only from a real `GetSemanticModel` response. Confirmed bookings stay unavailable. Journeys stay on the stored navigation flows.

## Recovery

Leave `ANALYTICS_LIVE_REPORTS` unset or `false`, then restart the app. Disconnecting a provider cancels queued jobs and keeps stored partitions. The new tables are included in the backup inventory after `report_snapshots`.
