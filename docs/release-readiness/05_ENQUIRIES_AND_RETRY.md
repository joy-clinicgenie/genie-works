# Batch 05 — Prove enquiries, notification retry and exports

Prerequisites: 02; 03 before shared rehearsal.

## Instructions applying to this batch

- Read `GENIE_WORKS_V1_RELEASE_READINESS.md` and this batch file in full. Follow repository instructions and approved decisions; preserve existing design and user work.
- Implement only this batch. When complete, write the handover and stop at this explicit session boundary. Do not ask for confirmation for ordinary authorised local fixes. Start the next batch when the user supplies its prompt.
- If one dependency is blocked, continue independent tasks in this batch. Record the exact missing input; never treat waiting or missing credentials as approval.
- Use fictional isolated data for all writes/tests/exports. Never reset, restore or seed shared/production data, leak secrets, send real messages, force-push, rewrite Git history, deploy or publish.
- No deferred feature expansion. Do not weaken measurement, permissions or tests to produce a pass. Do not create a second copy of enquiry messages.
- Add targeted tests for substantive behaviour changes. Reuse existing checks for cosmetic changes. Record actual commands and exit codes, separating passed, failed, skipped and blocked.
- Local reviewed task commits are permitted. Stage explicit files. Do not push. Preserve unrelated dirty work; verify candidates in a clean worktree where needed.
- Treat the audit as historical evidence, not a guarantee of the present code state. Preserve the original reports.

## Work to execute

Connect the isolated enquiry fixture through ENQUIRY_DATABASE_URL. Use the existing source-database architecture; never copy names, contacts or message bodies into Genie Works history/audit tables.
Verify totals by date/client/website/form/source where available, comparison periods and production-versus-synthetic filtering. Fixture journeys must not change production counting rules merely to show test rows; test the intended exclusions and use isolated fixture records appropriate to each case.
Exercise New, Acknowledged, Closed and reopening, including concurrent/status conflict behaviour supported by the design. Simulate notification failure, retry request, processing by the source system and duplicate idempotency keys.
Distinguish retry requested, sender processing, provider acceptance and inbox receipt. The external sender is responsible for sending; do not add a duplicate sender inside Genie Works. No real clinic notifications.
Test export column allowlists, escaping relevant to CSV formula injection, admin/manager authorisation, read-only denial and cross-client denial through server requests.

## Completion gate

Fixture totals are correct, duplicate retries preserve one enquiry, failed notifications do not delete records and allowed transitions persist. Export contains only permitted columns and unauthorised requests fail. Missing external-sender verification is explicitly recorded.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_05_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
