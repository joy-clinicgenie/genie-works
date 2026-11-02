# Batch 10 — Freeze and re-audit the exact candidate

Prerequisites: All preceding applicable checks.

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

Review the complete diff and intended files. Create a candidate commit including implementation and tests, with no unrelated changes or secrets. Verify a clean checkout of that exact SHA with isolated configuration. Record dependency lockfile and runtime versions.
Run typecheck, lint, tests, decision tests, build and applicable browser/integration/recovery checks. Reuse still-valid evidence only when its tested code/configuration and environment are demonstrably applicable; retest changed paths. Any implementation change after these checks creates a new candidate.
Write dated follow-up evidence without overwriting original audit files. Reconcile all GW-001 through GW-017 and additional release gates. Do not mark a defect closed because its command was not run.
Record implementation_candidate_sha, tested_checkout_sha, evidence_commit_sha if evidence is committed later, and final delivery SHA. Documentation-only evidence commits must explicitly identify the tested implementation ancestor and contain no runtime changes. If they contain runtime changes, retest the new candidate.
Issue separate decisions for fictional rehearsal, connected internal pilot and production. A numerical score cannot override failed gates. Do not approve an internal pilot with an open P1. Do not deploy or push.

## Completion gate

An exact reproducible candidate, complete issue ledger, command evidence and separate environment-specific go/no-go decisions exist. No P0/P1 is open for pilot approval. Unavailable verification is blocked/unverified. The final report identifies precise next actions and owners without inventing scores or readiness.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_10_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
