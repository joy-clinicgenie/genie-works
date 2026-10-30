# Phase 1 administration screens

## Scope
Build a small protected administration area, not the full agency dashboard. Apply Clinic Genie branding from 15_DESIGN_SYSTEM.md.

## Screens
1. Sign in: managed authentication, accessible error/reset flow.
2. Client/site registry: authorised sites, environment, owner and configuration summary.
3. Enquiries: client-scoped list, date/site/status filters and notification state.
4. Enquiry detail: limited contact fields, request timestamp, permitted attribution and notification history.
5. Operational status: failed notifications and safe error references; no patient data in broad status cards.

## Actions
Lead status updates and basic export only for authorised staff. Record relevant access and export actions. Notification retry is a privileged operation on the existing outbox record; it does not resubmit the form. Confirm status vocabulary in discovery; proposed statuses are new, acknowledged and closed. Closed must not imply an appointment occurred.

Exports contain only authorised fields and need CSV formula-injection protection if CSV is used. Do not expose records through guessed IDs, global search or unscoped counters. Audit trails must not copy entire lead payloads.

## UI states and acceptance
Provide loading, empty, validation, permission-denied, provider-failure and stale-status states. Two test users see only their permitted sites. Public visitors cannot load or call admin endpoints. Show stored lead and notification status separately so an email failure is visible without suggesting lead loss.
