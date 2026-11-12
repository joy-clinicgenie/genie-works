# Live analytics verification

This procedure is not done. DEP-01 stays open until an authorised non-production property and access are available. Do not substitute a production property. Fixture tests and a manual worker call do not close this gate.

## Required access

Record these before any live call. Do not record secrets, tokens, or a production property id.

| Input | What to record |
| --- | --- |
| Property alias | A name the owner chooses for one non-production GA4 property or one non-production Wix site, plus a separate non-production Search Console property. The alias is not the secret and not a production id. |
| Access | The owner confirms the configured OAuth client may read that property. GA4 uses the analytics read scope. Search Console uses the webmasters read scope. Wix uses the site analytics read scope already named in Settings. |
| Database | The worker database is the approved non-production application database. It is not the clinic website database on port 54329. |
| Worker secret | `ANALYTICS_WORKER_SECRET` or `CRON_SECRET` is set on that environment. The value is not copied into notes. |

## Date window

Use one completed source window that both Genie Works and the provider can show.

| Provider | Window | Time zone |
| --- | --- | --- |
| GA4 | A finished range inside the due window: the provider's current source date and the seven dates before it. Prefer a completed day when the provider still marks today as provisional. | The connection's `provider_timezone` |
| Wix | A finished day inside the provider's current history window. | The website timezone stored on the connection |
| Search Console | The preceding ten Pacific dates, ending three days before the Los Angeles civil date. | `America/Los_Angeles`, even when the clinic timezone differs |

Write the start date, end date and timezone next to the property alias.

## Comparison

Compare the same property, the same dates and the same timezone. Record both numbers. A match is equal figures for that one metric.

| Provider | Metric to compare | Keep separate |
| --- | --- | --- |
| GA4 | Sessions for the window | Do not add Wix sessions. Distinct users stay on the exact-range report. |
| Wix | Total sessions for the window | Do not add GA4 sessions. |
| Search Console | Clicks and impressions for the window | Clicks are not sessions, form starts, enquiries or bookings. |

Form starts, submitted enquiries and confirmed bookings each stay on their own line. A missing day stays unavailable. It is not filled with zero and it is not omitted from the comparison as if it had been measured.

## Expected evidence

A live pass needs all of the following, with no secrets:

- One `analytics_sync_runs` row with `result = succeeded` and a `finished_at` timestamp.
- The property alias, the date window and the timezone.
- The Genie Works figure and the provider figure for the metric above.
- The connections screen shows that `finished_at` as the last successful sync. A connection `verified_at` value is not that evidence.
- Queue rows for that window are succeeded, or a failed row shows a safe error and the previous complete report is unchanged.

## What does not count

- A fixture or unit test, including a test that returns a canned provider body.
- A manual `POST` or `GET` to the worker on a local machine.
- The `analytics-worker` schedule in the repository-root `vercel.json` (D55, which replaced the D51 `crons` entry). That entry prepares a daily GET at 02:00 UTC. It applies only when the project Root Directory is the repository root; until 12 Nov it was `apps/platform`, so it was never applied. The hosted scheduler has not been observed to run.

The hosted check, after the non-production property exists, is a later deployment: confirm in the project's Schedules tab that `analytics-worker` ran `GET /api/internal/analytics/worker` with the bearer the project sends, then record one succeeded run whose timestamp matches that invocation. Until that observation exists, scheduled execution stays unverified.
