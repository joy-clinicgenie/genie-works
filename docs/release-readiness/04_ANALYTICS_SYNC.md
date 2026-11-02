# Batch 04 — Prove analytics synchronisation and freshness

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

Inspect worker routes and provider adapters. Configure an authenticated scheduler compatible with the actual deployment platform and HTTP method. A cron GET must not be assumed to invoke a POST-only route. Preserve authentication; prevent duplicate claims, overlapping execution problems and uncontrolled retry loops using the existing architecture.
Surface queue state, safe errors and last successful sync. Inspect the reported backlog without assuming those historical counts remain current.
With available authorised non-production credentials, run a known GA4 or Wix window and a GSC window. Compare representative metrics with the provider for identical dates, property and timezone. Verify two-site isolation where possible. Never add GA4 and Wix traffic. Missing/incomplete periods stay explicitly unavailable; fixtures and illustrative charts stay labelled.
If credentials or a scheduler host are unavailable, implement and test the local path with fixtures and document the exact live-verification blocker. Local manual invocation is not proof of scheduled execution.

## Completion gate

Provider and scheduler evidence identify property aliases, date windows, timezone, successful timestamp and comparison results without secrets. Queue work completes or exposes safe errors. Unperformed live/scheduled checks remain blocked, not passed. Measurement distinctions remain intact.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_04_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
