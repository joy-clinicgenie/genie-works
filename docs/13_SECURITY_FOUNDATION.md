# Security foundation

## Required controls
- Managed authentication; secure sessions, reset/revocation and privileged MFA where available.
- Server-enforced client membership and explicit privileged/export permissions.
- No database service keys, provider tokens or real credentials in source, prompts, browser bundles or examples.
- Separate development/staging/production credentials and databases or demonstrably isolated equivalent boundaries.
- Input validation, payload/length limits, sanitisation, rate limits, spam controls and documented CORS policy.
- Appropriate CSRF/session protections for authenticated mutations based on the chosen auth model.
- Protected audit records, safe error responses and redacted logs.
- Dependency and secret checks; independent qualified security review before live patient data.

## Test paths
Cross-client guessed IDs, lists, exports and mutation attempts; revoked membership; expired sessions; anonymous staff endpoint calls; invalid/oversized payload; untrusted recipients; worker/webhook spoofing; malicious CSV fields and secret exposure.

Origin is not authentication. Public form keys cannot authorise lead access. Database row policies and server checks must agree; audit elevated-client usage.

## Stop-ship
Cross-client exposure, missing durable lead storage, leaked secrets, unsafe medical data handling, untested restore or false booking confirmation. No unresolved critical/high findings at release.

## Evidence
Record build commit, environment, test identity/scope, expected/actual result, redacted proof, reviewer, remediation and retest. Review is required by the implementation plan; this documentation pack itself does not establish that review has occurred.
