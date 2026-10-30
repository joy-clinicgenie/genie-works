# Forms and durable lead capture

## Proposed versioned contract
POST /api/v1/forms/submit. Final path and field schema require confirmation in CG-07.

Request example, using synthetic values only:
```json
{
  "websiteKey": "demo-site-a",
  "formKey": "appointment-enquiry",
  "formVersion": 1,
  "idempotencyKey": "fresh-random-key-per-attempted-submission",
  "fields": {"name": "Test Person", "email": "person@example.invalid"},
  "privacyNoticeVersion": "demo-v1",
  "marketingConsent": false,
  "pagePath": "/appointment"
}
```
Required contact fields and acknowledgement/consent wording are clinic-approved configuration, not universal defaults. Reject unknown fields, arbitrary recipients, excessive lengths and disallowed free text. Collect no NRIC/history/documents in baseline.

## Server flow
Resolve active form/site from trusted configuration → validate payload and notice/consent requirements → apply rate limits and anti-spam → atomically save submission and outbox → return success only after commit. Treat page/referrer/UTM values as untrusted; allowlist and sanitise attribution. Never rely on CORS/origin alone for abuse prevention.

## Responses
Proposed: 201 accepted with opaque receipt and 'Your request has been received. The clinic will contact you.' A safe duplicate replay returns a consistent receipt. Use documented 400 validation, 409 key conflict, 429 throttling and 503 availability responses; no database/provider details. Define stable error codes and request IDs. Never expose a public submission lookup endpoint containing personal information.

## Idempotency and failure
Keep the same key during network retries of one submission; a new deliberate submission gets a new key. Concurrent replays create one record/event. A storage failure returns no success. Email failure after commit does not turn a saved enquiry into a lost lead. Display accessible error/retry states and clinic fallback.

## Acceptance
Normal, malformed, oversized, spam, mismatched site/form, inactive form, duplicate concurrent requests, storage outage and email outage tests pass. Public endpoint cannot enumerate or export leads. Success analytics fires only after durable acceptance and does not duplicate on retry.
