# Check registry and module parity

Each row is independently scored using 01. Expand a check into evidence cases without changing its weight mid-audit. If new mandatory checks are discovered, list and explain them separately; update the rubric version before recalculating.

For every row record: status, grade, actual evidence, SHA/environment, limitation and linked finding. All nine module rows are required. Deferred subfeatures remain excluded rather than causing false failures.

| Check ID | Feature | Acceptance target |
| --- | --- | --- |
| FN-01 | Agency Overview | Current counts/filters, missing-data states and links reflect actual accessible sources. |
| FN-02 | Client Management | Create/edit/archive, services/file links, website mapping and assigned-client access work. |
| FN-03 | Website Analytics | Overview/Traffic/Behaviour provide supported metrics, dates and honest missing-data states. |
| FN-04 | SEO | Approved settings/tasks/redirect workflows persist; unavailable features are clearly deferred. |
| FN-05 | Blog | Draft/review/approval/publish/archive, protected preview and versions follow approved roles. |
| FN-06 | Leads and Forms | Wix and native source rows share a usable filtered interface with source-specific capability labels. |
| FN-07 | Reports | Draft/Saved, no draft artifact, frozen saved JSON, corrections as new versions and retrieval match D23. |
| FN-08 | Settings | Profile and connections match approved capabilities and permissions. |
| FN-09 | Admin | Users, deactivation, audit, backup and safe operational visibility work. |
| SC-01 | Authentication | Protected routes deny unsigned requests; shared environments reject development shortcuts. |
| SC-02 | Roles and client isolation | Approved roles cannot bypass server/database policies or access other clients. |
| SC-03 | Secrets | Connection writes/token rotation are admin-only; no secrets in staff responses/logs/Git. |
| SC-04 | Exports and artifacts | Authorisation, allowed columns, CSV safety and path validation apply to direct requests. |
| SC-05 | External request security | Worker/site API/inbound connector auth, replay handling and tenant mapping fit the actual transport. |
| SC-06 | Data handling | No second personal-message copy or sensitive audit logs; real-directory retention decision and access safeguards are accurately documented. |
| DA-01 | Metric definitions | Sessions/users/contact clicks/starts/submissions/bookings remain distinct; GA4 and Wix not summed. |
| DA-02 | Provider reconciliation | At least authorised GA4 or Wix plus GSC windows match actual provider figures; other claimed connectors assessed too. |
| DA-03 | Freshness and coverage | Successful complete period, timezone, last-success timestamp and stale/partial-data labels are accurate. |
| DA-04 | Queue and retries | Fixture worker claims/retries/idempotency work; current read-only backlog is reported where authorised. |
| DA-05 | Comparison and attribution | Comparable ranges, zero/unknown denominators, source availability and website isolation are correct. |
| EQ-01 | Wix source | Correct forms/version/permissions, stable IDs and site/form mapping; permitted details read at source. |
| EQ-02 | Native source | Authorised database/API with known schema and website mapping; fixtures versus connected source distinguished. |
| EQ-03 | Follow-up | New/Acknowledged/Closed/reopen and concurrent update handling work per source without false Wix write-back claims. |
| EQ-04 | Totals and duplicate prevention | Eligible source IDs counted once across paging/retries; no double counting across connectors. |
| EQ-05 | Notifications | Source capabilities and acceptance/receipt distinction displayed honestly; external sender ownership preserved. |
| EQ-06 | Retry and export | Supported retry requests preserve the enquiry; unsupported Wix capabilities disabled; export gates/fields work. |
| IN-01 | Website consumed blog/SEO | Authorised non-production website actually renders an article and applies saved SEO values from protected APIs. |
| IN-02 | Wix connection | Forms and analytics permissions verified separately; account/property mapping and failures safely handled. |
| IN-03 | Hosted scheduler | Actual authenticated scheduled call observed; method compatibility and task result established. |
| IN-04 | Source email boundary | Existing acceptance and receipt evidence trace to source dispatcher; configured intended sender/source verified without requiring Genie Works to send. |
| UX-01 | Responsive journeys | 390/768/1440 relevant routes have usable controls without overlap/overflow. |
| UX-02 | Keyboard and semantics | Menu focus/return, skip link, labels, headings, errors and focus visibility checked. |
| UX-03 | Accessibility evidence | Automated scan and focused contrast/manual checks where available; screen-reader/full conformance limitations explicit. |
| UX-04 | Empty/error states | Disconnected, stale, partial, denied and unsupported states are meaningful and avoid false success. |
| PS-01 | Production build and start | Exact candidate builds and launches using valid isolated environment configuration. |
| PS-02 | Runtime stability | Key journeys do not produce uncaught errors; no debug network work remains on request paths. |
| PS-03 | Production measurements | Current production-mode route performance measured reproducibly; no historical Lighthouse reuse. |
| QA-01 | Static checks | Typecheck/lint pass; warnings and exclusions explicit. |
| QA-02 | Domain and decision tests | Applicable database/platform/decision tests execute; assertions do not weaken scope or security. |
| QA-03 | Browser tests | Browsers launch; named role journeys and negative cases actually run. |
| QA-04 | Dependency/CI evidence | Production dependency audit and actual PR-check configuration inspected; dependency audit is not a secret scan. |
| OP-01 | Reproducible revision | Candidate, clean checkout, dependency lockfile, runtime and evidence commit are traceable. |
| OP-02 | Environment/hosted separation | Authorised staging project, runtime secrets and source targets separated; no fixture guard bypass. |
| OP-03 | Recovery | Current schema and saved artifacts covered by documented backup/recovery, isolated restore verified. |
| OP-04 | Monitoring and rollback | Hosted operation verified where claimed; named owner accepts app/schema/data rollback limits. |
| DC-01 | Current requirements | Latest decisions and two-source architecture reflected; old audit preserved, contradictions resolved. |
| DC-02 | Runbooks and owners | Setup, source onboarding, retries, recovery and actual owner approvals sufficient for handover. |
| DC-03 | Audit evidence | All commands and check results tied to SHA/environment, dependencies and limitations transparently recorded. |
