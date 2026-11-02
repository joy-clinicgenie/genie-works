# Genie Works V1 re-audit pack

Prepared 1 November 2026, Asia/Singapore. This is an audit specification and blank output templates, not completed audit results.

## Run this audit

1. Extract this folder into `docs/re-audit-pack/` in the actual Genie Works repository.
2. Keep the original audit, batch handovers, follow-up audit and decisions available.
3. Paste `04_CURSOR_PROMPT.md` into Cursor Agent with the repository open.
4. Cursor inspects and tests the exact current candidate and writes six new reports using `templates/`.
5. Read the new go/no-go report first, then the bug register and remediation plan.

Default output folder: `docs/audits/reaudit-YYYY-MM-DD-RUNID/`. Use actual Singapore date/time and a unique run ID; never overwrite older evidence. Copy templates there before filling them. Do not treat this pack as a new authorisation to deploy or to change product scope.

## Scope updates to honour

- Reports use Draft and Saved under D23. Saving a draft does not create an artifact; Save for review creates a frozen, versioned JSON artifact under docs/report according to the supplied implementation report. Audit actual behaviour. Approved/Final are not required unless an explicit later decision reintroduces them.
- Generated report files must remain private, excluded from Git and accessible only through authorised retrieval. Local filesystem persistence is not proof of durable hosted storage.
- Enquiries must support Wix and vibe-coded website sources in one interface. Audit whether both connectors actually exist. A documented proposal does not count as implementation. Treat the user's explicit two-source requirement as current scope; record any conflict with older exclusion decisions.
- Wix submissions come from the applicable authorised Wix Forms API. Vibe-coded submissions come from their source database/API.
- Each website owns notification sending, whether Wix, Resend or another sender. Genie Works does not send mail or ingest inboxes. Do not penalise it for lacking a sender. Audit its reading of available source notification status and any supported retry request.
- No second stored copy of contact details or message bodies in Genie Works. Source IDs, follow-up metadata and approved aggregate records can be stored as permitted by actual decisions. Do not log personal submission content.
- Email sent means provider acceptance, not inbox receipt. Preserve earlier receipt/acceptance evidence separately. Do not send another message as part of this audit.
- Historical file retention was accepted in D22 according to supplied evidence. Verify the record and current repository safeguards; do not repeatedly demand a history rewrite or describe accepted exposure as erased.
- Keep Blog Performance, form builder, Wix blog publishing, crawler, bulk redirects, direct GBP API, llms.txt, NLWeb and staff alert preferences deferred unless later explicitly authorised.

## Source precedence

User's current explicit scope, latest approved decisions, current requirements, then older implementation documents. Audit reports are observations, not product decisions. Read D22 onward including any later architecture clarification; do not assume the highest decision number. If a conflict remains, identify it and assess affected checks separately.

Historical context only: original 53/100, later reported 62/100; candidate 85b99c7d11a11feae4d5da93068d754a9dfcd5b4 and evidence commit 29bdb1564bad4d5483ba5ae7aa76deb5a87404bd. These are not automatically the current candidate or current results.

## Deliverables

Six reports: V1_GO_NO_GO.md, V1_RELEASE_SCORECARD.md, V1_MODULE_PARITY.md, V1_BUG_REGISTER.md, V1_TEST_RESULTS.md and V1_REMEDIATION_PLAN.md. Use the same style as the earlier audit, but current scope and new evidence.
