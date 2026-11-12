# Signed-in performance baselines

Generated: 2026-11-03T04:44:42.872Z
Suite: isolated `perf` · Origin: http://127.0.0.1:3418 · production build (next start) from .next-perf
Warm runs per page: 5

Every figure comes from this isolated environment with synthetic fixtures. None of it describes a client result or production behaviour.

**Provider:** Wix reads served by the local mock. Real-provider measurements: NOT MEASURED, by design.

**Database counts:** NOT MEASURED per navigation. pg_stat_statements needs shared_preload_libraries, which the embedded server does not set, and pg_stat_database.xact_commit is flushed on a timer with a lag longer than any usable settle delay (measured: 50 statements gave a delta of 1, then the next window of 6 gave 52). Exact per-path query and round-trip counts come from npm run perf:query-counts.

## Pages

| Page | View | Cold data visible | Warm data visible p50 | Warm p95 | TTFB p50 | FCP p50 | Provider calls | Provider ms | CLS | Requests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | desktop | 445 ms | 65 ms | 86 ms | 37 ms | 60 ms | 1 | 0 | 0 | 12 |
| Enquiries | desktop | 74 ms | 63 ms | 69 ms | 28 ms | NOT MEASURED | 3 | 0 | 0 | 12 |
| Enquiries filtered by status | desktop | 56 ms | 59 ms | 63 ms | 26 ms | NOT MEASURED | 3 | 0 | 0 | 12 |
| Enquiries page 2 | desktop | 64 ms | 49 ms | 57 ms | 21 ms | 48 ms | 3 | 0 | 0 | 12 |
| Enquiries scoped to Clinic A | desktop | 89 ms | 53 ms | 56 ms | 22 ms | 52 ms | 3 | 0 | 0 | 12 |
| Analytics Overview | desktop | 78 ms | 67 ms | 75 ms | 37 ms | 68 ms | 0 | 0 | 0 | 12 |
| Analytics Traffic | desktop | 56 ms | 62 ms | 71 ms | 34 ms | 64 ms | 0 | 0 | 0 | 12 |
| Analytics Behaviour | desktop | 95 ms | 59 ms | 66 ms | 31 ms | 52 ms | 0 | 0 | 0 | 12 |
| SEO Overview | desktop | 60 ms | 47 ms | 61 ms | 19 ms | 52 ms | 0 | 0 | 0 | 12 |
| Reports library | desktop | 63 ms | 44 ms | 62 ms | 19 ms | 36 ms | 0 | 0 | 0 | 11 |
| Report generation form | desktop | 69 ms | 47 ms | 101 ms | 20 ms | 52 ms | 0 | 0 | 0 | 13 |
| Blog list | desktop | 122 ms | 333 ms | 838 ms | 12 ms | 28 ms | 0 | 0 | 0 | 48 |
| Blog editor, article with media | desktop | 112 ms | 826 ms | 839 ms | 17 ms | 40 ms | 0 | 0 | 0 | 38 |
| Blog editor, article without media | desktop | 119 ms | 58 ms | 831 ms | 7 ms | 32 ms | 0 | 0 | 0 | 17 |
| Blog preview with media | desktop | 61 ms | 36 ms | 46 ms | 14 ms | 28 ms | 0 | 0 | 0 | 13 |
| Blog media route | desktop | 20 ms | 15 ms | 16 ms | 4 ms | NOT MEASURED | 0 | 0 | 0 | 1 |
| Saved report | desktop | 68 ms | 47 ms | 52 ms | 21 ms | 44 ms | 0 | 0 | 0 | 13 |
| Clients | desktop | 109 ms | 58 ms | 832 ms | 17 ms | 36 ms | 0 | 0 | 0 | 12 |
| Analytics for a client with no data | desktop | 73 ms | 47 ms | 50 ms | 18 ms | 44 ms | 0 | 0 | 0 | 12 |
| Dashboard as a clinic-scoped specialist | desktop | 78 ms | 75 ms | 98 ms | 48 ms | 72 ms | 0 | 0 | 0 | 12 |

## Wix provider scenarios, measured on /enquiries

| Scenario | Server ms | Rendered ms | Provider calls | Provider ms | Page state | Rows | Failure notice |
| --- | --- | --- | --- | --- | --- | --- | --- |
| normal | 13 | 24 | 3 | 0 | list rendered | 25 matching enquiries | no |
| slow | 1527 | 1592 | 3 | 4506 | list rendered | 25 matching enquiries | no |
| provider-error | 9 | 20 | 3 | 0 | no enquiries available |  | yes |
| multi-page | 62 | 184 | 7 | 0 | list rendered | 75 matching enquiries | no |
| expired-auth | 10 | 21 | 3 | 0 | no enquiries available |  | yes |
| zero-submissions | 56 | 101 | 3 | 0 | list rendered | 0 matching enquiries | no |
| timeout | 15030 | 15129 | 3 | 0 | no enquiries available |  | yes |

Server ms is the browser's `responseStart`: the time the server took. A scenario that renders "no enquiries available" is not slow — the provider failed and the page said so.

## Controlled concurrency on /analytics, isolated server only

| Sessions | Wall | Per-session p50 | Per-session p95 | Peak cg_app connections | Peak active | Peak idle in transaction |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 234 ms | 234 ms | 234 ms | 3 | 0 | 0 |
| 5 | 696 ms | 696 ms | 696 ms | 8 | 5 | 3 |
| 10 | 8866 ms | 8862 ms | 8865 ms | 8 | 3 | 8 |

Pool limits were not changed for these runs.
