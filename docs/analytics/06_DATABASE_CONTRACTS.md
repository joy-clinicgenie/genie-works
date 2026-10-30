# Database contracts

## Integration approach
Reuse existing clients, websites, memberships, submissions and audit_events. Inspect the actual database first; PostgreSQL/Supabase is a recommended compatible target, not a confirmed installed vendor. All additions use reviewed versioned migrations. Names below are explicit implementation contracts to adapt to repository conventions, not executable migrations already tested.

## Common types and constraints
UUID PKs generated server-side; timestamptz audit times in UTC; date source-local bucket dates; numeric for ratios/time and bigint for event counts; JSONB for schema/query metadata only with allowlists and size limits. Required timestamps created_at/updated_at. No metric missingness encoded as zero. Enforce start_date <= end_date. Counts non-negative. Ratios store fractions, not formatted percentage strings. Date range semantics stored as inclusive logical dates.

Every tenant-owned row has client_id and website_id and a composite FK to websites(id, client_id), requiring unique(id, client_id) on websites. Connection references use FK (connection_id, website_id, client_id) to an equivalent unique key. This prevents inconsistent parent ownership. Add corresponding database policies if browser/managed DB access exists; server-only tables deny public roles entirely. Server-scoped authorisation still applies with elevated credentials.

## Tables
| Table | Required columns | Keys / behaviour |
| --- | --- | --- |
| analytics_connections | id, client_id, website_id, provider, external_property_id, stream_or_site_ref, secret_ref, status, provider_timezone, verified_at, version, disconnected_at | Unique website/provider/external property/environment active binding under explicit rule; secret_ref only, never plaintext token |
| analytics_capabilities | id, connection_id, tenant keys, template_key, schema_hash, supported_metrics JSON, supported_dimensions JSON, dependencies JSON, oldest_available_date, checked_at, status | Unique connection/template/schema version; no made-up provider fields |
| analytics_source_policies | id, tenant keys, report_family, connection_id, effective_from, effective_to, metric_definition_version, changed_by | No overlapping effective periods per website/family; transactional enforcement/exclusion constraint |
| analytics_jobs | id, tenant keys, connection_id, template_key, query_hash, start_date, end_date, state, attempts, next_attempt_at, lease_owner, lease_until, heartbeat_at, cursor JSON, safe_error_code | Partial unique active-work index; indexes state/next_attempt_at and lease_until |
| analytics_sync_runs | id, job_id, tenant keys, connection_id, started_at, finished_at, result, pages_fetched, rows_fetched, quota_meta JSON, safe_error_code | Append-oriented execution record; attempts separate from job identity |
| analytics_report_partitions | id, tenant keys, connection_id, template_key, query_hash, start_date, end_date, source_timezone, dimensions JSON, filters JSON, metric_version, provenance, fetched_at, measured_through, completeness, quality JSON, generation | Unique connection/query_hash; current complete generation promoted transactionally |
| analytics_report_rows | id, partition_id, tenant keys, dimension_key, dimensions JSON | Unique partition/dimension_key; canonical dimension tuple hash avoids NULL uniqueness gaps |
| analytics_metric_values | report_row_id, tenant keys, metric_key, value_numeric nullable, value_state, numerator nullable, denominator nullable | Unique report row/metric; states available, unavailable, suppressed, unsupported; validate state/value consistency |
| analytics_coverage | id, tenant keys, connection_id, template_key, source_date, state, tracking_active, fetched_at, measured_through, safe_reason | Unique connection/template/source_date; records missing/partial/complete, not just returned rows |
| analytics_imports | id, tenant keys, connection_id nullable, file_checksum, report_type, source_timezone, date_start, date_end, row_count, state, created_by, provenance_ref | Checksum replay guard within website/report; file retention follows approved policy |
| analytics_page_registry | id, tenant keys, page_key, canonical_path, content_type, content_id nullable, title, valid_from, valid_to | Path/title history, no blind lowercasing or collapsing distinct case-sensitive routes |
| analytics_annotations | id, tenant keys, source_date, kind, safe_text, created_by | Text bounded/sanitised; deployment/tracking/source changes only |
| analytics_report_exports | id, tenant keys, actor_id, query_hash, snapshot_generation, state, expires_at, safe_file_ref | Scoped temporary download; audit export and expiry |

Report rows and values must prove partition tenant ownership through composite FKs or keep tenant derivation exclusively in a protected join and prohibit direct access. Do not duplicate tenant keys without enforcing consistency. Migration review chooses one coherent approach.

## Snapshot design
The same partition/row/value structure supports daily additive templates and full-range distinct snapshots without pretending the latter are daily facts. template_key and query_hash encode grain and aggregation semantics. Query templates are versioned code/config, not arbitrary client SQL. Keep provider schema metadata and report quality alongside the result. Realtime is short-lived cache only unless a documented operational reason requires history.

## Optional instrumentation extension
Do not create raw visitor tables by default. If Journeys needs first-party session events, scope a separate migration containing pseudonymous consented session ID, random event ID, event time, normalised path, safe CTA/form IDs, consent version and environment. Unique website/event ID deduplicates internal ingestion. No patient IDs or linkage to medical records. Define retention and deletion before collecting. GA4 aggregate API alone cannot populate this table.

## Performance and migration
Index report partitions on (client_id, website_id, template_key, start_date, end_date); rows on partition/dimension; jobs on state/next_attempt; coverage on connection/template/date. Materialise common totals only when semantic equivalence is proven. Do not build a cross-product mega fact table or average precomputed ratios. Cache exact-range distinct reports separately.

Add tables first, dual-read/verify behind feature flag, then switch selected views. Existing tables and routes remain. Revert reads with the flag if needed; retain new source facts for diagnosis. Test backups and forward recovery before destructive cleanup. Never drop existing analytics storage as part of initial rollout.
