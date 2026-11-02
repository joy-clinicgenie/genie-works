# Batch 02 — Create the fictional rehearsal environment

Prerequisites: 01.

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

Prepare isolated application and enquiry databases with fictional clients only. Verify targets through redacted labels before any migration, seed or write. Add safeguards preventing accidental destructive testing against a shared database.
Investigate directory data embedded in migrations and the migration runner checksum/history behaviour. Prevent new real-directory imports through ordinary setup without breaking applied migration history. Use a compatible fresh-install strategy and forward changes where required. If removing historical literals requires changing applied files or rewriting Git history, document the concrete proposed treatment and block only that action pending a decision; do not silently edit or rewrite history. Keep historical repository exposure distinct from clean fresh setup.
Disable development magic links and Google automatic admin creation whenever a shared database is used. Do not rely only on NODE_ENV. Use reliable explicit environment boundaries and existing authorised sign-in methods.
Document local/staging/production variables by name and purpose only. Ensure placeholder build secrets cannot serve as runtime secrets.

## Completion gate

Fresh rehearsal setup uses only documented fictional data. Shared-database development sign-in shortcuts are denied. Unknown Google users cannot auto-create admins there. Runtime-secret validation is tested. Existing migration history remains valid; any unresolved repository-history issue remains open.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_02_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
