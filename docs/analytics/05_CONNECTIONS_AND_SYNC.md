# Automatic connections and scheduled synchronisation

## Connection flow
1. Authorised integration administrator selects client, website and provider in existing Settings. Server rechecks membership and configure permission.
2. Create short-lived single-use OAuth state bound to authenticated actor, website, provider, redirect URI and expiry; use PKCE where supported. Reject callback mismatch/replay. Never trust tenant IDs from callback query parameters.
3. Use provider-approved server-side OAuth, minimum read scopes, encrypted token storage or managed secrets. For Google use analytics.readonly and/or webmasters.readonly. Any Admin API discovery access must be assessed separately. Wix permissions follow current installation requirements; do not invent an OAuth endpoint.
4. List accessible properties/sites and show labels plus domains. User explicitly selects property and correct stream/hostname or Wix site. Match to existing registry; domains alone are not permission proof.
5. Validate access and retrieve metadata plus a bounded test query. Persist binding, capabilities, timezone and tracking availability. Never auto-select the first available account.
6. Mark connected, queue backfill and show actual progress. Connected does not mean all history has loaded.
7. Reconnect replaces credentials without deleting retained history; disconnect stops jobs and revokes tokens where supported. Retention/deletion follows approved policy.

Read-only APIs cannot discover or authorise inaccessible clinics without an account holder granting access. Initial consent/setup is interactive; subsequent refresh/sync is automatic.

## Proposed schedules, configurable by plan and quotas
| Job | Target cadence | Lookback / completion |
| --- | --- | --- |
| GA4 standard reports | Every 6 hours | Today plus preceding 7 source dates; provisional |
| Wix reports | Daily, 06:00 website timezone | Infinite retention of stored source dates. Each run requests the full endpoint history (62 days). Intraday only if verified useful |
| GSC | Daily, 10:00 Asia/Singapore | Re-fetch preceding 10 Pacific dates; record provider state |
| Reconciliation | Weekly | Last 30 source dates where endpoint allows; preserve failed partitions |
| Historical backfill | On connection | Chunk from verified availability boundary, resume checkpoint, progress per template |
| Realtime, optional | On demand, cached 60 seconds | Separate ephemeral result; no historical KPI overwrite |
| Exact-range snapshot | On report request and month close | Full-range distinct counts; common weekly/monthly reports retained |

These are Clinic Genie operating targets, not vendor freshness guarantees. GA4 intraday data and recent GSC data can change. Mark data provisional until the configured reconciliation policy has passed; do not claim immutable finality unless provider guarantees it. Freshness warning defaults: GA4 sync >12h old, Wix/GSC >36h old. No-data-through date and failed execution are separate warnings.

## Durable execution
Reuse existing supported scheduler and persistent job infrastructure where compatible; do not put analytics into the enquiry notification outbox. Scheduler enqueues due jobs and exits. Authenticated worker leases one job with a bounded deadline; verifies tenant/property binding; refreshes token under a connection lock; fetches all pages into staging; validates; atomically promotes a complete partition; writes checkpoint, coverage and success time. Heartbeat long work. Persist state before yielding serverless execution.

Use job uniqueness on connection + template/query hash + period + active state, enforced by DB partial unique index. Independent tenants share quotas fairly; cap per-property concurrency. Partition daily additive reports separately from range snapshots. Failed pagination or exhausted quota must never partially replace a previously complete report. A valid provider response containing zero rows may clear a partition only after successful coverage/empty validation.

## Retry and repair
Transient network/429/5xx: respect Retry-After, jittered backoff, maximum 5 attempts by default, then failed with safe reason and manual retry. Permission/auth failures: one locked token refresh where valid; invalid_grant/revoked credentials becomes reconnect_required and pauses connection jobs. Unsupported field/schema change disables affected template and triggers rediscovery. Never retry an invalid query indefinitely.

Manual Refresh returns an existing pending job when equivalent work is queued; otherwise enqueues bounded recent sync and responds immediately. It does not fire all historical queries. Display last successful data while retrying, with stale badge.

## History and imports
Never promise a 90-day Wix Data API backfill when only its documented window is accessible. Collect available source history, preserve subsequent daily reports and offer explicit CSV import for gaps. Validate report type, timezone, column mapping, dates, source site and numeric units. Detect truncated exports by declared export limits/row counts, not assumptions from a file title. Quarantine duplicates and overlaps; preview replacement/retain decision per partition. Imports get checksum, source filename and provenance, and never silently override API data. Importing daily visitor counts does not recover monthly unique visitors.

## Operations
Expose connection status, last attempt/success, next scheduled run, measured-through date, coverage, pending jobs and safe errors. Log correlation IDs and counts, not tokens/patient data. Alerts go to existing authorised operational status mechanisms; this pack does not authorise sending external messages or buying monitoring services. Analytics worker failure cannot block public pages, accepted form submissions or notification dispatch.
