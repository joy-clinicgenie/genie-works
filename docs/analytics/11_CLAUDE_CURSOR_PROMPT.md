# Claude Code / Cursor implementation prompt

Copy the following into the existing Clinic Genie repository session. Keep this pack under docs/analytics/ without replacing the original specification pack.

```text
Continue the EXISTING Clinic Genie Analytics implementation. Do not scaffold a new platform.

Read AGENTS.md and existing project instructions first. Then read the original implementation specifications and docs/analytics/00_README.md through 10_SOURCES_DECISIONS.md, plus 12_SCREENSHOT_RECONCILIATION.md.

This task authorises the Analytics expansion previously deferred to Phase 3. Preserve the current site registry, staff permissions, forms, durable leads, notifications, booking modes, public websites, installed design system and working functions. No new CRM, campaign manager or custom booking calendar.

Start with CG-AN-01 only:
1. Inspect actual routes, components, data hooks, tracking listeners, provider adapters, database schema, auth and background jobs. Identify real values versus hardcoded/mock data. Find GoogleAnalyticsPageViews.tsx if it exists and inspect its SPA behaviour.
2. Inventory current Overview/Traffic/Behaviour functionality and record exact files. Use the completed S01-S08 screenshot review in 01_AUDIT_AND_CHANGE_MAP.md and its detailed correction contracts in 12_SCREENSHOT_RECONCILIATION.md. Inspect original images if present. Map the visible components to real files and inputs. The screenshots prove appearance and displayed figures only, not live integration or working interactions.
3. Establish design-token/font precedence from the running repository. Keep the installed font, spacing, navigation, charts and component conventions. No global restyle.
4. Produce a concise current-state audit, per-component retain/change/destination map, provider capability gap list and dependency list. Preserve existing route URLs or document compatibility redirects.
5. Run existing relevant baseline checks and capture current screens. Do not invent passing results.

Then implement tickets one at a time in dependency order, continuing autonomously within the authorised scope. Resolve routine choices using existing patterns. Record material unresolved decisions and do independent work while waiting for missing evidence/access. Do not implement unsupported provider features as fake data.

Architecture:
- Overview: preserve four primary KPI types (sessions, measured visitors/users, contact clicks, tracked successful form submissions), verified trend or honest period comparison, top sources/pages, separate stored enquiry summary and conditional GSC summary. Remove the duplicate six-card strip after preserving its detail metrics. Keep existing 30-day convention and saved selections.
- Traffic: Acquisition, Campaigns, Landing pages, Audience and Organic search.
- Behaviour: Pages, Interactions, Forms and enquiries, Content and existing Journeys capability. Preserve page metric selectors, search, Top clicks, source/location controls and navigation-flow selection. Gate unsupported metrics, not working existing capabilities.
- Existing authorised Settings owns provider connections; do not add more Analytics sidebar pages.

Measurement:
- Wix for verified legacy reports; GA4 for native traffic; GSC for search; backend for durable enquiries.
- Never add Wix and GA4 traffic or duplicate interaction counts.
- Never sum daily distinct users for a selected period. Query/cache exact-range provider totals; show unavailable when no correct result can be recovered.
- Contact clicks are events, stored enquiries are records, booking clicks are intent. Confirmed bookings require provider evidence.
- No eventCount/sessions metric labelled conversion rate. No ordered funnel from unrelated aggregate counts.
- Source timezone, tracking start, sync time, measured-through, partial coverage and unavailable states are required.
- Wix 62-day retention applies to documented Data API endpoint only. Discover Semantic Model availability/history per site.

Integration:
- Server-side least-privilege OAuth, explicit tenant/property binding, encrypted token refs and audited connection changes.
- Discover Wix model fields/dependencies and GA4 metric compatibility. Check official documentation, never invent endpoints or names.
- Durable scheduler/worker with leases, retries, pagination, quota control, checkpoints and atomic partition promotion.
- Analytics jobs never block public forms, notifications or pages.
- Extend existing database with versioned additive migrations; preserve previous facts and routes.

Security/reporting:
Enforce tenant scope on every API, job, report, cache and download. Never send patient/contact details, raw clinical text or sensitive URLs/UTMs to analytics. Reuse consent handling. CSV imports/exports need provenance, overlap handling, formula safety and explicit permissions.

Validation:
Run repository lint/typecheck and relevant tests, plus meaningful provider/tenant/measurement/worker regression tests from 09. Use Playwright if available for existing desktop/mobile views and browser interactions. If it is unavailable, report that precisely; do not claim visual verification. Prove two-clinic reuse with separate configuration and no duplicated backend. Use actual provider responses for live integration evidence; synthetic fixtures are clearly labelled.

After each ticket report: changed files, contracts/migrations, exact check results, safe demonstration evidence, known limitations, recovery path and next ticket. Preserve existing working paths behind a feature flag until replacement reports reconcile. Do not deploy production or claim live connections from mock data. End only when the requested implementation is complete or a concrete external blocker prevents remaining work.
```
