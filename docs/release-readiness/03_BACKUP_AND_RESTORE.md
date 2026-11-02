# Batch 03 — Demonstrate current-schema recovery

Prerequisites: 02.

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

Compare the actual schema to backup/export/restore coverage. Review blog_activity and Auth.js tables. Include required data or explicitly justify exclusions, including whether restored authentication sessions should instead be revoked. Preserve referential integrity.
Run backup and isolated restore against fictional data. Guard the destination; never restore over the source or shared database. Validate representative records, relationship counts, blog activity and migrations, not just exit codes.
Record success through the existing backup_runs mechanism and confirm the Admin page displays it. Document storage/access, restoration procedure and rollback ownership still to be assigned. Do not invent retention policy decisions.

## Completion gate

A current-schema backup and isolated restore succeed. Required records and relations match. Auth/session recovery behaviour is explicit. Admin displays the evidence. Recovery instructions are reproducible and no shared data was mutated.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_03_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
