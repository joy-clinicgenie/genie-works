# Query and round-trip counts per server path

Generated: 2026-11-03T04:40:48.247Z · Suite: isolated `perf` · Database: `clinic_genie_perf_baseline`

Real service functions inside withContext, with the pg client's query method wrapped. Round trips = driver queries + 2 for begin/set_config and commit.

Local embedded PostgreSQL. Times are not production latency; the query and round-trip counts are the comparable figures.

| Server path | Driver queries | Round trips | p50 (local) | Observed |
| --- | --- | --- | --- | --- |
| app layout: shell clients + website ids | 2 | 4 | 1 ms |  |
| getAccess: staff by email + memberships | 2 | 4 | 1 ms |  |
| loadSiteView: client and site selection | 4 | 6 | 2 ms | clients=4 snapshotRows=60 |
| loadLiveBundle GA4: published report chain | 17 | 19 | 6 ms | sessions=available |
| loadSeoOverview: context + website bundle | 11 | 13 | 4 ms | sites=3 seoPages=40 tasksLoaded=80 |
| composeReport: single period | 28 | 30 | 5 ms | blocks=2 |
| composeReport: with a comparison period | 44 | 46 | 8 ms | blocks=2 |
| listTasks: client task list | 1 | 3 | 1 ms | rows=54 |
