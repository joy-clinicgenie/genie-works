# Prepared changes (not applied)

Files here are reviewed and tested but **never run by `npm run db:migrate`**. They are promoted to `migrations/` only on a decision.

## analytics_property_one_client.sql: one provider property, one client

**Why it is not a migration yet.** A uniqueness rule must not be added to production before the real associations have been read. If two clients already share a property, the migration would fail, or, worse, someone would "fix" it by editing the wrong row. The application-level guard in `saveConnection` already stops new cross-client binds. This is the database backstop for afterwards.

**Order of work**

1. Take a restore point of production. Do not run anything against the live database.
2. Run `npm run analytics:audit -w @clinic-genie/db` against the restore point (`ANALYTICS_AUDIT_REMOTE_CONFIRM=<host>`). It reads in a read-only transaction and prints short hashes, never a property id or a client name.
3. Look at every `property_bound_to_other_client` finding. For each, decide with the account owner **which client the property belongs to**. The finding does not say; the audit deliberately names no client.
4. Resolve each one. Options, in order of preference:
   - **Disconnect the wrong binding** from the Analytics settings (the connection keeps its history; `disconnected_at` is set; reports already published are untouched).
   - **Acknowledge a deliberate share**: only if two clients truly share the property, set `cross_client_ack_reason` (10 to 300 characters) on the extra connection after the guard exists. Until then, the application's `allowCrossClient` override records the reason in the audit log.
   - Never delete a connection, a job, a partition or a published report to clear a finding.
5. Re-run the audit until `property_bound_to_other_client` is 0.
6. Promote the file to the next numbered migration and apply it with the production procedure in `docs/DEPLOYMENT.md` (restore point, `MIGRATE_PRODUCTION_CONFIRM`, `MIGRATE_BACKUP_REFERENCE`).

**If the migration refuses** with `analytics property guard not applied: N property/properties ...`, nothing was applied (it is one transaction). Go back to step 2.

**Rollback.** `analytics_property_one_client.down.sql`. It drops the trigger, the function and the column and touches no data.

**What it does not do.** It does not look at `external_property_id` values the audit cannot see, such as a Search Console property written in two different forms for the same site (`sc-domain:example.com` and `https://example.com/`). The audit reports a host mismatch as `gsc_site_does_not_match_website` for review.
