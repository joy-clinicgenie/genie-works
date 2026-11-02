# Batch 06 — Finish report workflow and credential permissions

Prerequisites: 01 and 02; data dependencies may use labelled fixtures.

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

Implement the approved Draft -> In review -> Approved -> Final workflow unless a later explicit approved decision supersedes it. Do not silently downgrade to draft/saved. Preserve existing reports with a forward migration and map legacy statuses conservatively; never treat saved as approved without evidence.
Enforce server-side transition permissions from the approved role matrix. Preserve review/version history. Keep a retrievable immutable final version in the agreed client workspace; a correction creates a new version. Clarify whether a final downloadable artifact is required by the source specification and implement that requirement rather than treating a saved row alone as a final file.
Gate connection-secret writes to administrators unless a superseding approved decision permits managers. Confirm direct actions/routes cannot bypass the gate and secrets remain unreadable to ordinary staff.
Add targeted tests for state transitions, denied transitions, final-version preservation, corrections, client isolation and secret writes. Use existing design components.

## Completion gate

Reports traverse the approved workflow, persist the correct final artifact/version and preserve prior finals on correction. Roles cannot bypass approval or secret-write rules through direct requests. Legacy data migrates safely. No new scope decision is invented.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_06_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
