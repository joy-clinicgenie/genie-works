# Acceptance tests and release gates

## Evidence format
For each test capture ID, commit, environment, fixture/identity, steps, expected/actual result, redacted evidence, outcome, owner and retest reference. Use actual running services for release evidence; mocks alone do not prove production integration.

| Gate | Required evidence | Pass condition |
| --- | --- | --- |
| G1 Foundation | Repo, staging URL, migrations, access matrix | Reproducible deploy and correct client/site relationships |
| G2 Lead safety | Validation, routing, dedupe, outage and access tests | Durable leads, correct clinic routing, verified isolation |
| G3 Booking/measurement | Booking fallback, mobile, analytics debug, consent | No false confirmation, no PII leakage, defined events |
| G4 Security/recovery | Independent review, secret checks, restore/recovery | No unresolved critical/high findings; recovery demonstrated |
| G5 Controlled pilot | Browser/mobile/SEO QA, clinic sign-off, monitoring | Authorised launch and completed post-launch checks |

## Minimum scenarios
T01 accepted request creates one submission and outbox event atomically.
T02 invalid/oversized/unknown fields rejected without sensitive error output.
T03 inactive or wrong site/form pairing rejected.
T04 repeated and concurrent retries create one lead; different payload with same key conflicts.
T05 database failure produces no success acknowledgement or success event.
T06 email outage preserves lead, schedules retry and surfaces failure.
T07 recovery delivers to the correct clinic; worker replay does not recreate lead.
T08 Client A identity cannot list/read/export/update Client B records by ID or filters.
T09 anonymous/expired/revoked identity cannot access staff APIs.
T10 recipient/role changes and exports create protected audit records.
T11 external booking link wrong/down/blocked has approved fallback; enquiry never implies confirmation.
T12 analytics parameters exclude personal data and retries do not double-count goals.
T13 synthetic outage reaches the assigned operator without uncontrolled alert duplication.
T14 restore into isolated environment verifies records, relationships and permissions.
T15 breaking schema release has rehearsed rollback or forward recovery.
T16 second dummy site connects using configuration without backend copy.
T17 actual sitemap, canonical, robots, schema, redirects and 404 output checked.
T18 clinic signs off approved copy and form handling before real enquiries.

Stop-ship: cross-client exposure, lost/non-durable lead, exposed secret, unsafe medical data, untested restore or misleading booking confirmation. Date targets never override these conditions.
