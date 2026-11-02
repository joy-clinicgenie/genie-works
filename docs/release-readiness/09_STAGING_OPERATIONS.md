# Batch 09 — Prepare deployment, monitoring and rollback evidence

Prerequisites: 01-08 for full staging readiness; local preparation can proceed earlier.

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

Inspect existing deployment configuration and authorised external metadata if accessible. Separate local/rehearsal, connected staging pilot and production targets. Do not assume repository omissions prove external settings absent.
Prepare environment validation, scheduler configuration, safe health/error monitoring and a documented rollback procedure fitting the existing stack. Keep operational error reporting distinct from deferred user alert preferences. Do not add an unnecessary new monitoring product.
Identify the human rollback owner, app rollback procedure, database forward/backward compatibility and recovery destination. Document how to detect failed sync, unavailable enquiry source and worker failure without exposing secrets.
This batch prepares code and runbooks; it does not grant deployment, production configuration changes, provider billing changes, public access changes or external notifications. If staging is already authorised independently, verify that precise environment within that scope; otherwise mark hosted checks as pending an authorised staging run. Do not invent evidence.

## Completion gate

Runtime and environment validation, operational procedures and ownership are explicit. Local checks pass. Scheduler/monitoring/rollback hosted evidence exists only if genuinely exercised; otherwise the connected-pilot gate remains blocked. Production remains a separate decision.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_09_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
