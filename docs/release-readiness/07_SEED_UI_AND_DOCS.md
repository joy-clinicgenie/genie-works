# Batch 07 — Finish setup, responsive UI and documentation

Prerequisites: 01 and 02; align docs with completed batches.

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

Fix seed idempotency against the actual snapshot uniqueness constraint; two consecutive seeds must succeed without duplicate rows in the fictional environment.
Document the duplicate applied 0034 migration filenames. Verify both apply once on fresh setup and rerunning migrations is safe. Never renumber applied migrations.
Fix header overlap at 390px and 768px while preserving desktop behaviour. Keep controls keyboard reachable and visibly focused. Correct the redundant home h1 greeting and relevant link/image lint warnings without unnecessary visual redesign.
Refresh README, build status, handover and staff SOP for nine-module V1, the actual environment requirements and deferred functions. Identify reachable legacy routes as outside V1 launch scope without deleting them.

## Completion gate

Repeat seed/migration checks pass. Header controls are usable at 390, 768 and desktop widths. Keyboard focus and heading structure are checked. Current documents accurately describe functions, limitations and operational ownership gaps.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_07_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
