# Transactional email, outbox and routing

## Reliable notification flow
Write submission and outbox together. A supported server-side dispatcher claims pending jobs, loads authorised clinic recipient configuration and sends via a managed transactional provider. Record message ID and accepted/delivered/bounced/failed states separately where provider evidence exists.

Confirm scheduler/queue support for the chosen hosting plan; do not start an untracked background promise and assume it survives request completion. Authenticate worker endpoints and verify provider webhook signatures with replay protection where applicable.

## Routing and privacy
Recipients come from server configuration, never form fields. Recipient changes require privilege and audit evidence. Minimise personal information in email; prefer a protected lead link plus minimal context when approved. Do not include clinical free text in subject lines or operational logs.

## Retries
Use bounded exponential backoff, attempt counts and next retry time. Lease jobs to avoid concurrent workers sending blindly. Record provider idempotency or reconciliation strategy: external email sending is not guaranteed exactly once. Cap retries; mark exhausted jobs failed and alert the named operator. Retrying notification must not recreate the lead.

## Provider readiness
Verify sender-domain ownership and configure SPF/DKIM/DMARC with the selected provider. Preserve existing business mailboxes. Document costs, limits, owner and fallback. API acceptance is not proof of inbox delivery.

## Acceptance
Correct clinic receives the test notification. Provider outage retains the lead and retry state. Recovery sends pending jobs. Bounce/failure appears in admin. Invalid callbacks fail. Duplicate worker runs do not create duplicate leads; notification duplicate risk is documented and controlled.
