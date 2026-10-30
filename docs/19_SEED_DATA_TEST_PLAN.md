# Synthetic seed data and demonstrations

## Fixtures
Use Demo Clinic A and Demo Clinic B, distinct website identifiers, two scoped test staff identities and a separately authorised administrator. Use names such as Test Person A and contact addresses under example.invalid. For actual email-delivery tests use only controlled, verified test inboxes; example.invalid will not deliver.

Configure Clinic A with enquiry mode and Clinic B with a controlled approved external-booking test destination. Create active/inactive form fixtures, valid/invalid payloads, same-key retries, failed outbox states and expired/revoked membership contexts. A real clinic name may be configured after selection, but fixture contacts must remain synthetic.

## Demonstrations
- Foundation: two client/site records, staging deploy, responsive starter and access model.
- Functional pilot: accepted enquiry → stored lead → pending notification → delivery state; then repeat during provider outage.
- Reuse: connect second dummy website via configuration and documented contracts; no duplicated backend.
- Isolation: authenticated user A attempts direct read/export/status changes against B.
- Recovery: restore test database and rehearse release recovery.

## Reset and privacy
Keep fixtures versioned and environment-guarded. Seed scripts must refuse accidental production targets. Synthetic tests use labelled records and approved recipients; define cleanup and reporting exclusion. Never copy production patient records into staging.

## Required artefacts
Redacted screenshots/logs, test report, deployment commit, contract examples, migration IDs and decision log. No fabricated success screenshots. Do not describe seed data as measured client results or tested production behaviour.
