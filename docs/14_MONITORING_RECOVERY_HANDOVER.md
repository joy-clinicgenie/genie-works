# Monitoring, recovery and handover

## Monitor
Public uptime, backend errors, form health, notification failures, background dispatcher progress and backup success. Define thresholds, alert destination, owner and backup during discovery. Deduplicate repeated alerts. Do not assume Vercel deployment success establishes runtime health.

Synthetic form tests use labelled fixtures and controlled recipients. They must not contaminate live enquiry totals or create unnecessary patient information. Exercise the full storage/routing/outbox path in the designated test context.

## Recovery
Document database/media/code coverage, backup schedule, retention, recovery objectives and owner. Restore a recent backup into non-production and verify records, relationships and access policies. Coordinate application rollback with schema compatibility; use tested forward recovery if rollback is unsafe.

## Incident runbooks
- Form/storage failure: stop false success responses, expose clinic fallback, alert owner, preserve evidence and verify recovery.
- Email outage: retain leads, inspect pending/failed outbox, restore provider and reconcile retries.
- Booking outage: use approved fallback; never invent availability.
- Data exposure: contain access, revoke affected credentials, preserve evidence and follow approved response arrangements.

## Required handover
README and architecture; environment variable names without values; migrations and access policy; API contracts; deployment/rollback runbook; incident guide; tests/security/restore evidence; second-site onboarding checklist; vendor/cost register; named maintenance owner.

Planning infrastructure envelope from source: S$150-350/month, not a quote, excluding booking licences, labour, review, existing subscriptions and unusual traffic. Verify prices before purchase. Record billing owner, cancellation/export path and budget alerts.
